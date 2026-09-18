import { z } from "zod";

export const REVIEW_STORE_LIMITS = Object.freeze({ recordBytes: 256 * 1024, replayBytes: 512 * 1024, journalBytes: 64 * 1024 * 1024, records: 50_000 });
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const reviewEventSchema = z.object({ type: z.string().min(1).max(100), data: z.json() }).strict();
export const reviewTransactionSchema = z.object({
  version: z.literal(1),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  previous: digest.nullable(),
  key: z.string().min(1).max(200),
  requestHash: digest,
  events: z.array(reviewEventSchema).max(100),
  result: z.json(),
  checksum: digest,
}).strict();
export type ReviewEvent = z.infer<typeof reviewEventSchema>;
export type ReviewTransaction = z.infer<typeof reviewTransactionSchema>;
