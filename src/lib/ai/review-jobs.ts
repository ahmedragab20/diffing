import { randomUUID } from "node:crypto";
import { z } from "zod";
import { buildAiPrompt } from "./context.js";
import { AiRunError } from "./lifecycle.js";
import {
	evidenceBatches,
	mergeEvidenceRanges,
	planDiffEvidence,
	type EvidenceUnit,
} from "./evidence-plan.js";
import {
	AiSnapshotError,
	ReviewSnapshot,
	type AiEvidenceReference,
	type SnapshotSourceInput,
} from "./snapshots.js";
import type { AiRunRequest } from "./types.js";
import type { AiDiagnostic } from "./diagnostics.js";

export interface ReviewCapture {
	revision: string;
	groupCount: number;
	totalHunks: number;
	diagnostics?: AiDiagnostic[];
	load(index: number, signal: AbortSignal): Promise<ReviewSnapshot>;
	assertFresh(signal: AbortSignal): Promise<void>;
}
export interface AiReviewStatus {
	jobId: string;
	state:
		| "awaiting-confirmation"
		| "running"
		| "partial"
		| "complete"
		| "cancelled"
		| "stale"
		| "failed"
		| "exhausted";
	estimatedBatches: number;
	completedBatches: number;
	totalHunks: number;
	suppliedHunks: number;
	processedHunks: number;
	pendingGroups: number;
	calls: number;
	canContinue: boolean;
	gapCount: number;
}

const finding = z
	.object({
		title: z.string().min(1).max(200),
		body: z.string().min(1).max(2048),
		evidenceIds: z.array(z.string().uuid()).min(1).max(8),
	})
	.strict();
const response = z
	.object({
		findings: z.array(finding).max(16),
		questions: z.array(finding).max(8),
	})
	.strict();
type Finding = z.infer<typeof finding>;
interface StoredFinding extends Finding {
	snapshot: ReviewSnapshot;
	references: AiEvidenceReference[];
}
interface Batch {
	snapshot: ReviewSnapshot;
	units: EvidenceUnit[];
}
export const REVIEW_JOB_LIMITS = Object.freeze({
	automaticCalls: 3,
	callsPerContinuation: 4,
	totalCalls: 32,
	snapshotBytes: 32 * 1024 * 1024,
	resultBytes: 512 * 1024,
	ttlMs: 10 * 60_000,
	retainedJobs: 2,
});
const instruction =
	'This is an internal bounded risk-review pass. Return ONLY a JSON object with exactly {"findings":[{"title":"...","body":"...","evidenceIds":["exact supplied evidence UUID"]}],"questions":[]}. Questions use the same shape. Include only concrete findings supported by the supplied evidence; empty arrays are valid. Every finding or unresolved cross-file question requires at least one supplied evidence ID. Do not claim coverage beyond this packet.';

export class ReviewJob {
	readonly id = randomUUID();
	readonly createdAt = Date.now();
	private group = 0;
	private queue: Batch[] = [];
	private snapshots: ReviewSnapshot[] = [];
	private bytes = 0;
	private findings: StoredFinding[] = [];
	private questions: StoredFinding[] = [];
	private supplied = new Set<string>();
	private processed = new Set<string>();
	private hunkUnits = new Map<string, Set<string>>();
	private gaps = new Set<string>();
	private batches = 0;
	private calls = 0;
	private synthesized = false;
	private state: AiReviewStatus["state"] = "awaiting-confirmation";
	constructor(
		readonly request: AiRunRequest,
		readonly capture: ReviewCapture,
	) {
		for (const diagnostic of capture.diagnostics ?? [])
			if (diagnostic.severity === "warning") this.gaps.add(diagnostic.message);
	}

	status(): AiReviewStatus {
		const processedHunks = [...this.hunkUnits.values()].filter((units) =>
			[...units].every((id) => this.processed.has(id)),
		).length;
		return {
			jobId: this.id,
			state: this.state,
			estimatedBatches:
				this.batches + this.queue.length + this.capture.groupCount - this.group,
			completedBatches: this.batches,
			totalHunks: this.capture.totalHunks,
			suppliedHunks: this.supplied.size,
			processedHunks,
			pendingGroups: this.capture.groupCount - this.group,
			calls: this.calls,
			canContinue:
				!this.synthesized &&
				this.calls < REVIEW_JOB_LIMITS.totalCalls &&
				this.state !== "stale" &&
				this.state !== "exhausted",
			gapCount: this.gaps.size,
		};
	}

	private retain(snapshot: ReviewSnapshot): void {
		const size = snapshot.manifest.sources.reduce(
			(sum, source) => sum + source.bytes,
			0,
		);
		if (this.bytes + size > REVIEW_JOB_LIMITS.snapshotBytes)
			throw new AiSnapshotError("limit");
		this.snapshots.push(snapshot);
		this.bytes += size;
	}

	private parse(
		text: string,
		snapshot: ReviewSnapshot,
		references: AiEvidenceReference[],
	) {
		let parsed: z.infer<typeof response>;
		try {
			parsed = response.parse(
				JSON.parse(
					text
						.trim()
						.replace(/^```(?:json)?\s*\n/, "")
						.replace(/\n```$/, ""),
				),
			);
		} catch {
			throw new AiRunError("protocol_error");
		}
		const refs = new Map(references.map((ref) => [ref.id, ref]));
		const checked = (entry: Finding): StoredFinding => ({
			...entry,
			snapshot,
			references: entry.evidenceIds.map((id) => {
				const ref = refs.get(id);
				if (!ref) throw new AiSnapshotError("invalid");
				snapshot.verify(ref, snapshot.manifest.revision);
				return ref;
			}),
		});
		return {
			findings: parsed.findings.map(checked),
			questions: parsed.questions.map(checked),
		};
	}

	private result(): string {
		const status = this.status();
		const heading =
			status.state === "complete"
				? "## Risk review results"
				: "## Partial risk review";
		const rows = this.findings.map((item) => {
			const anchors = item.references.map((ref) => {
				const source = item.snapshot.manifest.sources.find(
					(source) => source.id === ref.sourceId,
				)!;
				return `${source.path} (${source.side}, ${source.representation === "unified-patch" ? "patch offsets" : "source lines"} ${ref.startLine}–${ref.endLine}; evidence ${ref.id})`;
			});
			return `### ${item.title}\n${item.body}\n\nEvidence: ${anchors.join("; ")}`;
		});
		return [
			heading,
			`${status.processedHunks}/${status.totalHunks} changed hunks processed in ${status.completedBatches} batches. These counters describe supplied evidence and successful passes, not model attention or correctness.`,
			...rows,
			rows.length
				? ""
				: "No validated findings have been returned so far. This is not a guarantee that the change is safe.",
			this.questions.length
				? `${this.questions.length} cross-file questions remain unresolved.`
				: "",
			...[...this.gaps].slice(0, 12),
			status.canContinue
				? "Continue this review explicitly to process pending work. Each continuation permits at most four additional provider calls."
				: "",
		]
			.filter(Boolean)
			.join("\n\n");
	}

	async run(
		confirmed: boolean,
		signal: AbortSignal,
		call: (request: AiRunRequest) => Promise<string>,
		emit: (status: AiReviewStatus) => Promise<void>,
	): Promise<string> {
		const budget = confirmed
			? REVIEW_JOB_LIMITS.callsPerContinuation
			: REVIEW_JOB_LIMITS.automaticCalls;
		let used = 0;
		try {
			signal.throwIfAborted();
			if (!this.status().canContinue)
				throw new AiSnapshotError(this.state === "stale" ? "stale" : "limit");
			await this.capture.assertFresh(signal);
			if (!confirmed && this.capture.groupCount > 1) {
				this.state = "awaiting-confirmation";
				await emit(this.status());
				return this.result();
			}
			this.state = "running";
			await emit(this.status());
			while (
				used < budget &&
				this.calls < REVIEW_JOB_LIMITS.totalCalls &&
				!this.synthesized
			) {
				signal.throwIfAborted();
				await this.capture.assertFresh(signal);
				if (!this.queue.length && this.group < this.capture.groupCount) {
					const snapshot = await this.capture.load(this.group, signal);
					this.retain(snapshot);
					const plan = planDiffEvidence(
						snapshot,
						this.request.context.kind === "diff" ? this.request.context : undefined,
					);
					for (const diagnostic of plan.diagnostics)
						this.gaps.add(diagnostic.message);
					for (const unit of plan.units) {
						if (!unit.hunkId) continue;
						const group = this.hunkUnits.get(unit.hunkId) ?? new Set();
						group.add(unit.id);
						this.hunkUnits.set(unit.hunkId, group);
					}
					this.queue.push(
						...evidenceBatches(plan.units).map((units) => ({
							snapshot,
							units,
						})),
					);
					this.group++;
					await emit(this.status());
					if (!this.queue.length) continue;
				}
				const batch = this.queue[0];
				if (!batch) {
					await this.synthesize(signal, call);
					used++;
					break;
				}
				const input: AiRunRequest = {
					...this.request,
					reviewCapture: undefined,
					reviewJobId: undefined,
					snapshotReader: batch.snapshot,
					snapshot: batch.snapshot.manifest,
					evidenceRanges: mergeEvidenceRanges(
						batch.units.flatMap((unit) => unit.ranges),
					),
					reviewInstruction: instruction,
					history: undefined,
				};
				const built = buildAiPrompt(input);
				for (const diagnostic of built.diagnostics)
					if (diagnostic.severity === "warning") this.gaps.add(diagnostic.message);
				const excluded =
					built.diagnostics.some(
						(diagnostic) => diagnostic.code === "evidence_excluded",
					) || planDiffEvidence(batch.snapshot).diagnostics.length > 0;
				for (const unit of batch.units)
					if (
						unit.hunkId &&
						built.evidence?.some(
							(ref) =>
								batch.snapshot.manifest.sources.find(
									(source) => source.id === ref.sourceId,
								)?.key === unit.ranges[0].key,
						)
					)
						this.supplied.add(unit.hunkId);
				this.calls++;
				used++;
				const result = this.parse(
					await call({
						...input,
						prompt: built.prompt,
						evidence: built.evidence,
					}),
					batch.snapshot,
					built.evidence ?? [],
				);
				if (
					Buffer.byteLength(
						JSON.stringify(
							[
								...this.findings,
								...result.findings,
								...this.questions,
								...result.questions,
							].map(({ snapshot: _snapshot, ...item }) => item),
						),
						"utf8",
					) > REVIEW_JOB_LIMITS.resultBytes
				)
					throw new AiSnapshotError("limit");
				this.findings.push(...result.findings);
				this.questions.push(...result.questions);
				if (!excluded) for (const unit of batch.units) this.processed.add(unit.id);
				this.queue.shift();
				this.batches++;
				await emit(this.status());
			}
			await this.capture.assertFresh(signal);
			this.state =
				this.calls >= REVIEW_JOB_LIMITS.totalCalls && !this.synthesized
					? "exhausted"
					: this.synthesized &&
							!this.gaps.size &&
							!this.questions.length &&
							this.status().processedHunks === this.capture.totalHunks
						? "complete"
						: "partial";
			await emit(this.status());
			return this.result();
		} catch (error) {
			this.state = signal.aborted
				? "cancelled"
				: error instanceof AiSnapshotError && error.code === "stale"
					? "stale"
					: error instanceof AiSnapshotError && error.code === "limit"
						? "exhausted"
						: "failed";
			if (!signal.aborted) await emit(this.status());
			throw error;
		}
	}

	private async synthesize(
		signal: AbortSignal,
		call: (request: AiRunRequest) => Promise<string>,
	): Promise<void> {
		const candidates = [...this.findings, ...this.questions];
		if (!this.snapshots.length || (!candidates.length && this.batches <= 1)) {
			this.synthesized = true;
			return;
		}
		const first = this.snapshots[0];
		const inputs = new Map<string, SnapshotSourceInput>();
		const ranges: { key: string; startLine: number; endLine: number }[] = [];
		for (const candidate of candidates)
			for (const ref of candidate.references) {
				const source = candidate.snapshot.manifest.sources.find(
					(source) => source.id === ref.sourceId,
				)!;
				if (!inputs.has(source.key))
					inputs.set(source.key, {
						key: source.key,
						path: source.path,
						side: source.side,
						revision: source.revision,
						content: candidate.snapshot.capturedText(source.key),
						complete: source.complete,
						provenance: source.provenance,
						representation: source.representation,
						omission: source.omission,
					});
				ranges.push({
					key: source.key,
					startLine: ref.startLine,
					endLine: ref.endLine,
				});
			}
		// Revisit changed neighborhoods even when individual passes found no issue:
		// a cross-file interaction can be invisible in any one packet.
		for (const captured of this.snapshots) {
			const planned = planDiffEvidence(captured);
			for (const range of mergeEvidenceRanges(
				planned.units.flatMap((unit) => unit.ranges),
			)) {
				const source = captured.manifest.sources.find(
					(source) => source.key === range.key,
				)!;
				if (!inputs.has(source.key))
					inputs.set(source.key, {
						key: source.key,
						path: source.path,
						side: source.side,
						revision: source.revision,
						content: captured.capturedText(source.key),
						complete: source.complete,
						provenance: source.provenance,
						representation: source.representation,
						omission: source.omission,
					});
				ranges.push(range);
			}
		}
		let snapshot: ReviewSnapshot;
		try {
			snapshot = new ReviewSnapshot(
				first.manifest.identity,
				[...inputs.values()],
				[],
				[],
			);
			this.retain(snapshot);
		} catch (error) {
			if (!(error instanceof AiSnapshotError) || error.code !== "limit")
				throw error;
			this.gaps.add(
				"Cross-file synthesis exceeded its capture budget; per-batch findings are retained.",
			);
			this.synthesized = true;
			return;
		}
		const notes = JSON.stringify(
			candidates.map(({ title, body }) => ({ title, body })),
		);
		if (Buffer.byteLength(notes) > 24 * 1024) {
			this.gaps.add(
				"Cross-file synthesis exceeded its notes budget; per-batch findings are retained.",
			);
			this.synthesized = true;
			return;
		}
		const input: AiRunRequest = {
			...this.request,
			reviewCapture: undefined,
			reviewJobId: undefined,
			snapshotReader: snapshot,
			snapshot: snapshot.manifest,
			evidenceRanges: mergeEvidenceRanges(ranges),
			history: undefined,
			reviewInstruction: `${instruction}\nCheck cross-file interactions in these changed neighborhoods, then revalidate and reconcile any prior findings. Empty prior findings do not mean the change is safe. Report unresolved cross-file questions rather than inventing unseen context.`,
			reviewNotes: notes,
		};
		const built = buildAiPrompt(input);
		if (
			built.diagnostics.some((diagnostic) => diagnostic.severity === "warning")
		) {
			this.gaps.add(
				"Cross-file synthesis could not include all referenced evidence; per-batch findings are retained.",
			);
			this.synthesized = true;
			return;
		}
		signal.throwIfAborted();
		this.calls++;
		const result = this.parse(
			await call({ ...input, prompt: built.prompt, evidence: built.evidence }),
			snapshot,
			built.evidence ?? [],
		);
		// Keep every validated per-batch finding: synthesis is additional verification,
		// not permission to silently erase a finding or its distinct anchors.
		const key = (entry: StoredFinding) =>
			JSON.stringify([
				entry.title,
				entry.body,
				entry.references
					.map((ref) => [
						entry.snapshot.manifest.sources.find(
							(source) => source.id === ref.sourceId,
						)?.key,
						ref.sourceHash,
						ref.startLine,
						ref.endLine,
					])
					.sort(),
			]);
		const seen = new Set(this.findings.map(key));
		for (const entry of result.findings)
			if (!seen.has(key(entry))) {
				this.findings.push(entry);
				seen.add(key(entry));
			}
		this.questions = result.questions;
		this.synthesized = true;
	}
}

export class ReviewJobStore {
	private jobs = new Map<string, ReviewJob>();
	private sweep() {
		for (const [id, job] of this.jobs)
			if (Date.now() - job.createdAt > REVIEW_JOB_LIMITS.ttlMs)
				this.jobs.delete(id);
	}
	create(request: AiRunRequest, capture: ReviewCapture): ReviewJob {
		this.sweep();
		if (this.jobs.size >= REVIEW_JOB_LIMITS.retainedJobs) {
			const retired = [...this.jobs].find(([, job]) => !job.status().canContinue);
			if (retired) this.jobs.delete(retired[0]);
			else throw new AiSnapshotError("limit");
		}
		const job = new ReviewJob({ ...request, reviewCapture: undefined }, capture);
		this.jobs.set(job.id, job);
		return job;
	}
	get(id: string, request: AiRunRequest): ReviewJob {
		this.sweep();
		const job = this.jobs.get(id);
		if (!job) throw new AiSnapshotError("missing");
		if (
			job.request.conversationId !== request.conversationId ||
			job.request.modelId !== request.modelId ||
			job.request.surface !== request.surface ||
			request.action !== "review-risks"
		)
			throw new AiSnapshotError("invalid");
		return job;
	}
}
