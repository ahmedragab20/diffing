import { buildAgentDiffIndex } from "../agent-diff-index.js";
import { resolveDiffSnapshot, type CapturedDiff } from "./diff-snapshot.js";
import type { ReviewCapture } from "./review-jobs.js";
import { AiSnapshotError, sourceHash } from "./snapshots.js";

/** Each hydration stays below original-capture limits; the job bounds aggregate work. */
export function createReviewCapture(
	captured: CapturedDiff,
	load: (paths: readonly string[], signal: AbortSignal) => Promise<CapturedDiff>,
	assertFresh: (signal: AbortSignal) => Promise<void>,
	root: string,
): ReviewCapture {
	if (Buffer.byteLength(captured.patch, "utf8") > 4 * 1024 * 1024)
		throw new AiSnapshotError("limit");
	const index = buildAgentDiffIndex(captured.patch, 0);
	if (index.files.length > 256) throw new AiSnapshotError("limit");
	const paths = [
		...new Set(
			index.files
				.map((file) => file.newPath ?? file.oldPath)
				.filter((path): path is string => path !== null),
		),
	];
	const groups: string[][] = [];
	for (let offset = 0; offset < paths.length; offset += 2)
		groups.push(paths.slice(offset, offset + 2));
	const identity = JSON.stringify(captured.identity);
	return {
		revision: sourceHash(identity),
		groupCount: groups.length,
		totalHunks: index.totalHunks,
		diagnostics:
			captured.diagnostics ??
			captured.omissions.map((message) => ({
				code: "upstream_omission",
				severity: "warning",
				message,
			})),
		assertFresh,
		async load(group, signal) {
			signal.throwIfAborted();
			if (!Number.isSafeInteger(group) || !groups[group])
				throw new AiSnapshotError("invalid");
			await assertFresh(signal);
			const scope = groups[group];
			// Old rename paths must be available to the blob reader as well.
			const readPaths = [
				...new Set(
					index.files
						.filter((file) => scope.includes(file.newPath ?? file.oldPath ?? ""))
						.flatMap((file) =>
							[file.oldPath, file.newPath].filter(
								(path): path is string => path !== null,
							),
						),
				),
			];
			const next = await load(readPaths, signal);
			signal.throwIfAborted();
			if (
				JSON.stringify(next.identity) !== identity ||
				next.patch !== captured.patch
			)
				throw new AiSnapshotError("stale");
			const result = resolveDiffSnapshot({ kind: "diff" }, next, root, scope);
			await assertFresh(signal);
			return result.snapshot;
		},
	};
}
