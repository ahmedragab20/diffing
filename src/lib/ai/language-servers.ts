/**
 * Resolves and reuses language servers for AI symbol lookups.
 *
 * With no configured or detected server for a file's extension, the lookup
 * reports itself unavailable. A
 * server is started at most once per command and reused across lookups, since
 * a cold start costs far more than a query, and it is shut down once idle so a
 * review session does not leave language servers running.
 */
import { pathToFileURL } from "node:url";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { LspError, LspSession } from "./lsp.js";
import type { AiLanguageServer } from "../settings.js";

export const LANGUAGE_SERVER_LIMITS = Object.freeze({
	maxServers: 4,
	idleMs: 5 * 60_000,
});

/** Only installed PATH binaries are detected; explicit configuration wins. */
export function detectLanguageServers(
	path = process.env.PATH ?? "",
	canRun = (command: string) => {
		try { accessSync(command, constants.X_OK); return true; } catch { return false; }
	},
): Record<string, AiLanguageServer> {
	const result: Record<string, AiLanguageServer> = {};
	const candidates: [string[], string, string[]][] = [
		[["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs"], "typescript-language-server", ["--stdio"]],
		[["py", "pyi"], "basedpyright-langserver", ["--stdio"]],
		[["py", "pyi"], "pyright-langserver", ["--stdio"]],
		[["rs"], "rust-analyzer", []],
		[["go"], "gopls", []],
		[["c", "h", "cc", "cpp", "cxx", "hpp"], "clangd", []],
		[["json", "jsonc"], "vscode-json-language-server", ["--stdio"]],
		[["css", "scss", "less"], "vscode-css-language-server", ["--stdio"]],
		[["html"], "vscode-html-language-server", ["--stdio"]],
		[["yaml", "yml"], "yaml-language-server", ["--stdio"]],
		[["lua"], "lua-language-server", []],
	];
	for (const [extensions, name, args] of candidates) {
		const suffixes = process.platform === "win32" ? [".exe", ""] : [""];
		const command = path.split(delimiter).filter(Boolean)
			.flatMap((dir) => suffixes.map((suffix) => join(dir, name + suffix)))
			.find(canRun);
		if (command) for (const extension of extensions) result[extension] ??= { command, args };
	}
	return result;
}

function extensionOf(path: string): string {
	const name = path.slice(path.lastIndexOf("/") + 1);
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export class LanguageServers {
	private readonly sessions = new Map<
		string,
		{ session: Promise<LspSession>; timer?: NodeJS.Timeout }
	>();
	private closed = false;

	constructor(
		private readonly config: Record<string, AiLanguageServer> = {},
		private readonly repositoryRoot: string = process.cwd(),
	) {}

	/** True when some extension has a configured server; used to report honestly. */
	get configured(): boolean {
		return Object.keys(this.config).length > 0;
	}

	/** Extensions with a configured server, so a UI can say what it supports. */
	get extensions(): string[] {
		return Object.keys(this.config);
	}

	supports(path: string): boolean {
		return this.config[extensionOf(path)] !== undefined;
	}

	async sessionFor(path: string): Promise<LspSession> {
		if (this.closed) throw new LspError("unavailable");
		const server = this.config[extensionOf(path)];
		if (!server) throw new LspError("unavailable");
		const slot = JSON.stringify([server.command, server.args ?? []]);
		const existing = this.sessions.get(slot);
		if (existing) {
			const session = await existing.session;
			if (!session.usable) {
				await this.shutdown(slot);
				return this.sessionFor(path);
			}
			this.touch(slot);
			return session;
		}
		if (this.sessions.size >= LANGUAGE_SERVER_LIMITS.maxServers)
			throw new LspError("resource_limit");
		const started = LspSession.start(
			server.command,
			server.args ?? [],
			pathToFileURL(this.repositoryRoot).href,
		).catch((error: unknown) => {
			// A server that fails to start is not retained, so a later lookup retries.
			this.drop(slot);
			throw error;
		});
		this.sessions.set(slot, { session: started });
		this.touch(slot);
		return started;
	}

	async close(): Promise<void> {
		this.closed = true;
		const slots = [...this.sessions.keys()];
		await Promise.all(slots.map((slot) => this.shutdown(slot)));
	}

	private touch(slot: string): void {
		const entry = this.sessions.get(slot);
		if (!entry) return;
		if (entry.timer) clearTimeout(entry.timer);
		entry.timer = setTimeout(() => {
			void this.shutdown(slot);
		}, LANGUAGE_SERVER_LIMITS.idleMs);
		// An idle timer must never hold the process open on its own.
		entry.timer.unref?.();
	}

	private drop(slot: string): void {
		const entry = this.sessions.get(slot);
		if (entry?.timer) clearTimeout(entry.timer);
		this.sessions.delete(slot);
	}

	private async shutdown(slot: string): Promise<void> {
		const entry = this.sessions.get(slot);
		if (!entry) return;
		this.drop(slot);
		try {
			await (await entry.session).close();
		} catch {
			/* A server that never started needs no shutdown. */
		}
	}
}
