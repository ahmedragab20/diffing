import { z } from "zod";
import { reviewActorSchema, reviewIdentitySchema } from "./review-identity.js";
import { SESSION_TOKEN_HEADER } from "./session-token.js";

export const reviewConnectionSchema = z.object({
  version: z.literal(1),
  origin: z.string().max(200).refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !!url.port && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/";
    } catch { return false; }
  }),
  identity: reviewIdentitySchema, actor: reviewActorSchema,
  credential: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  headers: z.object({ [SESSION_TOKEN_HEADER]: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  expiresAt: z.number().int().positive(),
}).strict();
export type ReviewConnection = z.infer<typeof reviewConnectionSchema>;

export function parseReviewConnection(input: unknown): ReviewConnection {
  const parsed = reviewConnectionSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid review connection file.");
  if (parsed.data.expiresAt <= Date.now()) throw new Error("Review connection expired. Reconnect to the running review.");
  return parsed.data;
}
