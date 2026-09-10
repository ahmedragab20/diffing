import { describe, expect, it } from "vitest";
import {
	buildAiPrompt,
	MAX_AI_CONTEXT_BYTES,
	MAX_AI_PROMPT_BYTES,
} from "../context.js";
import { resolveDiffSnapshot } from "../diff-snapshot.js";
import {
	ReviewSnapshot,
	sourceHash,
	type SnapshotIdentity,
} from "../snapshots.js";
import { AiRequestError } from "../request.js";
import type { AiRunRequest } from "../types.js";

const identity: SnapshotIdentity = {
	kind: "local",
	repositoryId: "repo",
	mode: "working",
	baseSha: null,
	headSha: null,
	indexHash: null,
	patchHash: "",
};
const request = (patch = "+changed line"): AiRunRequest => ({
	trigger: "user",
	conversationId: "context-budget",
	modelId: "codex/subscription/codex/gpt-test",
	surface: "diff",
	action: "review-risks",
	context: { kind: "diff", patch },
});
const oneLinePatch = (path: string, oldText: string, newText: string) =>
	`diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-${oldText}\n+${newText}\n`;

describe("AI context budget regressions", () => {
	it("uses complete captured originals and emits no warning diagnostics", () => {
		const patch = oneLinePatch("src/a.ts", "old", "new");
		const resolved = resolveDiffSnapshot(
			{ kind: "diff", patch },
			{
				identity: { ...identity, patchHash: sourceHash(patch) },
				patch,
				omissions: [],
				originals: [
					{
						key: "old:src/a.ts",
						path: "src/a.ts",
						side: "old",
						revision: "HEAD",
						content: "old\n",
						complete: true,
						provenance: "recorded",
						representation: "original",
					},
					{
						key: "new:src/a.ts",
						path: "src/a.ts",
						side: "new",
						revision: "worktree",
						content: "new\n",
						complete: true,
						provenance: "recorded",
						representation: "original",
					},
				],
			},
		);
		const input = request(resolved.context.patch);
		input.snapshotReader = resolved.snapshot;
		const result = buildAiPrompt(input);
		expect(result.prompt).toContain("old");
		expect(result.prompt).toContain("new");
		expect(result.truncated).toBe(false);
		for (const source of resolved.snapshot.manifest.sources) {
			const returned = (result.evidence ?? [])
				.filter((ref) => ref.sourceId === source.id)
				.reduce((count, ref) => count + ref.endLine - ref.startLine + 1, 0);
			expect(returned).toBe(source.lines);
		}
		expect(result.diagnostics.filter((d) => d.severity === "warning")).toEqual(
			[],
		);
	});

	it("keeps metadata compact and includes all evidence for 40 complete one-line sources", () => {
		const sources = Array.from({ length: 40 }, (_, i) => ({
			key: `source-${i}`,
			path: `f${i}.ts`,
			side: "new" as const,
			revision: "r",
			content: `evidence-${i}`,
			complete: true,
			provenance: "recorded" as const,
			representation: "original" as const,
		}));
		const snapshot = new ReviewSnapshot(
			{ ...identity, patchHash: sourceHash("snapshot") },
			sources,
		);
		const input = {
			...request(),
			context: { kind: "diff" as const },
			snapshotReader: snapshot,
		};
		const result = buildAiPrompt(input);
		expect(result.prompt).not.toContain("[snapshot metadata truncated]");
		expect(result.prompt).toContain('"sourceCount":40');
		for (const source of sources) expect(result.prompt).toContain(source.content);
		expect(result.diagnostics.filter((d) => d.severity === "warning")).toEqual(
			[],
		);
	});

	it("rejects an oversized user request instead of silently truncating it", () => {
		try {
			buildAiPrompt({ ...request(), prompt: "x".repeat(MAX_AI_PROMPT_BYTES + 1) });
			throw new Error("expected AiRequestError");
		} catch (error) {
			expect(error).toBeInstanceOf(AiRequestError);
			expect((error as AiRequestError).status).toBe(413);
		}
	});

	it("bounds attachments and history while preserving every emitted evidence excerpt", () => {
		const sources = Array.from({ length: 8 }, (_, i) => ({
			key: `source-${i}`,
			path: `src/${i}.ts`,
			side: "new" as const,
			revision: "worktree",
			content: `evidence-${i}\n`,
			complete: true,
			provenance: "recorded" as const,
			representation: "original" as const,
		}));
		const snapshot = new ReviewSnapshot(
			{ ...identity, patchHash: sourceHash("captured") },
			sources,
		);
		const input: AiRunRequest = {
			...request(),
			prompt: "x".repeat(MAX_AI_PROMPT_BYTES),
			snapshotReader: snapshot,
		};
		input.context.attachments = Array.from({ length: 8 }, (_, i) => ({
			path: `attachment-${i}.txt`,
			content: `${i}`.repeat(64 * 1024),
		}));
		input.history = Array.from({ length: 8 }, (_, i) => ({
			role: i % 2 ? ("assistant" as const) : ("user" as const),
			text: `turn-${i} `.repeat(10_000),
		}));
		const result = buildAiPrompt(input);
		expect(Buffer.byteLength(result.prompt, "utf8")).toBeLessThanOrEqual(
			MAX_AI_CONTEXT_BYTES,
		);
		expect(result.diagnostics.map((d) => d.code)).toEqual(
			expect.arrayContaining(["attachment_truncated", "history_truncated"]),
		);
		for (const ref of result.evidence ?? []) {
			const source = snapshot.manifest.sources.find(
				(candidate) => candidate.id === ref.sourceId,
			);
			expect(source).toBeDefined();
			const expected = sources.find((candidate) => candidate.key === source?.key)!;
			const text = expected.content
				.split("\n")
				.slice(ref.startLine - 1, ref.endLine)
				.join("\n");
			expect(ref.excerptHash).toBe(sourceHash(text));
			expect(result.prompt).toContain(text);
		}
	});
});
