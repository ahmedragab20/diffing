/**
 * diffing × pi — deep integration extension
 *
 * Bridges the local-first diffing review loop into pi:
 *  - Structured LLM tools mirroring the diffing MCP surface (status, review
 *    start, comments, reply/resolve, plan loop, progress, sessions, GH PR).
 *  - `/diffing` command to open/reuse the review UI for the current repo.
 *  - Footer status showing the active review session.
 *  - Skill self-heal: keeps `~/.agents/skills/diffing*` as symlinks to the
 *    canonical `.agents/skills` checkout so pi dedupes by realpath and no
 *    `[Skill conflicts]` banner appears when pi runs inside the diffing repo.
 *
 * All tool executions spawn the `diffing` CLI in the consumer repo (ctx.cwd).
 * Install: `pi install npm:diffing` (published on npm),
 * `pi install git:github.com/ahmedragab20/diffing`, or symlink this
 * directory into `~/.pi/agent/extensions/diffing`.
 */

import { spawn } from "node:child_process";
import {
	existsSync,
	lstatSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const SKILL_NAMES = [
	"diffing",
	"diffing-finish-review",
	"diffing-plan-review",
	"diffing-pr-address",
	"diffing-pr-read",
	"diffing-review",
	"diffing-start-review",
] as const;

const MAX_OUTPUT_BYTES = 48 * 1024;
const REVIEW_START_TIMEOUT_MS = 15_000;
const REVIEW_START_POLL_MS = 400;

const SKILLS_REL = join(".agents", "skills");

// ────────────────────────────────────────────────────────────────────────────
// CLI runner
// ────────────────────────────────────────────────────────────────────────────

interface RunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

function runDiffing(
	args: string[],
	cwd: string,
	opts: { timeoutMs?: number; stdin?: string; signal?: AbortSignal } = {},
): Promise<RunResult> {
	return new Promise((resolvePromise) => {
		let child;
		try {
			child = spawn("diffing", args, {
				cwd,
				stdio: ["pipe", "pipe", "pipe"],
				signal: opts.signal,
				shell: false,
			});
		} catch (error) {
			resolvePromise({
				exitCode: 127,
				stdout: "",
				stderr: `Failed to spawn "diffing": ${error instanceof Error ? error.message : String(error)}`,
			});
			return;
		}
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let stdoutLen = 0;
		let stderrLen = 0;
		const cap = (bufs: Buffer[], len: number, chunk: Buffer) => {
			if (len >= MAX_OUTPUT_BYTES) return len;
			const remaining = MAX_OUTPUT_BYTES - len;
			bufs.push(chunk.subarray(0, remaining));
			return len + Math.min(remaining, chunk.length);
		};
		child.stdout?.on("data", (chunk: Buffer) => {
			stdoutLen = cap(stdout, stdoutLen, chunk);
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderrLen = cap(stderr, stderrLen, chunk);
		});
		let settled = false;
		const finish = (exitCode: number) => {
			if (settled) return;
			settled = true;
			resolvePromise({
				exitCode,
				stdout: Buffer.concat(stdout).toString("utf-8"),
				stderr: Buffer.concat(stderr).toString("utf-8"),
			});
		};
		child.on("error", (error) => {
			if (!settled) {
				settled = true;
				resolvePromise({
					exitCode: 127,
					stdout: "",
					stderr: `Failed to run "diffing": ${error.message}`,
				});
			}
		});
		child.on("close", (code) => finish(code ?? 1));
		if (opts.stdin !== undefined) {
			child.stdin?.end(opts.stdin);
		} else {
			child.stdin?.end();
		}
	});
}

function textResult(text: string, details: Record<string, unknown>) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

function describe(result: RunResult, command: string): string {
	if (result.exitCode === 0) {
		const out = result.stdout.trim();
		return out || "(no output)";
	}
	const err = result.stderr.trim();
	let hint = "";
	if (result.exitCode === 127) {
		hint = `\n\n\`diffing\` was not found on PATH (ran: diffing ${command}). Install it with \`npm i -g diffing\` or run \`diffing setup\`.`;
	} else if (result.exitCode === 3) {
		hint = `\n\nNo diffing server is running for this repo (ran: diffing ${command}). Start one with \`diffing\` (or the diffing_start_review tool).`;
	}
	return err ? `${err}${hint}` : `exit code ${result.exitCode}${hint}`;
}

async function diffingUrl(cwd: string): Promise<string | null> {
	const result = await runDiffing(["url"], cwd);
	if (result.exitCode !== 0) return null;
	const url = result.stdout.trim();
	return url.startsWith("http") ? url : null;
}

// ────────────────────────────────────────────────────────────────────────────
// Session status
// ────────────────────────────────────────────────────────────────────────────

interface SessionSummary {
	id: string;
	active?: boolean;
	mode?: string;
	pid?: number;
	url?: string;
	scope?: string;
}

async function activeSessions(cwd: string): Promise<SessionSummary[]> {
	const result = await runDiffing(["sessions", "--json"], cwd);
	if (result.exitCode !== 0) return [];
	try {
		const parsed = JSON.parse(result.stdout);
		return Array.isArray(parsed) ? (parsed as SessionSummary[]) : [];
	} catch {
		return [];
	}
}

async function refreshStatus(ctx: ExtensionContext): Promise<void> {
	try {
		const sessions = await activeSessions(ctx.cwd);
		const active = sessions.find((s) => s.active) ?? sessions[0];
		if (active) {
			ctx.ui.setStatus(
				"diffing",
				`diffing: ${active.mode ?? "session"} — ${active.url ?? ""}`,
			);
		} else {
			ctx.ui.setStatus("diffing", "diffing: no server");
		}
	} catch {
		// status is best-effort
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Canonical skill root + self-heal
// ────────────────────────────────────────────────────────────────────────────

function packageRootOfExtension(): string {
	// extensions/pi/index.ts -> repo root
	return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function findGitRepoRoot(startDir: string): string | null {
	let dir = resolve(startDir);
	for (;;) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

function isDiffingRoot(dir: string): boolean {
	try {
		const pkg = JSON.parse(
			readFileSync(join(dir, "package.json"), "utf-8"),
		) as { name?: string };
		if (pkg.name !== "diffing") return false;
		return existsSync(join(dir, SKILLS_REL));
	} catch {
		return false;
	}
}

/** Resolve the canonical diffing checkout whose `.agents/skills` are the source of truth. */
function findCanonicalRoot(cwd: string): string | null {
	const repoRoot = findGitRepoRoot(cwd);
	if (repoRoot && isDiffingRoot(repoRoot)) return repoRoot;
	const pkgRoot = packageRootOfExtension();
	if (isDiffingRoot(pkgRoot)) return pkgRoot;
	return null;
}

/**
 * Keep the 7 `~/.agents/skills/diffing*` entries as symlinks to the canonical
 * checkout's `.agents/skills`. pi dedupes skills by canonical realpath, so
 * symlinked home entries merge silently with the repo's project skills and no
 * `[Skill conflicts]` banner appears. Repairs stale real copies left behind by
 * `diffing setup skills` / `npx skills add --copy`. Only touches the 7 known
 * names; never deletes anything else.
 */
function selfHealSkillLinks(canonical: string): void {
	const homeSkills = join(homedir(), ".agents", "skills");
	if (!existsSync(homeSkills)) return;
	for (const name of SKILL_NAMES) {
		const target = join(canonical, SKILLS_REL, name);
		if (!existsSync(target)) continue;
		const link = join(homeSkills, name);
		try {
			if (existsSync(link) || lstatSync(link)) {
				if (lstatSync(link).isSymbolicLink()) {
					const real = realpathSync(link);
					if (real === realpathSync(target)) continue; // already correct
				}
				rmSync(link, { recursive: true, force: true });
			}
			symlinkSync(target, link, "dir");
		} catch {
			// best-effort; a failed heal must not break the session
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Detached review server start
// ────────────────────────────────────────────────────────────────────────────

function spawnDetachedReview(cwd: string, args: string[]): void {
	try {
		const child = spawn("diffing", args, {
			cwd,
			stdio: "ignore",
			detached: true,
		});
		child.unref();
	} catch {
		// surfaced by the URL poll below
	}
}

/** Start (or reuse) a web review session and return its base URL. */
async function ensureReviewUrl(
	cwd: string,
	extraArgs: string[] = [],
	reuse: boolean,
	signal?: AbortSignal,
): Promise<{ url: string; reused: boolean }> {
	const existing = await diffingUrl(cwd);
	if (existing && reuse) return { url: existing, reused: true };
	if (existing && !reuse) return { url: existing, reused: true };
	spawnDetachedReview(cwd, [
		"--web",
		"--no-open",
		"--skip-setup",
		...extraArgs,
	]);
	const deadline = Date.now() + REVIEW_START_TIMEOUT_MS;
	for (;;) {
		if (signal?.aborted) break;
		const url = await diffingUrl(cwd);
		if (url) return { url, reused: false };
		if (Date.now() >= deadline) break;
		await new Promise((r) => setTimeout(r, REVIEW_START_POLL_MS));
	}
	throw new Error(
		"diffing server did not become ready in time. Check `diffing doctor` and that `diffing` is on PATH.",
	);
}

// ────────────────────────────────────────────────────────────────────────────
// Tool helpers
// ────────────────────────────────────────────────────────────────────────────

function modelName(ctx: ExtensionContext, explicit?: string): string {
	return explicit ?? (ctx.model ? `${ctx.model.id}` : "pi");
}

// ────────────────────────────────────────────────────────────────────────────
// Extension
// ────────────────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// Keep the home skill links canonical for every session (idempotent).
	pi.on("session_start", async (_event, ctx) => {
		const canonical = findCanonicalRoot(ctx.cwd);
		if (canonical) selfHealSkillLinks(canonical);
		await refreshStatus(ctx);
	});

	// Contribute the canonical skills so pi users outside the repo (or without
	// `~/.agents/skills` copies) still get them. Dedup-safe: when the path is
	// the same realpath as project-discovered skills, pi merges silently.
	pi.on("resources_discover", async (event) => {
		const canonical = findCanonicalRoot(event.cwd);
		if (!canonical) return undefined;
		return { skillPaths: [join(canonical, SKILLS_REL)] };
	});

	// ── tools ────────────────────────────────────────────────────────────────

	pi.registerTool({
		name: "diffing_status",
		label: "Diffing Status",
		description:
			"Report the active diffing review session for the current repo: server state, mode (web/tui/gh-pr), scope, and base URL. Call this first before other diffing tools.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const sessions = await activeSessions(ctx.cwd);
			const url = await diffingUrl(ctx.cwd);
			await refreshStatus(ctx);
			if (sessions.length === 0) {
				return textResult(
					"No diffing server is running for this repo. Start one with diffing_start_review or `/diffing`.",
					{ running: false, sessions: [], url },
				);
			}
			const lines = sessions.map((s) =>
				[
					`- ${s.id}${s.active ? " (active)" : ""} mode=${s.mode ?? "?"} url=${s.url ?? "?"} scope=${s.scope ?? "?"}`,
				].join(""),
			);
			return textResult(`Active diffing sessions:\n${lines.join("\n")}`, {
				running: true,
				sessions,
				url,
			});
		},
	});

	pi.registerTool({
		name: "diffing_start_review",
		label: "Start Review",
		description:
			"Start (or reuse) a diffing web review session for the current repo's working tree, or a GitHub PR with prRef. Returns the human review URL. Use before handing work to a human.",
		parameters: Type.Object({
			prRef: Type.Optional(
				Type.String({
					description:
						"GitHub PR reference to review instead of the working tree: bare number, owner/repo#N, or full URL.",
				}),
			),
			reuse: Type.Optional(
				Type.Boolean({
					description:
						"Reuse the active session if one is running. Default: true.",
					default: true,
				}),
			),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			try {
				const extra = params.prRef ? ["--gh-pr", params.prRef] : [];
				const { url, reused } = await ensureReviewUrl(
					ctx.cwd,
					extra,
					params.reuse ?? true,
					signal,
				);
				await refreshStatus(ctx);
				return textResult(`Review ${reused ? "reused" : "started"}: ${url}`, {
					url,
					reused,
					mode: params.prRef ? "gh-pr" : "web",
				});
			} catch (error) {
				return textResult(
					error instanceof Error ? error.message : String(error),
					{ started: false },
				);
			}
		},
	});

	pi.registerTool({
		name: "diffing_comments",
		label: "Diffing Comments",
		description:
			"Snapshot the current review comments as XML (or JSON). Use --open to see only unresolved threads. Parse the returned XML to act on feedback.",
		parameters: Type.Object({
			open: Type.Optional(
				Type.Boolean({
					description:
						"Only include open (unresolved) comment threads. Default: true.",
					default: true,
				}),
			),
			format: Type.Optional(
				StringEnum(["xml", "json", "md"] as const, {
					description: "Output format. Default: xml.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const args = ["comments"];
			if (params.open) args.push("--open");
			if (params.format) args.push("--format", params.format);
			const result = await runDiffing(args, ctx.cwd);
			return textResult(describe(result, args.join(" ")), {
				exitCode: result.exitCode,
				stderr: result.stderr.trim() || undefined,
				command: `diffing ${args.join(" ")}`,
			});
		},
	});

	pi.registerTool({
		name: "diffing_reply",
		label: "Diffing Reply",
		description:
			"Append a reply to an existing comment thread by id. Answers questions; does not resolve.",
		parameters: Type.Object({
			commentId: Type.String({
				description: "UUID of the comment thread to reply to.",
			}),
			body: Type.String({ description: "Markdown reply body." }),
			model: Type.Optional(
				Type.String({
					description: "Model name to attribute. Defaults to the active model.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const result = await runDiffing(
				[
					"reply",
					params.commentId,
					"-",
					"--model",
					modelName(ctx, params.model),
				],
				ctx.cwd,
				{
					stdin: params.body,
				},
			);
			return textResult(describe(result, `diffing reply ${params.commentId}`), {
				exitCode: result.exitCode,
				stderr: result.stderr.trim() || undefined,
			});
		},
	});

	pi.registerTool({
		name: "diffing_resolve",
		label: "Diffing Resolve",
		description:
			"Mark a review comment thread resolved. Use after addressing a change request.",
		parameters: Type.Object({
			commentId: Type.String({ description: "UUID of the comment thread." }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const result = await runDiffing(["resolve", params.commentId], ctx.cwd);
			return textResult(
				describe(result, `diffing resolve ${params.commentId}`),
				{
					exitCode: result.exitCode,
					stderr: result.stderr.trim() || undefined,
				},
			);
		},
	});

	pi.registerTool({
		name: "diffing_unresolve",
		label: "Diffing Unresolve",
		description: "Re-open a previously resolved comment thread.",
		parameters: Type.Object({
			commentId: Type.String({ description: "UUID of the comment thread." }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const result = await runDiffing(["unresolve", params.commentId], ctx.cwd);
			return textResult(
				describe(result, `diffing unresolve ${params.commentId}`),
				{
					exitCode: result.exitCode,
					stderr: result.stderr.trim() || undefined,
				},
			);
		},
	});

	pi.registerTool({
		name: "diffing_progress",
		label: "Diffing Progress",
		description:
			"Post a live progress toast to the review UI so the human sees status while work is underway. Safe to call frequently.",
		parameters: Type.Object({
			message: Type.String({
				description: "Progress message, e.g. 'Addressing L42…'.",
			}),
			pct: Type.Optional(
				Type.Number({ description: "Optional 0-100 completion percent." }),
			),
			model: Type.Optional(
				Type.String({
					description: "Model name to attribute. Defaults to the active model.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const args = [
				"progress",
				"--message",
				params.message,
				"--model",
				modelName(ctx, params.model),
			];
			if (params.pct !== undefined) args.push("--pct", String(params.pct));
			const result = await runDiffing(args, ctx.cwd);
			return textResult(
				describe(result, `diffing progress --message "${params.message}"`),
				{
					exitCode: result.exitCode,
					stderr: result.stderr.trim() || undefined,
				},
			);
		},
	});

	pi.registerTool({
		name: "diffing_await_review",
		label: "Diffing Await Review",
		description:
			"Synchronously wait (long-poll) until the human releases the review ('Send to agent'), then return the comments XML. Exit code 2 (or a timeout) is an expected park signal — do not silent-loop; resume once the human says the review is ready.",
		parameters: Type.Object({
			timeout: Type.Optional(
				Type.Number({
					description: "Max seconds to block. Default: 60 (park beyond that).",
					default: 60,
				}),
			),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const timeout = Math.min(Math.max(params.timeout ?? 60, 1), 600);
			const result = await runDiffing(
				["await-review", "-t", String(timeout)],
				ctx.cwd,
				{ signal },
			);
			const parked = result.exitCode === 2;
			if (parked) {
				return textResult(
					`Timed out after ${timeout}s with no review release (park). Share the review URL and end your turn; run diffing_await_review again when the human says the review is ready.`,
					{ parked: true, exitCode: result.exitCode },
				);
			}
			return textResult(describe(result, "diffing await-review"), {
				parked: false,
				exitCode: result.exitCode,
				stderr: result.stderr.trim() || undefined,
			});
		},
	});

	pi.registerTool({
		name: "diffing_plan_submit",
		label: "Diffing Plan Submit",
		description:
			"Submit (or resubmit) a markdown plan for human review. Pass the plan as file (path) or body (inline text). Returns the plan id and review URL. Default handoff is async: share the URL, end the turn, act on the verdict when the human decides.",
		parameters: Type.Object({
			file: Type.Optional(
				Type.String({
					description:
						"Path to the plan markdown file. Use the body parameter instead to submit inline text.",
				}),
			),
			body: Type.Optional(
				Type.String({ description: "Inline plan markdown body." }),
			),
			title: Type.Optional(
				Type.String({
					description: "Display title. Defaults to the plan's first heading.",
				}),
			),
			planId: Type.Optional(
				Type.String({
					description:
						"Resubmit a revised body for an existing plan id (bumps version, resets verdict).",
				}),
			),
			model: Type.Optional(
				Type.String({
					description: "Authoring model. Defaults to the active model.",
				}),
			),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			let stdin: string | undefined;
			let fileArg = params.file;
			if (!fileArg) {
				if (!params.body) {
					return textResult(
						"Provide either file (path) or body (inline plan markdown).",
						{ submitted: false },
					);
				}
				fileArg = "-";
				stdin = params.body;
			}
			const args = [
				"plan",
				"submit",
				fileArg,
				"--save-source",
				"--model",
				modelName(ctx, params.model),
			];
			if (params.title) args.push("--title", params.title);
			if (params.planId) args.push("--id", params.planId);
			const result = await runDiffing(args, ctx.cwd, { signal, stdin });
			const stdout = result.stdout.trim();
			const stderr = result.stderr.trim();
			if (result.exitCode !== 0) {
				return textResult(describe(result, "diffing plan submit"), {
					submitted: false,
					exitCode: result.exitCode,
					stderr,
				});
			}
			return textResult(`${stdout}\n${stderr}`, {
				submitted: true,
				planId: stdout || undefined,
				url: stderr || undefined,
			});
		},
	});

	pi.registerTool({
		name: "diffing_plan_await",
		label: "Diffing Plan Await",
		description:
			"Synchronously wait until the human decides on the submitted plan, then return the <plan-review> XML with the verdict. Exit code 2 is an expected park signal — do not silent-loop.",
		parameters: Type.Object({
			timeout: Type.Optional(
				Type.Number({
					description: "Max seconds to block. Default: 60 (park beyond that).",
					default: 60,
				}),
			),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const timeout = Math.min(Math.max(params.timeout ?? 60, 1), 600);
			const result = await runDiffing(
				["plan", "await", "-t", String(timeout)],
				ctx.cwd,
				{ signal },
			);
			if (result.exitCode === 2) {
				return textResult(
					`No plan verdict within ${timeout}s (park). Share the plan URL and end your turn; run diffing_plan_await again when the human says the verdict is ready.`,
					{ parked: true, exitCode: result.exitCode },
				);
			}
			return textResult(describe(result, "diffing plan await"), {
				parked: false,
				exitCode: result.exitCode,
				stderr: result.stderr.trim() || undefined,
			});
		},
	});

	pi.registerTool({
		name: "diffing_plan_list",
		label: "Diffing Plan List",
		description:
			"List submitted plans for the current repo (id, decision, version, open comments, title).",
		parameters: Type.Object({
			json: Type.Optional(
				Type.Boolean({ description: "Emit raw JSON instead of the table." }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const args = ["plan", "list"];
			if (params.json) args.push("--json");
			const result = await runDiffing(args, ctx.cwd);
			return textResult(describe(result, args.join(" ")), {
				exitCode: result.exitCode,
				stderr: result.stderr.trim() || undefined,
			});
		},
	});

	pi.registerTool({
		name: "diffing_plan_show",
		label: "Diffing Plan Show",
		description:
			"Show a single plan as <plan-review> XML (or raw JSON) including the verdict and open comments.",
		parameters: Type.Object({
			planId: Type.Optional(
				Type.String({ description: "Plan id. Omit for the latest plan." }),
			),
			json: Type.Optional(
				Type.Boolean({ description: "Emit raw JSON instead of XML." }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const args = ["plan", "show"];
			if (params.planId) args.push(params.planId);
			if (params.json) args.push("--json");
			const result = await runDiffing(args, ctx.cwd);
			return textResult(describe(result, args.join(" ")), {
				exitCode: result.exitCode,
				stderr: result.stderr.trim() || undefined,
			});
		},
	});

	pi.registerTool({
		name: "diffing_plan_reply",
		label: "Diffing Plan Reply",
		description:
			"Reply to an inline plan comment (the owning plan is resolved automatically).",
		parameters: Type.Object({
			commentId: Type.String({ description: "UUID of the plan comment." }),
			body: Type.String({ description: "Markdown reply body." }),
			model: Type.Optional(
				Type.String({
					description: "Model name to attribute. Defaults to the active model.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const result = await runDiffing(
				[
					"plan",
					"reply",
					params.commentId,
					"-",
					"--model",
					modelName(ctx, params.model),
				],
				ctx.cwd,
				{ stdin: params.body },
			);
			return textResult(
				describe(result, `diffing plan reply ${params.commentId}`),
				{
					exitCode: result.exitCode,
					stderr: result.stderr.trim() || undefined,
				},
			);
		},
	});

	pi.registerTool({
		name: "diffing_plan_resolve",
		label: "Diffing Plan Resolve",
		description: "Mark a plan comment resolved.",
		parameters: Type.Object({
			commentId: Type.String({ description: "UUID of the plan comment." }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const result = await runDiffing(
				["plan", "resolve", params.commentId],
				ctx.cwd,
			);
			return textResult(
				describe(result, `diffing plan resolve ${params.commentId}`),
				{
					exitCode: result.exitCode,
					stderr: result.stderr.trim() || undefined,
				},
			);
		},
	});

	pi.registerTool({
		name: "diffing_url",
		label: "Diffing URL",
		description:
			"Print the base URL of the active diffing review server for this repo, or report that none is running.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const url = await diffingUrl(ctx.cwd);
			return textResult(
				url
					? url
					: "No diffing server running for this repo. Start one with diffing_start_review or `/diffing`.",
				{ url },
			);
		},
	});

	pi.registerTool({
		name: "diffing_sessions",
		label: "Diffing Sessions",
		description:
			"List, select, or stop live diffing review sessions for this repo. use: retarget agent commands to a session id prefix. stop: graceful shutdown of a session.",
		parameters: Type.Object({
			action: Type.Optional(
				StringEnum(["list", "use", "stop"] as const, {
					description: "Action. Default: list.",
				}),
			),
			value: Type.Optional(
				Type.String({
					description: "Session id prefix (for use/stop), or 'active'/'all'.",
				}),
			),
			json: Type.Optional(
				Type.Boolean({ description: "Emit JSON for list. Default: false." }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const action = params.action ?? "list";
			const args = ["sessions"];
			if (action !== "list") {
				args.push(action, params.value ?? "active");
			} else if (params.json) {
				args.push("--json");
			}
			const result = await runDiffing(args, ctx.cwd);
			await refreshStatus(ctx);
			return textResult(describe(result, args.join(" ")), {
				exitCode: result.exitCode,
				stderr: result.stderr.trim() || undefined,
			});
		},
	});

	pi.registerTool({
		name: "diffing_gh_overview",
		label: "Diffing GitHub PR Overview",
		description:
			"Probe the active GitHub PR review session: PR identity, head/base SHAs, patch size, and conversation/draft counts. Fails cleanly when no PR session is active.",
		parameters: Type.Object({
			json: Type.Optional(
				Type.Boolean({
					description: "Emit raw JSON instead of human-readable output.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const args = ["gh", "overview"];
			if (params.json) args.push("--json");
			const result = await runDiffing(args, ctx.cwd);
			return textResult(describe(result, args.join(" ")), {
				exitCode: result.exitCode,
				stderr: result.stderr.trim() || undefined,
			});
		},
	});

	pi.registerTool({
		name: "diffing_cli",
		label: "Diffing CLI",
		description:
			"Escape hatch: run any documented `diffing` agent subcommand with raw arguments. Examples: ['inspect','summary'], ['comment','edit',id,'--body','...'], ['gh','threads','--unresolved'], ['gh','reviews'], ['plan','versions',id], ['doctor'], ['mode']. Returns stdout + exit code; exit 3 means no server.",
		parameters: Type.Object({
			args: Type.Array(
				Type.String({
					description: "Subcommand and arguments, e.g. ['inspect','summary'].",
				}),
			),
			stdin: Type.Optional(
				Type.String({
					description:
						"Optional text to pipe to the command's stdin (e.g. reply bodies).",
				}),
			),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const args = params.args;
			if (!Array.isArray(args) || args.length === 0) {
				return textResult("Provide at least one subcommand argument.", {
					ran: false,
				});
			}
			const result = await runDiffing(args, ctx.cwd, {
				signal,
				stdin: params.stdin,
			});
			return textResult(describe(result, `diffing ${args.join(" ")}`), {
				exitCode: result.exitCode,
				stderr: result.stderr.trim() || undefined,
			});
		},
	});

	// ── command ──────────────────────────────────────────────────────────────

	pi.registerCommand("diffing", {
		description:
			"Open (or reuse) the diffing review UI for the current repo's working tree and print the review URL. Optional arg passthrough, e.g. `/diffing --staged` or `/diffing main..feature`.",
		handler: async (args, ctx) => {
			const passthrough = (args ?? "").trim().split(/\s+/).filter(Boolean);
			try {
				const { url } = await ensureReviewUrl(ctx.cwd, passthrough, true);
				await refreshStatus(ctx);
				ctx.ui.notify(`diffing review: ${url}`, "info");
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
			}
		},
	});
}
