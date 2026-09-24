import { REVIEW_STORE_LIMITS } from "./review-store-contract.js";
import { z } from "zod";
import { reviewCommandSchema, reviewRequestSchema, reviewAcknowledgementSchema } from "./review-core-contract.js";
import { reviewActorSchema, reviewIdentitySchema, reviewPermissionSchema, type ReviewPermission } from "./review-identity.js";

export const REVIEW_PROTOCOL_VERSION = 1;
export const REVIEW_BATCH_LIMIT = 25;
export const reviewOperationNameSchema = z.enum(reviewCommandSchema.options.map((command) => command.shape.op.value));
export type ReviewOperationName = z.infer<typeof reviewOperationNameSchema>;

const decisionOperations = new Set<ReviewOperationName>(["comment.resolve", "comment.reopen", "decision.record", "handoff.cancel", "handoff.expire", "handoff.reclaim"]);
export const reviewOperations = Object.fromEntries(reviewCommandSchema.options.map((input) => {
  const name = input.shape.op.value;
  const permission: ReviewPermission = name === "capture" ? "capture" : decisionOperations.has(name) ? "decide" : name === "handoff.create" ? "handoff" : name.startsWith("handoff.") ? "work" : "comment";
  return [name, { name, input, output: reviewAcknowledgementSchema, permission, snapshot: name !== "capture", idempotency: "request-id-and-payload" as const,
    protocolVersion: REVIEW_PROTOCOL_VERSION, scope: name === "capture" ? "workspace" : "retained-snapshot",
    preconditions: ["authenticated-grant", "matching-review", "expected-version", ...(name === "capture" ? [] : ["recorded-snapshot"]), ...(name.startsWith("handoff.") ? ["handoff-state-and-claim"] : [])],
    errors: ["invalid_request", "unauthenticated", "forbidden", "wrong_review", "version_conflict", "stale_snapshot", "snapshot_expired", "idempotency_conflict", "outcome_unknown"],
    limits: { requestBytes: REVIEW_STORE_LIMITS.recordBytes, responseBytes: REVIEW_STORE_LIMITS.replayBytes },
  }];
})) as unknown as Record<ReviewOperationName, { name: ReviewOperationName; input: z.ZodType; output: typeof reviewAcknowledgementSchema; permission: ReviewPermission; snapshot: boolean; idempotency: "request-id-and-payload"; protocolVersion: number; scope: string; preconditions: string[]; errors: string[]; limits: { requestBytes: number; responseBytes: number } }>;

export const reviewRecoverySchema = z.enum(["fix_request", "reconnect", "request_permission", "refresh_state", "capture_source", "retry_same_request", "read_events", "read_only_recovery", "upgrade_client", "use_review_core_operations"]);
export const reviewFailureSchema = z.object({
  code: z.string().regex(/^[a-z_]+$/).max(80),
  recovery: reviewRecoverySchema,
  sequence: z.number().int().nonnegative().optional(),
}).strict();
export function reviewRecovery(code: string): z.infer<typeof reviewRecoverySchema> {
  if (["unauthenticated", "credential_expired", "connection_failed"].includes(code)) return "reconnect";
  if (code === "forbidden") return "request_permission";
  if (["snapshot_expired", "stale_snapshot", "inconsistent_capture", "incomplete_capture", "source_unavailable"].includes(code)) return "capture_source";
  if (["outcome_unknown", "internal_error"].includes(code)) return "retry_same_request";
  if (["version_conflict", "claim_conflict", "invalid_transition", "not_found"].includes(code)) return "refresh_state";
  if (["unsupported_version", "unknown_operation"].includes(code)) return "upgrade_client";
  if (["review_core_required", "review_core_disabled"].includes(code)) return "use_review_core_operations";
  if (["corrupt_review", "corrupt_store", "missing_store", "io_error", "migration_required", "owner_busy", "native_unavailable", "store_limit"].includes(code)) return "read_only_recovery";
  if (code === "response_too_large") return "read_events";
  return "fix_request";
}

export const reviewCapabilitiesSchema = z.object({
  protocolVersion: z.literal(REVIEW_PROTOCOL_VERSION), identity: reviewIdentitySchema,
  actor: reviewActorSchema, permissions: z.array(reviewPermissionSchema),
  operations: z.array(z.object({ name: reviewOperationNameSchema, permission: reviewPermissionSchema, snapshot: z.boolean(), idempotency: z.literal("request-id-and-payload") }).strict()),
  batch: z.object({ mode: z.literal("per-item"), limit: z.literal(REVIEW_BATCH_LIMIT), order: z.literal("sequential"), onError: z.literal("continue") }).strict(),
}).strict();
export type ReviewCapabilities = z.infer<typeof reviewCapabilitiesSchema>;
export const reviewNextActionsSchema = z.object({
  identity: reviewIdentitySchema, version: z.number().int().nonnegative(), snapshotId: z.uuid().nullable(),
  actions: z.array(z.object({ operation: reviewOperationNameSchema, handoffId: z.uuid().optional() }).strict()),
  requiresServerValidation: z.literal(true),
}).strict();
export const reviewBatchRequestSchema = z.object({ version: z.literal(1), mode: z.literal("per-item"), requests: z.array(reviewRequestSchema).min(1).max(REVIEW_BATCH_LIMIT) }).strict();
export const reviewBatchResultSchema = z.object({
  version: z.literal(1), mode: z.literal("per-item"),
  results: z.array(z.discriminatedUnion("ok", [
    z.object({ requestId: z.string().min(1).max(200), ok: z.literal(true), acknowledgement: reviewAcknowledgementSchema }).strict(),
    z.object({ requestId: z.string().min(1).max(200), ok: z.literal(false), error: reviewFailureSchema }).strict(),
  ])).min(1).max(REVIEW_BATCH_LIMIT),
}).strict();
