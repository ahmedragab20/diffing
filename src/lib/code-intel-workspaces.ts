import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { toSafeLiteralRelativePath } from "./path.js";
import { ghHostnameArgs, resolvedFromSession } from "./github.js";
import type { PrSession } from "./pr-session.js";
import type { DiffOptions } from "./diff-options.js";
import type { AiLanguageServer } from "./settings.js";
import type { CodeIntelSource } from "./code-intel-source.js";
import { LanguageServers } from "./ai/language-servers.js";
import { codeIntel, type CodeIntelRequest, type CodeIntelResult } from "./code-intel.js";

const exec = promisify(execFile);
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 30_000;
const MAX_WORKSPACES = 8;
const clean = { customMode: false, prMode: false, staged: false };

async function fetchPrArchive(pr: PrSession, revision: string): Promise<Buffer> {
	const resolved = resolvedFromSession(pr);
	const archive = (await exec("gh", ["api", ...ghHostnameArgs(resolved), `repos/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/tarball/${revision}`], { encoding: "buffer", maxBuffer: MAX_BYTES, timeout: 60_000 })).stdout;
	return gunzipSync(archive, { maxOutputLength: MAX_BYTES });
}

/** Extract only ordinary files; archive links never gain filesystem authority. */
export async function materializeCodeIntelArchive(buffer: Buffer, root: string, stripRoot = false): Promise<void> {
	if (buffer.length > MAX_BYTES) throw new Error("Source archive exceeds its limit");
	let offset = 0, count = 0;
	let nextPath: string | undefined;
	let globalPath: string | undefined;
	while (offset + 512 <= buffer.length) {
		const header = buffer.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const field = (start: number, length: number) => header.subarray(start, start + length).toString("utf8").split("\0")[0];
		const checksum = Number.parseInt(field(148, 8).trim(), 8);
		const actualChecksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
		if (checksum !== actualChecksum) throw new Error("Invalid source archive checksum");
		const size = Number.parseInt(field(124, 12).trim() || "0", 8);
		if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BYTES || offset + 512 + size > buffer.length) throw new Error("Invalid source archive");
		const type = field(156, 1);
		const body = buffer.subarray(offset + 512, offset + 512 + size);
		offset += 512 + Math.ceil(size / 512) * 512;
		if (type === "x" || type === "g") {
			let position = 0;
			while (position < body.length) {
				const space = body.indexOf(32, position);
				const length = Number(body.subarray(position, space).toString());
				if (space < position || !Number.isSafeInteger(length) || length <= 0 || position + length > body.length) throw new Error("Invalid source archive metadata");
				const record = body.subarray(space + 1, position + length - 1).toString("utf8");
				if (record.startsWith("path=")) {
					if (type === "g") globalPath = record.slice(5); else nextPath = record.slice(5);
				}
				position += length;
			}
			continue;
		}
		if (type === "L") { nextPath = body.toString("utf8").replace(/\0.*$/s, "").replace(/\n$/, ""); continue; }
		const prefix = field(345, 155);
		let path = nextPath ?? globalPath ?? `${prefix ? prefix + "/" : ""}${field(0, 100)}`;
		nextPath = undefined;
		if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === ".." || part === ".git")) throw new Error("Unsafe source archive path");
		if (stripRoot) path = path.slice(path.indexOf("/") + 1);
		if (!path || type === "5") continue;
		if (type !== "0" && type !== "") continue;
		if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === ".." || part === ".git")) throw new Error("Unsafe source archive path");
		const safe = toSafeLiteralRelativePath(path, root);
		if (!safe || ++count > MAX_FILES) throw new Error("Source workspace exceeds its limits");
		await mkdir(dirname(join(root, safe)), { recursive: true });
		await writeFile(join(root, safe), body);
	}
}

type Workspace = { root: string; servers: LanguageServers; active: number };

/** Revision roots are isolated from the checkout and shared only by exact identity. */
export class CodeIntelWorkspaces {
	private entries = new Map<string, Promise<Workspace>>();
	private indexes = new Map<string, Buffer>();
	private acquisition = Promise.resolve();
	private closed = false;
	private active = 0;
	private onIdle?: () => void;
	private live: LanguageServers;
	constructor(private root: string, private storage: string, private config: Record<string, AiLanguageServer>, private loadPrArchive = fetchPrArchive) {
		this.live = new LanguageServers(config, root);
	}
	get servers(): LanguageServers { return this.live; }

	private async git(args: string[]): Promise<Buffer> {
		return (await exec("git", args, { cwd: this.root, encoding: "buffer", maxBuffer: MAX_BYTES, timeout: 30_000, env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" } })).stdout;
	}
	private async sha(revision: string): Promise<string> {
		if (revision.startsWith("-")) throw new Error("Invalid source revision");
		return (await this.git(["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`])).toString().trim();
	}
	private async pair(options: DiffOptions, source?: CodeIntelSource): Promise<[string, string]> {
		if (source?.baseRevision) return [source.baseRevision, source.revision ?? (source.kind === "staged" ? "index" : options.staged && source.kind === "revision" ? "index" : "working")];
		if (source?.kind === "commit" && source.revision) {
			const head = await this.sha(source.revision);
			const parents = (await this.git(["rev-list", "--parents", "-n", "1", head])).toString().trim().split(" ");
			return [parents[1] ?? "empty", head];
		}
		const revisions = options.revisions;
		if (source?.kind === "revision" || (!source && revisions.length)) {
			if (revisions.length === 1 && revisions[0].includes("..")) {
				const triple = revisions[0].includes("...");
				const [a, b] = revisions[0].split(triple ? "..." : "..");
				const left = await this.sha(a || "HEAD"), right = await this.sha(b || "HEAD");
				const old = triple ? (await this.git(["merge-base", left, right])).toString().trim() : left;
				return [old, right];
			}
			if (revisions.length >= 2) return [await this.sha(revisions[0]), await this.sha(revisions.at(-1)!)];
			if (revisions.length === 1) return [await this.sha(revisions[0]), options.staged ? "index" : "working"];
		}
		if (source?.kind === "staged" || (!source && options.staged)) {
			return [await this.sha("HEAD").catch(() => "empty"), "index"];
		}
		return ["index", "working"];
	}

	async captureSource(options: DiffOptions, source: CodeIntelSource): Promise<CodeIntelSource> {
		const pair = await this.pair(options, source);
		const captured = { ...source };
		if (pair[0] !== "index" && pair[0] !== "working") captured.baseRevision = pair[0];
		if (pair[1] !== "index" && pair[1] !== "working") captured.revision = pair[1];
		if (pair.includes("index")) {
			const index = await this.git(["ls-files", "--stage", "-z"]);
			captured.indexRevision = createHash("sha256").update(index).digest("hex");
			this.indexes.set(captured.indexRevision, index);
			if (this.indexes.size > 16) this.indexes.delete(this.indexes.keys().next().value!);
		}
		return captured;
	}
	private async workspace(revision: string, pr?: PrSession, source?: CodeIntelSource): Promise<Workspace> {
		const previous = this.acquisition;
		let release!: () => void;
		this.acquisition = new Promise<void>((resolve) => { release = resolve; });
		await previous;
		try {
			if (this.closed) throw new Error("Source workspaces are closed");
			const workspace = await this.prepareWorkspace(revision, pr, source);
			workspace.active++;
			this.active++;
			return workspace;
		} finally { release(); }
	}
	private release(workspace: Workspace): void {
		workspace.active--;
		if (--this.active === 0) this.onIdle?.();
	}
	private async prepareWorkspace(revision: string, pr?: PrSession, source?: CodeIntelSource): Promise<Workspace> {
		if (revision === "working") return { root: this.root, servers: this.live, active: 0 };
		let index: Buffer | undefined;
		if (revision === "index") {
			index = source?.indexRevision ? this.indexes.get(source.indexRevision) : await this.git(["ls-files", "--stage", "-z"]);
			if (!index) throw new Error("The displayed index snapshot has expired");
		}
		const identity = JSON.stringify([pr ? [pr.host, pr.owner, pr.repo] : this.root, revision, index ? createHash("sha256").update(index).digest("hex") : ""]);
		const cached = this.entries.get(identity);
		if (cached) { this.entries.delete(identity); this.entries.set(identity, cached); return cached; }
		if (this.entries.size >= MAX_WORKSPACES) {
			let removed = false;
			for (const [key, value] of this.entries) {
				const entry = await value;
				if (entry.active) continue;
				this.entries.delete(key);
				await entry.servers.close(); await rm(entry.root, { recursive: true, force: true }); removed = true; break;
			}
			if (!removed) throw new Error("All source workspaces are busy");
		}
		const pending = this.build(revision, index, pr).catch((error) => { this.entries.delete(identity); throw error; });
		this.entries.set(identity, pending);
		return pending;
	}
	private async build(revision: string, index?: Buffer, pr?: PrSession): Promise<Workspace> {
		await mkdir(this.storage, { recursive: true });
		const root = await realpath(await mkdtemp(join(this.storage, "code-intel-")));
		try {
			if (index || (!pr && revision !== "empty")) {
				const tree = index ?? Buffer.from((await this.git(["ls-tree", "-r", "-z", revision])).toString("utf8").split("\0").filter(Boolean).map((entry) => {
					const match = /^(\d+) \w+ ([a-f0-9]+)\t(.*)$/s.exec(entry);
					if (!match) throw new Error("Invalid source tree");
					return `${match[1]} ${match[2]} 0\t${match[3]}`;
				}).join("\0"));
				const records = tree.toString("utf8").split("\0").filter(Boolean);
				if (records.length > MAX_FILES) throw new Error("Index exceeds workspace limit");
				let bytes = 0;
				const files: { hash: string; path: string }[] = [];
				for (const record of records) {
					const match = /^(\d+) ([a-f0-9]+) (\d)\t(.*)$/s.exec(record);
					if (!match || match[3] !== "0") throw new Error("The index has unresolved conflicts");
					if (match[1] !== "100644" && match[1] !== "100755") continue;
					const path = toSafeLiteralRelativePath(match[4], root);
					if (!path || path.split("/").includes(".git")) throw new Error("Invalid index path");
					files.push({ hash: match[2], path });
				}
				const batch = await new Promise<Buffer>((resolve, reject) => {
					const child = execFile("git", ["cat-file", "--batch"], { cwd: this.root, encoding: "buffer", maxBuffer: MAX_BYTES, timeout: 30_000, env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" } }, (error, stdout) => error ? reject(error) : resolve(stdout));
					child.stdin?.end(files.map((file) => file.hash).join("\n") + (files.length ? "\n" : ""));
				});
				let position = 0;
				for (const file of files) {
					const end = batch.indexOf(10, position);
					const header = /^([a-f0-9]+) blob (\d+)$/.exec(batch.subarray(position, end).toString());
					if (!header || header[1] !== file.hash) throw new Error("Invalid index blob");
					const length = Number(header[2]);
					if (!Number.isSafeInteger(length) || end + 1 + length >= batch.length) throw new Error("Invalid index blob length");
					const content = batch.subarray(end + 1, end + 1 + length);
					position = end + length + 2;
					bytes += content.length;
					if (bytes > MAX_BYTES) throw new Error("Index exceeds workspace limit");
					await mkdir(dirname(join(root, file.path)), { recursive: true }); await writeFile(join(root, file.path), content);
				}
			} else if (revision !== "empty") {
				let archive: Buffer;
				if (pr) {
					archive = await this.loadPrArchive(pr, revision);
				} else archive = await this.git(["archive", "--format=tar", revision]);
				await materializeCodeIntelArchive(archive, root, !!pr);
			}
			// Reuse installed third-party types only when the package/lock inputs match.
			await this.linkDependencies(root);
			return { root, servers: new LanguageServers(this.config, root), active: 0 };
		} catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
	}
	private async linkDependencies(root: string): Promise<void> {
		try {
			for (const name of ["package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"]) {
				const original = await readFile(join(this.root, name)).catch(() => null);
				const captured = await readFile(join(root, name)).catch(() => null);
				if (!!original !== !!captured || (original && captured && !original.equals(captured))) return;
			}
			const dependencies = join(this.root, "node_modules");
			const link = async (name: string) => {
				const target = await realpath(join(dependencies, name));
				if (!target.split(/[\\/]/).includes("node_modules")) return;
				await mkdir(dirname(join(root, "node_modules", name)), { recursive: true });
				await symlink(target, join(root, "node_modules", name), process.platform === "win32" ? "junction" : "dir");
			};
			for (const entry of await readdir(dependencies)) {
				if (entry.startsWith(".")) continue;
				if (entry.startsWith("@")) for (const child of await readdir(join(dependencies, entry))) await link(`${entry}/${child}`).catch(() => {});
				else await link(entry).catch(() => {});
			}
		} catch { /* Missing dependencies do not prevent syntax/local symbol hover. */ }
	}

	async lookup(options: DiffOptions, request: CodeIntelRequest, source?: CodeIntelSource, pr?: PrSession): Promise<CodeIntelResult> {
		if (!this.live.configured) return { available: false, reason: "not-configured" };
		const readonly = ["hover", "definition", "references", "signature", "highlights"].includes(request.op);
		try {
			let pair: [string, string];
			if (pr) pair = source?.revision ? [source.parentRevision ?? "empty", source.revision] : [pr.mergeBaseSha || pr.baseSha, pr.headSha];
			else pair = await this.pair(options, source);
			const revision = pair[request.side === "deletions" ? 0 : 1];
			if (!readonly && (revision !== "working" || request.side !== "additions")) return { available: false, reason: "read-only" };
			const workspace = await this.workspace(revision, pr, source);
			try { return await codeIntel(workspace.servers, workspace.root, clean, { ...request, side: "additions" }); }
			finally { this.release(workspace); }
		} catch { return { available: false, reason: "source-unavailable", detail: "The displayed source could not be prepared for its language server." }; }
	}
	async readSource(options: DiffOptions, path: string, side: "additions" | "deletions", source?: CodeIntelSource, pr?: PrSession): Promise<Buffer | null> {
		const pair = pr ? (source?.revision ? [source.parentRevision ?? "empty", source.revision] : [pr.mergeBaseSha || pr.baseSha, pr.headSha]) : await this.pair(options, source);
		const workspace = await this.workspace(pair[side === "deletions" ? 0 : 1], pr, source);
		try {
			const safe = toSafeLiteralRelativePath(path, workspace.root);
			if (!safe) throw new Error("Invalid source path");
			const absolute = await realpath(join(workspace.root, safe)).catch(() => null);
			if (!absolute) return null;
			if (!toSafeLiteralRelativePath(absolute, await realpath(workspace.root))) throw new Error("Source path is outside repository");
			const content = await readFile(absolute);
			if (content.length > 4 * 1024 * 1024) throw new Error("Source file exceeds preview limit");
			return content;
		} finally { this.release(workspace); }
	}
	async close(): Promise<void> {
		this.closed = true;
		await this.acquisition;
		if (this.active) await new Promise<void>((resolve) => { this.onIdle = resolve; });
		await this.live.close();
		await Promise.all([...this.entries.values()].map(async (pending) => {
			const entry = await pending.catch(() => null);
			if (entry) { await entry.servers.close(); await rm(entry.root, { recursive: true, force: true }); }
		}));
		this.entries.clear();
		this.indexes.clear();
	}
}
