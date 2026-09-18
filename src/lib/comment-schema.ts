import { z } from "zod";
import { sourceAnchorSchema } from "./source-anchor.js";

const persistedCommentReplySchema = z.preprocess((value, ctx) => {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !("created_at" in value)) {
    return value;
  }
  const { created_at, ...reply } = value as Record<string, unknown>;
  if (reply.createdAt !== undefined && reply.createdAt !== created_at) {
    ctx.addIssue({ code: "custom", message: "Ambiguous reply timestamp" });
    return z.NEVER;
  }
  return { ...reply, createdAt: reply.createdAt ?? created_at };
}, z.object({
  id: z.string().min(1), body: z.string(), createdAt: z.number().finite(),
  role: z.enum(["user", "agent"]).optional(), model: z.string().optional(),
  createdAtPlanVersion: z.number().int().positive().optional(),
}).passthrough());

/** Legacy JSON authority validation; preserve unknown fields during upgrades. */
export const persistedReviewCommentSchema = z.object({
  id: z.string().min(1), filePath: z.string(), side: z.enum(["deletions", "additions"]),
  lineNumber: z.number().int().nonnegative(), startLineNumber: z.number().int().positive().optional(),
  lineContent: z.string(), body: z.string(), status: z.enum(["open", "resolved"]),
  createdAt: z.number().finite(), replies: z.array(persistedCommentReplySchema).refine(
    (replies) => new Set(replies.map((reply) => reply.id)).size === replies.length,
    "Duplicate reply IDs",
  ),
  severity: z.enum(["blocking", "nit", "question", "praise", "none"]).optional(),
  outdated: z.boolean().optional(), sourceAnchor: sourceAnchorSchema.optional(),
}).passthrough();
export const persistedReviewCommentsSchema = z.array(persistedReviewCommentSchema).refine((comments) => new Set(comments.map((comment) => comment.id)).size === comments.length, "Duplicate comment IDs");

export const MAX_COMMENT_BODY_LENGTH = 64 * 1024;
export const MAX_COMMENT_CONTEXT_LENGTH = 256 * 1024;
export const MAX_COMMENT_REQUEST_BYTES = 1024 * 1024;

const bodySchema = z
  .string()
  .max(MAX_COMMENT_BODY_LENGTH)
  .refine((value) => value.trim().length > 0, "body must not be blank");

export const createReviewCommentSchema = z
  .object({
    filePath: z
      .string()
      .min(1)
      .max(4096)
      .refine(
        (value) => !value.includes("\0"),
        "filePath must not contain NUL",
      ),
    side: z.enum(["deletions", "additions"]),
    lineNumber: z.number().int().nonnegative(),
    startLineNumber: z.number().int().positive().optional(),
    // Older HTTP clients omitted the captured context. Keep that compatible,
    // but never accept a non-string value that breaks formatting/rendering.
    lineContent: z.string().max(MAX_COMMENT_CONTEXT_LENGTH).default(""),
    body: bodySchema,
    severity: z
      .enum(["blocking", "nit", "question", "praise", "none"])
      .optional(),
    snapshotId: z.uuid().optional(),
    fileIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.snapshotId === undefined) !== (value.fileIndex === undefined)) {
      ctx.addIssue({ code: "custom", path: ["snapshotId"], message: "snapshotId and fileIndex must be supplied together" });
    }
    if (
      value.startLineNumber !== undefined &&
      (value.lineNumber === 0 || value.startLineNumber > value.lineNumber)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["startLineNumber"],
        message: "startLineNumber must be within the inclusive line range",
      });
    }
  });

export const updateReviewCommentSchema = z
  .object({
    body: bodySchema.optional(),
    status: z.enum(["open", "resolved"]).optional(),
  })
  .refine((value) => value.body !== undefined || value.status !== undefined, {
    message: "body or status is required",
  });

export const createCommentReplySchema = z.object({
  body: bodySchema,
  role: z.enum(["user", "agent"]).optional(),
  model: z.string().min(1).max(256).optional(),
});

export const editCommentReplySchema = z.object({ body: bodySchema });

/** Report validation rules, never the submitted comment or other input data. */
export function commentValidationError(error: z.ZodError): { error: string } {
  if (error.issues.some((issue) => issue.path[0] === "side")) {
    return { error: "side must be additions or deletions" };
  }
  return {
    error: error.issues
      .map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`)
      .join("; "),
  };
}
