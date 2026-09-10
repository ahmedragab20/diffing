import { warning, type AiDiagnostic } from "./diagnostics.js";
import {
	AiSnapshotError,
	type ReviewSnapshot,
	type AiEvidenceReference,
} from "./snapshots.js";

export interface EvidenceRange {
	key: string;
	startLine: number;
	endLine: number;
}

/** Every issued range appears verbatim below. Never truncate after issuing a read. */
export function renderSnapshotEvidence(
	snapshot: ReviewSnapshot,
	budget: number,
	ranges?: EvidenceRange[],
) {
	const manifest = snapshot.manifest;
	const references: AiEvidenceReference[] = [];
	const blocks: string[] = [];
	const diagnostics: AiDiagnostic[] = [
		...(manifest.diagnostics ??
			manifest.omissions.map((message) => warning("upstream_omission", message))),
	];
	let remaining = Math.max(0, Math.floor(budget));
	const requested =
		ranges ??
		manifest.sources.map((source) => ({
			key: source.key,
			startLine: 1,
			endLine: source.lines,
		}));
	const sources = new Map(
		manifest.sources.map((source) => [source.key, source]),
	);
	for (const [index, range] of requested.entries()) {
		const source = sources.get(range.key);
		if (!source) throw new AiSnapshotError("missing");
		let grant = Math.floor(remaining / (requested.length - index));
		const heading = `\n\nSource ${JSON.stringify({
			source: source.id,
			path: source.path,
			side: source.side,
			revision: source.revision,
			provenance: source.provenance,
			representation: source.representation ?? "document",
			...(source.key === "body-draft"
				? { label: "Unsubmitted plan text (draft, not stored evidence)" }
				: {}),
		})}\n`;
		const reserved = Buffer.byteLength(heading, "utf8") + 1024;
		let nextLine = range.startLine;
		if (!source.hash || source.lines === 0) {
			const block = `${heading}${source.hash ? "[Empty captured source]" : "[Source omitted: original unavailable]"}`;
			const cost = Buffer.byteLength(block, "utf8");
			if (cost <= grant) {
				blocks.push(block);
				remaining -= cost;
			} else
				diagnostics.push(
					warning(
						"evidence_excluded",
						`Source description did not fit: ${source.path}`,
					),
				);
			if (!source.hash)
				diagnostics.push({
					...warning(
						"source_unavailable",
						source.omission ?? `Source unavailable: ${source.path}`,
					),
					sourceId: source.id,
				});
			continue;
		}
		while (nextLine <= range.endLine && grant > reserved) {
			try {
				const page = snapshot.read(
					source.key,
					nextLine,
					range.endLine,
					Math.min(256 * 1024, grant - reserved),
				);
				const block = `${heading}Evidence ${JSON.stringify(page.evidence)}\n${page.text}`;
				const cost = Buffer.byteLength(block, "utf8");
				if (cost > grant) throw new AiSnapshotError("invalid");
				blocks.push(block);
				references.push(page.evidence);
				grant -= cost;
				remaining -= cost;
				nextLine = page.evidence.endLine + 1;
			} catch (error) {
				if (!(error instanceof AiSnapshotError) || error.code !== "limit")
					throw error;
				break;
			}
		}
		if (nextLine <= range.endLine)
			diagnostics.push({
				...warning(
					"evidence_excluded",
					`Evidence not included: ${source.path} L${nextLine}–${range.endLine}`,
				),
				sourceId: source.id,
				startLine: nextLine,
				endLine: range.endLine,
			});
		if (!source.complete)
			diagnostics.push({
				...warning(
					"source_unavailable",
					source.omission ?? `Captured source is incomplete: ${source.path}`,
				),
				sourceId: source.id,
			});
	}
	return {
		text: blocks.join(""),
		references,
		diagnostics,
		truncated: diagnostics.some(
			(diagnostic) => diagnostic.severity === "warning",
		),
		coverage: {
			basis: "lines-in-this-prompt" as const,
			returnedLines: references.reduce(
				(sum, ref) => sum + ref.endLine - ref.startLine + 1,
				0,
			),
			availableLines: manifest.sources.reduce(
				(sum, source) => sum + source.lines,
				0,
			),
			readSourceCount: new Set(references.map((ref) => ref.sourceId)).size,
			sourceCount: manifest.sources.length,
			omittedSourceCount: manifest.sources.filter(
				(source) => !source.hash || !source.complete,
			).length,
		},
	};
}
