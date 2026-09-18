import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { ReviewCore, type ReviewCoreSources } from "./review-core.js";
import { ReviewAuthority, type ReviewIdentity } from "./review-authority.js";
import { ReviewStoreError } from "./review-store.js";
import { readLegacyArchive } from "./review-legacy.js";
import { hasReviewAuthority, withLegacyWriteLease } from "./legacy-write-lease.js";

/** Explicit trusted-bootstrap migration. SQLite lives beside the original
 * classic files: its durable database/initialization records fence those writers
 * even after this process dies. No independently writable compatibility mirror
 * is produced. The caller owns the returned core and credential provisioning. */
export function openMigratedWorkspaceReview(
  directory: string,
  workspace: Pick<ReviewIdentity, "repositoryId" | "workspaceId">,
  authority: ReviewAuthority,
  sources: ReviewCoreSources,
  connect: (identity: ReviewIdentity) => string,
  options: Pick<NonNullable<Parameters<typeof ReviewCore.open>[4]>, "store" | "now"> = {},
): Promise<ReviewCore> {
  return withLegacyWriteLease(directory, async () => {
    // Reserved alternate/newer activation formats require explicit recovery.
    try {
      await lstat(join(directory, "review-authority.json"));
      throw new ReviewStoreError("migration_required");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // Validate a first adoption before creating an authoritative database. On
    // restart, the committed archive is independent of the old compatibility files.
    const archive = await hasReviewAuthority(directory) ? undefined : await readLegacyArchive(directory);
    const core = await ReviewCore.openWorkspace(directory, workspace, authority, sources, options);
    try {
      const credential = connect(core.identity);
      if (!core.exportLegacy(credential)) {
        await core.importLegacy(credential, archive ?? await readLegacyArchive(directory));
      }
      return core;
    } catch (error) {
      await core.close();
      throw error;
    }
  });
}
