import { z } from "zod";

/** Preserve unknown fields while rejecting data that cannot be read safely. */
export const persistedViewedSchema = z.record(z.string(), z.object({
  headSha: z.string().optional(),
  fingerprints: z.record(z.string(), z.string()).optional(),
  files: z.record(z.string(), z.string()),
}).passthrough());
