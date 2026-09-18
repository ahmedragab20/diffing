import { z } from "zod";
import { inspectionManifestSchema } from "./inspect-capture-contract.js";
import { persistedReviewCommentSchema } from "./comment-schema.js";
import { reviewActorSchema, reviewIdentitySchema } from "./review-identity.js";
import { sourceAnchorSchema } from "./source-anchor.js";
import { LEGACY_CHUNK_BYTES, legacyChunkSchema, legacyCommitSchema, legacySourceSchema, type LegacySummary } from "./review-legacy-contract.js";
import { reviewTransactionSchema } from "./review-store-contract.js";

export const REVIEW_CREDENTIAL_HEADER = "X-Diffing-Review-Credential";

const id = z.uuid();
const text = z.string().min(1).max(64 * 1024);
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const coordinates = {
  fileIndex: sequence,
  side: z.enum(["additions", "deletions"]),
  lineNumber: sequence,
  startLineNumber: z.number().int().positive().optional(),
};
const claim = { handoffId: id, claimId: id, epoch: sequence };

export const reviewCommandSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("capture") }).strict(),
  z.object({ op: z.literal("comment.add"), ...coordinates, body: text }).strict(),
  z.object({ op: z.literal("comment.reply"), commentId: z.string().min(1).max(200), body: text }).strict(),
  z.object({ op: z.literal("comment.resolve"), commentId: z.string().min(1).max(200), reason: text }).strict(),
  z.object({ op: z.literal("comment.reopen"), commentId: z.string().min(1).max(200), reason: text }).strict(),
  z.object({ op: z.literal("comment.edit"), commentId: z.string().min(1).max(200), body: text }).strict(),
  z.object({ op: z.literal("comment.delete"), commentId: z.string().min(1).max(200) }).strict(),
  z.object({ op: z.literal("reply.edit"), commentId: z.string().min(1).max(200), replyId: z.string().min(1).max(200), body: text }).strict(),
  z.object({ op: z.literal("reply.delete"), commentId: z.string().min(1).max(200), replyId: z.string().min(1).max(200) }).strict(),
  z.object({ op: z.literal("view.mark"), fileIndex: sequence, viewed: z.boolean() }).strict(),
  z.object({ op: z.literal("handoff.create"), recipient: z.string().min(1).max(200), instructions: text, commentIds: z.array(z.string().min(1).max(200)).max(1000) }).strict(),
  z.object({ op: z.literal("handoff.claim"), handoffId: id }).strict(),
  z.object({ op: z.literal("handoff.start"), ...claim }).strict(),
  z.object({ op: z.literal("handoff.result"), ...claim, resultSnapshotId: id, body: text }).strict(),
  z.object({ op: z.literal("handoff.fail"), ...claim, outcome: z.enum(["failed", "outcome-unknown"]), reason: text }).strict(),
  z.object({ op: z.literal("handoff.cancel"), handoffId: id, reason: text }).strict(),
  z.object({ op: z.literal("handoff.cancel-confirm"), ...claim }).strict(),
  z.object({ op: z.literal("handoff.expire"), handoffId: id, reason: text }).strict(),
  z.object({ op: z.literal("handoff.reclaim"), handoffId: id, recipient: z.string().min(1).max(200), reason: text }).strict(),
  z.object({ op: z.literal("decision.record"), decision: z.enum(["approved", "changes-requested", "rejected", "comment-only"]), rationale: text, handoffId: id.optional() }).strict(),
]);
export type ReviewCommand = z.infer<typeof reviewCommandSchema>;

/** Actor and authority fields are deliberately absent from client input. */
export const reviewRequestSchema = reviewIdentitySchema.extend({
  version: z.literal(1),
  requestId: z.string().min(1).max(200),
  expectedVersion: sequence,
  snapshotId: id.nullable(),
  command: reviewCommandSchema,
}).strict();
export type ReviewRequest = z.infer<typeof reviewRequestSchema>;

/** The persisted acknowledgement is validated on both commit and replay. */
export const reviewOperationResultSchema = z.object({
  identity: reviewIdentitySchema,
  snapshotId: id,
  actor: reviewActorSchema,
  operation: z.enum(reviewCommandSchema.options.map((command) => command.shape.op.value)),
  id: z.string().min(1).max(200).nullable(),
  sequence: sequence.refine((value) => value > 0),
}).strict();
export type ReviewOperationResult = z.infer<typeof reviewOperationResultSchema>;

export const durableHandoffSchema = z.object({
  id, round: sequence, snapshotId: id, actor: reviewActorSchema,
  recipient: z.string().min(1).max(200), instructions: text,
  commentIds: z.array(z.string().min(1).max(200)).max(1000),
  sentAt: sequence,
  status: z.enum(["available", "acknowledged", "working", "awaiting-human", "reviewed", "cancellation-requested", "cancelled", "failed", "expired", "outcome-unknown"]),
  epoch: sequence,
  claim: z.object({ id, actorId: z.string().min(1).max(200), acknowledgedAt: sequence }).strict().optional(),
  result: z.object({ id, snapshotId: id, actor: reviewActorSchema, body: text, submittedAt: sequence }).strict().optional(),
  reason: text.optional(),
}).strict();
export type DurableHandoff = z.infer<typeof durableHandoffSchema>;

export const durableDecisionSchema = z.object({
  id, snapshotId: id, actor: reviewActorSchema,
  decision: z.enum(["approved", "changes-requested", "rejected", "comment-only"]),
  rationale: text, decidedAt: sequence, handoffId: id.optional(),
}).strict();
export type DurableDecision = z.infer<typeof durableDecisionSchema>;

export const anchoredCommentSchema = persistedReviewCommentSchema.extend({ sourceAnchor: sourceAnchorSchema, actor: reviewActorSchema });
export type AnchoredComment = z.infer<typeof anchoredCommentSchema>;
export const durableCommentSchema = persistedReviewCommentSchema.extend({
  sourceAnchor: sourceAnchorSchema.optional(), actor: reviewActorSchema,
  provenance: z.enum(["recorded", "legacy-unverified"]).optional(),
}).superRefine((comment, ctx) => {
  if (comment.provenance !== "legacy-unverified" && !comment.sourceAnchor) ctx.addIssue({ code: "custom", path: ["sourceAnchor"], message: "Recorded comments require a source anchor." });
});
export type DurableComment = z.infer<typeof durableCommentSchema>;

const effectSchema = z.discriminatedUnion("type", [
  legacyChunkSchema,
  legacyCommitSchema,
  z.object({ type: z.literal("review.opened"), identity: reviewIdentitySchema }).strict(),
  z.object({ type: z.literal("snapshot.captured"), manifest: inspectionManifestSchema, fingerprints: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)) }).strict(),
  z.object({ type: z.literal("comment.recorded"), comment: durableCommentSchema }).strict(),
  z.object({ type: z.literal("comment.deleted"), commentId: z.string().min(1).max(200) }).strict(),
  z.object({ type: z.literal("view.recorded"), anchor: sourceAnchorSchema, viewed: z.boolean() }).strict(),
  z.object({ type: z.literal("handoff.recorded"), handoff: durableHandoffSchema }).strict(),
  z.object({ type: z.literal("decision.recorded"), decision: durableDecisionSchema }).strict(),
]);

export const reviewCoreEventSchema = z.object({
  version: z.literal(1), identity: reviewIdentitySchema, actor: reviewActorSchema,
  snapshotId: id.nullable(), at: sequence, effect: effectSchema,
}).strict();
export type ReviewCoreEvent = z.infer<typeof reviewCoreEventSchema>;

export interface DurableReviewState {
  identity: z.infer<typeof reviewIdentitySchema>;
  version: number;
  currentSnapshotId: string | null;
  snapshots: Array<{ manifest: z.infer<typeof inspectionManifestSchema>; fingerprints: Record<string, string> }>;
  comments: DurableComment[];
  viewed: Array<{ anchor: z.infer<typeof sourceAnchorSchema>; actor: z.infer<typeof reviewActorSchema> }>;
  handoffs: DurableHandoff[];
  decisions: DurableDecision[];
  legacy: LegacySummary | null;
  migrationPending: boolean;
}

const snapshotSchema = z.object({
  manifest: inspectionManifestSchema,
  fingerprints: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
}).strict();
const freshness = z.enum(["current", "stale", "unverified"]);
const anchorFreshness = {
  status: freshness,
  reason: z.enum(["same_source", "workspace_changed", "scope_changed", "revision_changed", "source_changed", "source_missing", "incomplete_capture", "legacy_anchor", "snapshot_expired", "legacy"]),
};
export const reviewStateSchema = z.object({
  identity: reviewIdentitySchema,
  version: sequence,
  currentSnapshotId: id.nullable(),
  snapshots: z.array(snapshotSchema),
  comments: z.array(durableCommentSchema),
  viewed: z.array(z.object({ anchor: sourceAnchorSchema, actor: reviewActorSchema }).strict()),
  handoffs: z.array(durableHandoffSchema),
  decisions: z.array(durableDecisionSchema),
  legacy: z.object({
    id: z.string().regex(/^[a-f0-9]{64}$/), sources: z.array(legacySourceSchema.omit({ base64: true })).max(3),
    comments: sequence, plans: sequence, viewedScopes: sequence,
    provenance: z.literal("legacy-unverified"), history: z.literal("not-persisted-by-legacy-session"),
  }).strict().nullable(),
  migrationPending: z.boolean(),
  freshness: z.literal("not-checked"),
  commentFreshness: z.array(z.object({ id: z.string().min(1), ...anchorFreshness }).strict()),
  viewedFreshness: z.array(z.object({ anchor: sourceAnchorSchema, ...anchorFreshness }).strict()),
  decisionFreshness: z.array(z.object({ id, status: freshness }).strict()),
}).strict();
export type ReviewState = z.infer<typeof reviewStateSchema>;

export const reviewHandoffPayloadSchema = z.object({
  identity: reviewIdentitySchema, version: sequence, handoff: durableHandoffSchema,
  sent: z.object({ sequence: sequence.refine((value) => value > 0), handoff: durableHandoffSchema, comments: z.array(durableCommentSchema), snapshot: snapshotSchema }).strict(),
}).strict();
export type ReviewHandoffPayload = z.infer<typeof reviewHandoffPayloadSchema>;

/** Read-only original bytes; recorded legacy decisions carry no new authority. */
export const reviewLegacySourcePageSchema = z.object({
  identity: reviewIdentitySchema,
  provenance: z.literal("legacy-unverified"),
  source: legacySourceSchema.omit({ base64: true }),
  offset: sequence,
  next: sequence.nullable(),
  base64: z.string().max(LEGACY_CHUNK_BYTES / 3 * 4),
}).strict();
export type ReviewLegacySourcePage = z.infer<typeof reviewLegacySourcePageSchema>;

export const reviewEventsSchema = z.object({
  identity: reviewIdentitySchema, latest: sequence, next: sequence.nullable(),
  records: z.array(reviewTransactionSchema.extend({
    events: z.array(z.object({ type: z.literal("review.core"), data: reviewCoreEventSchema }).strict()).max(100),
  })).max(1000),
}).strict();
export type ReviewEvents = z.infer<typeof reviewEventsSchema>;

export const reviewAcknowledgementSchema = z.object({
  version: z.literal(1), sequence: sequence.refine((value) => value > 0), result: reviewOperationResultSchema,
}).strict().refine((value) => value.sequence === value.result.sequence, "Acknowledgement sequence must match its result");
export type ReviewAcknowledgement = z.infer<typeof reviewAcknowledgementSchema>;
