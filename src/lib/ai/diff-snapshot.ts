import { parseGitDiffHeaderPaths } from "../git-path.js";
import { toSafeLiteralRelativePath } from "../path.js";
import type { AiDiffContext } from "./types.js";
import { warning, type AiDiagnostic } from "./diagnostics.js";
import {
	AiSnapshotError,
	ReviewSnapshot,
	sourceHash,
	type SnapshotIdentity,
	type SnapshotSourceInput,
} from "./snapshots.js";

export interface CapturedDiff {
	identity: Extract<SnapshotIdentity, { kind: "local" | "pr" }>;
	patch: string;
	omissions: string[];
	diagnostics?: AiDiagnostic[];
	/** Old/new file contents behind the patch, when the capture read them. */
	originals?: SnapshotSourceInput[];
}

function safePath(path: string, root: string): boolean {
	const normalized = toSafeLiteralRelativePath(path, root);
	return (
		Boolean(path) &&
		(process.platform === "win32"
			? normalized?.replaceAll("\\", "/")
			: normalized) === path
	);
}

/** Keep occurrences, not a path-keyed map: staged and unstaged patches can share a path. */
export function resolveDiffSnapshot(
	input: AiDiffContext,
	capture: CapturedDiff,
	root = process.cwd(),
	patchPaths?: readonly string[],
) {
	if (Buffer.byteLength(capture.patch, "utf8") > 4 * 1024 * 1024)
		throw new AiSnapshotError("limit");
	if (sourceHash(capture.patch) !== capture.identity.patchHash)
		throw new AiSnapshotError("stale");
	const chunks = capture.patch
		.split(/(?=^diff --git )/m)
		.filter((text) => text.trim());
	if (chunks.length > 256) throw new AiSnapshotError("limit");
	const originals = capture.originals ?? [];
	const originalPaths = new Set(originals.map((source) => source.path));
	const omissions = [
		...capture.omissions,
		originals.length
			? "Patch line numbers are artifact offsets; cite original-file lines from the captured old/new sources instead."
			: "Patch line numbers are artifact offsets, not original-file line numbers. Original-file coverage is not established.",
	];
	const diagnostics: AiDiagnostic[] = [
		...(capture.diagnostics ??
			capture.omissions.map((message) => warning("upstream_omission", message))),
		{
			code: "provenance_note",
			severity: "info",
			message: omissions[omissions.length - 1],
		},
	];
	const scopedPath = input.kind === "diff" ? undefined : input.filePath;
	if (input.kind !== "diff" && (!scopedPath || !safePath(scopedPath, root)))
		throw new AiSnapshotError("invalid");
	const sources: SnapshotSourceInput[] = [];
	const patches: string[] = [];
	const includedOriginalPaths = new Set<string>();
	for (const [index, text] of chunks.entries()) {
		const paths = parseGitDiffHeaderPaths(text.split("\n", 1)[0]);
		if (!paths) throw new AiSnapshotError("unsupported");
		if (paths.some((path) => !safePath(path, root)))
			throw new AiSnapshotError("invalid");
		if (scopedPath && !paths.includes(scopedPath)) continue;
		if (patchPaths && !patchPaths.includes(paths[1])) continue;
		for (const path of paths) includedOriginalPaths.add(path);
		patches.push(text);
		const captured = originalPaths.has(paths[0]) || originalPaths.has(paths[1]);
		sources.push({
			key: `patch:${index}`,
			path: paths[1],
			side: "document",
			revision: capture.identity.patchHash,
			content: text,
			complete: true,
			provenance: "recorded",
			representation: "unified-patch",
			omission: captured
				? `Patch offsets only; originals for old=${JSON.stringify(paths[0])}, new=${JSON.stringify(paths[1])} are captured separately.`
				: `Originals not captured: old=${JSON.stringify(paths[0])}, new=${JSON.stringify(paths[1])}.`,
		});
		if (!captured)
			diagnostics.push(
				warning(
					"source_unavailable",
					`Original-file context unavailable for ${paths[1]}; patch evidence remains available.`,
				),
			);
	}
	if (scopedPath && !sources.length) throw new AiSnapshotError("missing");
	// Originals ride alongside the patch sources; a scoped context keeps only
	// the ones for its path, and any unsafe path is refused outright.
	for (const source of originals) {
		if (!safePath(source.path, root)) throw new AiSnapshotError("invalid");
		if ((scopedPath || patchPaths) && !includedOriginalPaths.has(source.path))
			continue;
		sources.push(source);
	}
	return {
		context: { ...input, patch: patches.join("") },
		snapshot: new ReviewSnapshot(
			capture.identity,
			sources,
			omissions,
			diagnostics,
		),
	};
}
