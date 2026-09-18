import { z } from "zod";

export const reviewIdentitySchema = z.object({
  reviewId: z.uuid(),
  repositoryId: z.string().regex(/^[a-f0-9]{64}$/),
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ReviewIdentity = z.infer<typeof reviewIdentitySchema>;
export const reviewActorSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(["human", "agent", "system"]),
  label: z.string().max(200).optional(),
}).strict();
export type ReviewActor = z.infer<typeof reviewActorSchema>;
export const reviewPermissionSchema = z.enum(["read", "capture", "comment", "handoff", "work", "decide"]);
export type ReviewPermission = z.infer<typeof reviewPermissionSchema>;
