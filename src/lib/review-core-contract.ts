import { z } from "zod";
import { inspectionManifestSchema } from "./inspect-capture.js";
import { persistedReviewCommentSchema } from "./comment-schema.js";
import { reviewActorSchema, reviewIdentitySchema } from "./review-authority.js";
import { sourceAnchorSchema } from "./source-anchor.js";

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
  id: id.nullable(),
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

const effectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("review.opened"), identity: reviewIdentitySchema }).strict(),
  z.object({ type: z.literal("snapshot.captured"), manifest: inspectionManifestSchema, fingerprints: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)) }).strict(),
  z.object({ type: z.literal("comment.recorded"), comment: anchoredCommentSchema }).strict(),
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
  comments: AnchoredComment[];
  viewed: Array<{ anchor: z.infer<typeof sourceAnchorSchema>; actor: z.infer<typeof reviewActorSchema> }>;
  handoffs: DurableHandoff[];
  decisions: DurableDecision[];
}
