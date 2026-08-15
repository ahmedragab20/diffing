import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MockupViewport } from "./mockup-types.js";

const execFileAsync = promisify(execFile);

export const VIEWPORT_WIDTH: Record<MockupViewport, number> = {
	desktop: 1280,
	tablet: 768,
	mobile: 390,
};

export interface MockupLayoutReport {
	missingImages: string[];
	externalStylesheets: string[];
	notes: string[];
}

export interface MockupPreview {
	available: boolean;
	reason?: string;
	screenshotBase64?: string;
	mime?: string;
	viewport: MockupViewport;
	width: number;
	report: MockupLayoutReport;
}

export function analyzeMockupHtml(html: string): MockupLayoutReport {
	const missingImages: string[] = [];
	const imgRe = /<img\b[^>]*>/gi;
	let match: RegExpExecArray | null;
	while ((match = imgRe.exec(html))) {
		const tag = match[0];
		const src = /\bsrc\s*=\s*(["'])([^"']*)\1/i.exec(tag)?.[2] ?? "";
		if (!src || src === "#" || src.startsWith("about:")) missingImages.push(src || "(empty)");
	}
	const externalStylesheets = [
		...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi),
	]
		.map((m) => /\bhref\s*=\s*(["'])([^"']*)\1/i.exec(m[0])?.[2] ?? "")
		.filter((href) => /^https?:/i.test(href));
	const notes: string[] = [];
	if (/overflow:\s*visible/i.test(html) && /white-space:\s*nowrap/i.test(html)) {
		notes.push("Possible overflow: nowrap + visible overflow");
	}
	if (html.length > 200_000) notes.push("Screen HTML is large; prefer fragments");
	return { missingImages, externalStylesheets, notes };
}

async function findChrome(): Promise<string | null> {
	const names =
		process.platform === "darwin"
			? [
					"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
					"/Applications/Chromium.app/Contents/MacOS/Chromium",
				]
			: process.platform === "win32"
				? []
				: ["google-chrome", "chromium", "chromium-browser", "google-chrome-stable"];
	for (const name of names) {
		try {
			if (name.startsWith("/")) {
				await execFileAsync(name, ["--version"], { timeout: 4000 });
				return name;
			}
			const { stdout } = await execFileAsync("which", [name], { timeout: 4000 });
			const path = stdout.trim();
			if (path) return path;
		} catch {
			/* try next */
		}
	}
	return null;
}

export async function renderMockupPreview(
	html: string,
	opts: { viewport?: MockupViewport } = {},
): Promise<MockupPreview> {
	const viewport = opts.viewport ?? "desktop";
	const width = VIEWPORT_WIDTH[viewport];
	const report = analyzeMockupHtml(html);
	let chrome: string | null = null;
	try {
		chrome = await findChrome();
	} catch {
		chrome = null;
	}
	if (!chrome) {
		return {
			available: false,
			reason: "No Chrome/Chromium on PATH — layout report only",
			viewport,
			width,
			report,
		};
	}
	const dir = await mkdtemp(join(tmpdir(), "diffing-preview-"));
	const htmlPath = join(dir, "screen.html");
	const pngPath = join(dir, "screen.png");
	try {
		await writeFile(htmlPath, html, "utf8");
		await execFileAsync(
			chrome,
			[
				"--headless=new",
				"--disable-gpu",
				"--hide-scrollbars",
				`--window-size=${width},900`,
				`--screenshot=${pngPath}`,
				`file://${htmlPath}`,
			],
			{ timeout: 20_000 },
		);
		const bytes = await readFile(pngPath);
		return {
			available: true,
			screenshotBase64: bytes.toString("base64"),
			mime: "image/png",
			viewport,
			width,
			report,
		};
	} catch (err) {
		return {
			available: false,
			reason: err instanceof Error ? err.message : "Screenshot failed",
			viewport,
			width,
			report,
		};
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}
