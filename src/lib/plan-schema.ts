import { z } from "zod";
import { persistedReviewCommentSchema } from "./comment-schema.js";

const timestamp = z.number().finite();
const comment = persistedReviewCommentSchema.omit({ filePath: true, side: true }).extend({
  createdAtPlanVersion: z.number().int().positive().optional(),
});

/** Older stores may omit version history; readers backfill it explicitly. */
export const persistedPlansSchema = z.array(z.object({
  id: z.string().min(1), title: z.string(), body: z.string(),
  createdAt: timestamp, updatedAt: timestamp.optional(), version: z.number().int().positive().optional(),
  decision: z.enum(["pending", "approved", "rejected", "changes-requested", "comment-only"]),
  comments: z.array(comment).optional(),
  versions: z.array(z.object({ version: z.number().int().positive(), body: z.string(), title: z.string(), createdAt: timestamp }).passthrough()).optional(),
}).passthrough()).refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length, "Duplicate plan IDs");
