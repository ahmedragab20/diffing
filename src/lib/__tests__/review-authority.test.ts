// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ReviewAuthority,
  ReviewAuthorityError,
  reviewActorSchema,
  reviewPermissionSchema,
  type ReviewActor,
  type ReviewIdentity,
} from "../review-authority.js";

const identity: ReviewIdentity = {
  reviewId: "00000000-0000-4000-8000-000000000001",
  repositoryId: "a".repeat(64),
  workspaceId: "b".repeat(64),
};
const human: ReviewActor = { id: "human-1", kind: "human", label: "Reviewer" };

describe("ReviewAuthority", () => {
  it("allows a trusted human grant to issue a decision", () => {
    const authority = new ReviewAuthority(() => 100);
    const token = authority.issue(identity, human, ["decide"]);
    expect(authority.authorize(token, identity, "decide")).toEqual(human);
  });

  it("rejects agent and system decision grants", () => {
    const authority = new ReviewAuthority();
    for (const kind of ["agent", "system"] as const) {
      expect(() => authority.issue(identity, { id: kind, kind }, ["decide"])).toThrow(ReviewAuthorityError);
    }
  });

  it("keeps agent read/work/comment grants unable to decide", () => {
    const authority = new ReviewAuthority();
    const token = authority.issue(identity, { id: "agent-1", kind: "agent" }, ["read", "work", "comment"]);
    for (const permission of ["read", "work", "comment"] as const) {
      expect(authority.authorize(token, identity, permission).id).toBe("agent-1");
    }
    expect(() => authority.authorize(token, identity, "decide")).toThrow(ReviewAuthorityError);
  });

  it("denies grants across review, workspace, and repository identities", () => {
    const authority = new ReviewAuthority();
    const token = authority.issue(identity, human, ["read"]);
    const variants = [
      { ...identity, reviewId: "00000000-0000-4000-8000-000000000002" },
      { ...identity, workspaceId: "c".repeat(64) },
      { ...identity, repositoryId: "d".repeat(64) },
    ];
    for (const variant of variants) expect(() => authority.authorize(token, variant, "read")).toThrow(ReviewAuthorityError);
  });

  it("rejects malformed, tampered, and cross-instance tokens as unauthenticated", () => {
    const authority = new ReviewAuthority();
    const token = authority.issue(identity, human, ["read"]);
    for (const value of ["bad", `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`, token + "x"]) {
      expect(() => authority.authorize(value, identity, "read")).toThrowError(new ReviewAuthorityError("unauthenticated"));
    }
    const other = new ReviewAuthority();
    expect(() => other.authorize(token, identity, "read")).toThrowError(new ReviewAuthorityError("unauthenticated"));
  });

  it("expires exactly at the deterministic clock boundary", () => {
    let now = 0;
    const authority = new ReviewAuthority(() => now);
    const token = authority.issue(identity, human, ["read"], 100);
    now = 99;
    expect(authority.authorize(token, identity, "read")).toEqual(human);
    now = 100;
    expect(() => authority.authorize(token, identity, "read")).toThrowError(new ReviewAuthorityError("credential_expired"));
  });

  it("revokes a grant before expiry", () => {
    const authority = new ReviewAuthority();
    const token = authority.issue(identity, human, ["read"]);
    authority.revoke(token);
    expect(() => authority.authorize(token, identity, "read")).toThrowError(new ReviewAuthorityError("unauthenticated"));
  });

  it("isolates grants from caller and returned actor mutations", () => {
    const authority = new ReviewAuthority();
    const originalIdentity = { ...identity };
    const originalActor: ReviewActor = { ...human };
    const permissions: Array<"read" | "decide"> = ["read"];
    const token = authority.issue(originalIdentity, originalActor, permissions);
    originalIdentity.workspaceId = "e".repeat(64);
    originalActor.id = "mutated";
    permissions.push("decide");
    const returned = authority.authorize(token, identity, "read");
    returned.id = "mutated-return";
    expect(authority.authorize(token, identity, "read")).toEqual(human);
    expect(() => authority.authorize(token, identity, "decide")).toThrow(ReviewAuthorityError);
  });

  it("rejects zero and oversized credential lifetimes", () => {
    const authority = new ReviewAuthority();
    expect(() => authority.issue(identity, human, ["read"], 0)).toThrow(RangeError);
    expect(() => authority.issue(identity, human, ["read"], 24 * 60 * 60_000 + 1)).toThrow(RangeError);
  });

  it("rejects invalid actor kinds and permissions at the schema boundary", () => {
    expect(reviewActorSchema.safeParse({ id: "x", kind: "robot" }).success).toBe(false);
    expect(reviewPermissionSchema.safeParse("publish").success).toBe(false);
    const authority = new ReviewAuthority();
    expect(() => authority.issue(identity, { id: "x", kind: "robot" } as never, ["read"])).toThrow();
    expect(() => authority.issue(identity, human, ["publish"] as never)).toThrow();
  });

  it("bounds credentials at 1000 and recycles expired grants", () => {
    let now = 0;
    const authority = new ReviewAuthority(() => now);
    const tokens = Array.from({ length: 1000 }, (_, i) => authority.issue(identity, { id: `agent-${i}`, kind: "agent" }, ["read"], 1));
    expect(tokens).toHaveLength(1000);
    expect(() => authority.issue(identity, human, ["read"], 1)).toThrow("capacity");
    now = 1;
    const recycled = Array.from({ length: 1000 }, (_, i) => authority.issue(identity, { id: `recycled-${i}`, kind: "agent" }, ["read"], 1));
    expect(recycled).toHaveLength(1000);
    expect(authority.authorize(recycled[999], identity, "read").id).toBe("recycled-999");
  });
});
