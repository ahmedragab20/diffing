import { buildAgentDiffIndex } from "../agent-diff-index.js";
import { warning, type AiDiagnostic } from "./diagnostics.js";
import type { EvidenceRange } from "./snapshot-prompt.js";
import type { ReviewSnapshot } from "./snapshots.js";
import type { AiDiffContext } from "./types.js";

export interface EvidenceUnit {
	id: string;
	hunkId: string;
	path: string;
	ranges: EvidenceRange[];
	estimatedBytes: number;
}
export interface EvidencePlan {
	units: EvidenceUnit[];
	diagnostics: AiDiagnostic[];
}

/** Merge overlapping ranges without converting patch offsets to source lines. */
export function mergeEvidenceRanges(ranges: EvidenceRange[]): EvidenceRange[] {
	const grouped = new Map<string, EvidenceRange[]>();
	for (const range of ranges) {
		const group = grouped.get(range.key) ?? [];
		group.push({ ...range });
		grouped.set(range.key, group);
	}
	return [...grouped.values()].flatMap((group) => {
		group.sort((a, b) => a.startLine - b.startLine);
		const result: EvidenceRange[] = [];
		for (const range of group) {
			const previous = result[result.length - 1];
			if (previous && range.startLine <= previous.endLine + 1)
				previous.endLine = Math.max(previous.endLine, range.endLine);
			else result.push(range);
		}
		return result;
	});
}

/** Deterministic inventory; merely planning a range never counts as model evidence. */
export function planDiffEvidence(
	snapshot: ReviewSnapshot,
	context?: AiDiffContext,
): EvidencePlan {
	const sources = snapshot.manifest.sources;
	const diagnostics: AiDiagnostic[] = [];
	const units: EvidenceUnit[] = [];
	const priorities = new Map<string, number>();
	const selections = [...(context?.selections ?? [])];
	if (context?.filePath && context.side && context.startLine && context.endLine)
		selections.push({
			filePath: context.filePath,
			side: context.side,
			startLine: context.startLine,
			endLine: context.endLine,
			selectedText: context.selectedText ?? "",
		});
	const originals = new Map(
		sources
			.filter((source) => source.representation === "original" && source.hash)
			.map((source) => [`${source.side}:${source.path}`, source]),
	);
	const contents = new Map<string, readonly string[]>();
	const linesFor = (key: string) => {
		let lines = contents.get(key);
		if (!lines) {
			lines = snapshot.inspectSource(key);
			contents.set(key, lines);
		}
		return lines;
	};
	const estimate = (ranges: EvidenceRange[]) =>
		ranges.reduce(
			(total, range) =>
				total +
				Buffer.byteLength(
					linesFor(range.key)
						.slice(range.startLine - 1, range.endLine)
						.join("\n"),
					"utf8",
				) +
				2048 * Math.ceil((range.endLine - range.startLine + 1) / 200),
			0,
		);
	for (const source of sources) {
		if (
			source.representation !== "unified-patch" ||
			!source.hash ||
			!source.lines
		)
			continue;
		const lines = linesFor(source.key);
		const file = buildAgentDiffIndex(lines.join("\n"), 0).files[0];
		const headers = lines.flatMap((text, index) =>
			/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.test(text) ? [index] : [],
		);
		const starts = headers.length ? headers : [0];
		for (const [hunkIndex, start] of starts.entries()) {
			const end = starts[hunkIndex + 1] ?? lines.length;
			const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(lines[start]);
			let oldLine = Number(match?.[1] ?? 1);
			let newLine = Number(match?.[2] ?? 1);
			let cursor = start;
			let part = 0;
			while (cursor < end) {
				const from = cursor;
				const oldStart = oldLine;
				const newStart = newLine;
				let bytes = 0;
				while (cursor < end && cursor - from < 128) {
					const cost = Buffer.byteLength(lines[cursor], "utf8") + 1;
					if (cost > 12 * 1024) {
						if (cursor > from) break;
						diagnostics.push({
							...warning(
								"evidence_excluded",
								`Patch line exceeds the review packet limit: ${source.path} L${cursor + 1}`,
							),
							sourceId: source.id,
							startLine: cursor + 1,
							endLine: cursor + 1,
						});
						if (lines[cursor].startsWith(" ") || lines[cursor].startsWith("-"))
							oldLine++;
						if (lines[cursor].startsWith(" ") || lines[cursor].startsWith("+"))
							newLine++;
						cursor++;
						break;
					}
					if (bytes + cost > 12 * 1024) break;
					bytes += cost;
					if (match && cursor > start) {
						if (lines[cursor].startsWith(" ") || lines[cursor].startsWith("-"))
							oldLine++;
						if (lines[cursor].startsWith(" ") || lines[cursor].startsWith("+"))
							newLine++;
					}
					cursor++;
				}
				if (!bytes) continue;
				const ranges: EvidenceRange[] = [
					{ key: source.key, startLine: from + 1, endLine: cursor },
				];
				// Include the patch's file metadata and hunk heading for continuations.
				if (headers.length)
					ranges.push(
						{
							key: source.key,
							startLine: 1,
							endLine: Math.min(headers[0], 20) || 1,
						},
						{ key: source.key, startLine: start + 1, endLine: start + 1 },
					);
				if (match && file) {
					for (const [side, path, first, last] of [
						["old", file.oldPath, oldStart, oldLine],
						["new", file.newPath, newStart, newLine],
					] as const) {
						const original = originals.get(`${side}:${path}`);
						if (!original?.lines) continue;
						const startLine = Math.max(1, first - 12);
						const endLine = Math.min(original.lines, Math.max(first, last - 1) + 12);
						if (startLine <= endLine)
							ranges.push({ key: original.key, startLine, endLine });
					}
				}
				const merged = mergeEvidenceRanges(ranges);
				const hunkId = headers.length ? `${source.key}:h${hunkIndex}` : "";
				const id = `${source.key}:h${hunkIndex}:p${part++}`;
				priorities.set(
					id,
					Number(
						selections.some((selection) => {
							const old = selection.side === "deletions";
							const path = old ? file?.oldPath : file?.newPath;
							const first = old ? oldStart : newStart;
							const last = old ? oldLine : newLine;
							return (
								selection.filePath === path &&
								selection.startLine <= Math.max(first, last - 1) &&
								selection.endLine >= first
							);
						}),
					),
				);
				units.push({
					id,
					hunkId,
					path: source.path,
					ranges: merged,
					estimatedBytes: estimate(merged),
				});
			}
		}
	}
	const selectedPaths = new Set(
		context?.selections?.map((selection) => selection.filePath),
	);
	if (context?.filePath) selectedPaths.add(context.filePath);
	units.sort(
		(a, b) =>
			(priorities.get(b.id) ?? 0) - (priorities.get(a.id) ?? 0) ||
			Number(selectedPaths.has(b.path)) - Number(selectedPaths.has(a.path)),
	);
	return { units, diagnostics };
}

export function evidenceBatches(
	units: EvidenceUnit[],
	maxBytes = 40 * 1024,
): EvidenceUnit[][] {
	const batches: EvidenceUnit[][] = [];
	let batch: EvidenceUnit[] = [];
	let bytes = 0;
	for (const unit of units) {
		if (batch.length && bytes + unit.estimatedBytes > maxBytes) {
			batches.push(batch);
			batch = [];
			bytes = 0;
		}
		batch.push(unit);
		bytes += unit.estimatedBytes;
	}
	if (batch.length) batches.push(batch);
	return batches;
}
