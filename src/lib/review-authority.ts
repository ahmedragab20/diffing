import { createHash, randomBytes } from "node:crypto";
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

export class ReviewAuthorityError extends Error {
  constructor(readonly code: "unauthenticated" | "forbidden" | "credential_expired") {
    super(code);
  }
}

interface Grant {
  identity: ReviewIdentity;
  actor: ReviewActor;
  permissions: ReviewPermission[];
  expiresAt: number;
}

/**
 * Owned by the trusted server connection layer, never exposed as a client tool.
 * Request roles/model labels cannot mint grants. Tokens are incarnation-local;
 * a restart requires reconnecting through that trusted connection layer.
 * This does not constrain an external agent's independently available shell.
 */
export class ReviewAuthority {
  private readonly grants = new Map<string, Grant>();
  constructor(private readonly now: () => number = Date.now) {}

  issue(identity: ReviewIdentity, actor: ReviewActor, permissions: ReviewPermission[], ttlMs = 60 * 60_000): string {
    const scope = reviewIdentitySchema.parse(identity);
    const principal = reviewActorSchema.parse(actor);
    const allowed = z.array(reviewPermissionSchema).max(6).parse(permissions);
    if (allowed.includes("decide") && principal.kind !== "human") throw new ReviewAuthorityError("forbidden");
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 24 * 60 * 60_000) throw new RangeError("Credential lifetime must be between 1 ms and 24 hours.");
    for (const [key, grant] of this.grants) if (grant.expiresAt <= this.now()) this.grants.delete(key);
    if (this.grants.size >= 1000) throw new Error("Review credential capacity reached.");
    const token = randomBytes(32).toString("base64url");
    this.grants.set(this.digest(token), { identity: scope, actor: principal, permissions: [...new Set(allowed)], expiresAt: this.now() + ttlMs });
    return token;
  }

  authorize(token: string, identity: ReviewIdentity, permission: ReviewPermission): ReviewActor {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ReviewAuthorityError("unauthenticated");
    const grant = this.grants.get(this.digest(token));
    if (!grant) throw new ReviewAuthorityError("unauthenticated");
    if (grant.expiresAt <= this.now()) throw new ReviewAuthorityError("credential_expired");
    if (grant.identity.reviewId !== identity.reviewId || grant.identity.workspaceId !== identity.workspaceId || grant.identity.repositoryId !== identity.repositoryId || !grant.permissions.includes(permission)) throw new ReviewAuthorityError("forbidden");
    return structuredClone(grant.actor);
  }

  revoke(token: string): void { this.grants.delete(this.digest(token)); }
  private digest(token: string): string { return createHash("sha256").update(token).digest("hex"); }
}
