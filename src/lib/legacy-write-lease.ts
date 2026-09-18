import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { ReviewOwner, ReviewOwnershipError } from "./review-owner.js";

export class LegacyWriteError extends Error {
  constructor(readonly code: "legacy_store_busy" | "review_core_required") { super(code); }
}

const authorityFiles = ["review-authority.json", "review.sqlite", "review.initialized", "review.sqlite-journal", "review.sqlite-wal", "review.sqlite-shm"];

export async function hasReviewAuthority(directory: string): Promise<boolean> {
  const present = await Promise.all(authorityFiles.map(async (name) => {
    try { await lstat(join(directory, name)); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }));
  return present.some(Boolean);
}

/** Any authority marker, including an unknown version, fences classic writes.
 * Archive/recovery code reads the original files directly under the lease. */
export async function assertClassicAuthority(directory: string): Promise<void> {
  if (await hasReviewAuthority(directory)) throw new LegacyWriteError("review_core_required");
}

/** Shared protocol for local classic writers and migration: an immutable
 * legacy-write-lease/owner.json {version:1,port} record and an exclusive IPv4
 * loopback listener. Ownership ends only on close or process death, never by
 * deleting an old lock or treating a slow writer as abandoned. */
export async function withLegacyWriteLease<T>(directory: string, operation: () => Promise<T>, timeoutMs = 5000): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 30_000) throw new RangeError("Invalid legacy lease timeout");
  const deadline = performance.now() + timeoutMs;
  let owner: ReviewOwner;
  for (;;) {
    try { owner = await ReviewOwner.acquireEphemeral(join(directory, "legacy-write-lease")); break; }
    catch (error) {
      if (!(error instanceof ReviewOwnershipError) || error.code !== "owner_busy") throw error;
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new LegacyWriteError("legacy_store_busy");
      await new Promise((resolve) => setTimeout(resolve, Math.min(25, remaining)));
    }
  }
  try { return await operation(); } finally { await owner.close(); }
}

export function withClassicWrite<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  return withLegacyWriteLease(directory, async () => {
    await assertClassicAuthority(directory);
    return operation();
  });
}
