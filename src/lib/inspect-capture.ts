import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import type { DiffOptions } from "./diff-options.js";
import {
  inspectionManifestSchema,
  type InspectionIdentity,
  type InspectionManifest,
  type InspectionPatch,
} from "./inspect-capture-contract.js";
import { parseGitDiffHeaderPaths } from "./git-path.js";

export {
  inspectionManifestSchema,
  type InspectionIdentity,
  type InspectionManifest,
  type InspectionPatch,
} from "./inspect-capture-contract.js";

const execute = promisify(execFile);
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

export class InspectCaptureError extends Error {
  constructor(readonly code: "source_unavailable" | "inconsistent_capture" | "unsupported_capture") {
    super({
      source_unavailable: "Review source could not be read; retry capture after restoring Git access.",
      inconsistent_capture: "Workspace changed during capture; retry when edits settle.",
      unsupported_capture: "This diff representation cannot be captured as a unified review patch.",
    }[code]);
  }
}

async function git(root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execute("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", root, ...args], {
      encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 30_000,
      env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout;
  } catch { throw new InspectCaptureError("source_unavailable"); }
}

/** Canonical repository and worktree identities stay distinct for linked worktrees. */
export async function readInspectionIdentity(root: string, opts: DiffOptions): Promise<InspectionIdentity> {
  const [common, workspace, index, refs] = await Promise.all([
    git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).then((path) => realpath(path.replace(/\r?\n$/, ""))),
    git(root, ["rev-parse", "--absolute-git-dir"]).then((path) => realpath(path.replace(/\r?\n$/, ""))),
    git(root, ["ls-files", "--stage", "-z"]),
    opts.revisions.length || opts.showRevspecs.length
      ? git(root, ["rev-parse", "--revs-only", "--end-of-options", ...(opts.showMode ? opts.showRevspecs : opts.revisions)])
      : Promise.resolve(""),
  ]);
  let head: string | null = null;
  try { head = (await git(root, ["rev-parse", "--verify", "HEAD"])).trim(); }
  catch {
    // An unborn symbolic branch is distinguishable from a failing repository.
    const branch = (await git(root, ["symbolic-ref", "--quiet", "HEAD"])).trim();
    const heads = await git(root, ["for-each-ref", "--format=%(refname)", branch]);
    if (heads.trim()) throw new InspectCaptureError("source_unavailable");
  }
  const resolvedRevisions = refs.trim() ? refs.trim().split("\n") : [];
  if (resolvedRevisions.some((value) => !/^\^?(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) || ((opts.showMode ? opts.showRevspecs.length : opts.revisions.length) > 0 && !resolvedRevisions.length)) throw new InspectCaptureError("source_unavailable");
  return { repositoryId: digest(common), workspaceId: digest(workspace), head, indexDigest: digest(index), resolvedRevisions };
}

/**
 * Two matching byte collections bracketed by source-identity checks. A bounded
 * retry observes concurrent edits without claiming a filesystem-wide lock or
 * an atomic snapshot of external editors. Retained page reads never call this.
 */
export async function captureInspection(
  opts: DiffOptions,
  collect: () => Promise<InspectionPatch>,
  identity: () => Promise<InspectionIdentity>,
  options: { attempts?: number; now?: () => number } = {},
): Promise<InspectionPatch & { manifest: InspectionManifest }> {
  const attempts = options.attempts ?? 3;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 3) throw new RangeError("Capture attempts must be between 1 and 3.");
  if (opts.outputFile || opts.extDiff || opts.textconv || (opts.wordDiff && opts.wordDiff !== "none") || opts.quiet || opts.check || (opts.submodule && opts.submodule !== "short") || opts.noPrefix || opts.srcPrefix || opts.dstPrefix || opts.linePrefix || opts.suppressPatch || (opts.outputFormat && opts.outputFormat !== "patch")) throw new InspectCaptureError("unsupported_capture");
  const read = async <T>(operation: () => Promise<T>): Promise<T> => {
    try { return await operation(); }
    catch (error) {
      if (error instanceof InspectCaptureError) throw error;
      throw new InspectCaptureError("source_unavailable");
    }
  };
  for (let attempt = 0; attempt < attempts; attempt++) {
    const before = await read(identity);
    const first = await read(collect);
    const middle = await read(identity);
    const second = await read(collect);
    const after = await read(identity);
    if (JSON.stringify(before) !== JSON.stringify(middle) || JSON.stringify(middle) !== JSON.stringify(after) || digest(JSON.stringify(first)) !== digest(JSON.stringify(second))) continue;
    if (/^(?:diff --(?:cc|combined) |\* Unmerged path |Submodule )/m.test(first.patch)) throw new InspectCaptureError("unsupported_capture");
    const sourceDigest = digest(first.patch);
    const layers = first.layers ?? [{ kind: "mixed" as const, patch: first.patch }];
    if (layers.map((layer) => layer.patch).filter(Boolean).join("\n") !== first.patch) throw new InspectCaptureError("unsupported_capture");
    let firstFile = 0;
    const manifestLayers = layers.map((layer, index) => {
      const fileCount = layer.patch.split("\n").filter((line) => line.startsWith("diff --git ") && parseGitDiffHeaderPaths(line)).length;
      const entry = {
        id: digest(JSON.stringify([index, layer.kind, layer.revision ?? null, layer.patch])),
        kind: layer.kind,
        ...(layer.revision ? { revision: layer.revision } : {}),
        ...(layer.parents ? { parents: [...layer.parents] } : {}),
        sourceDigest: digest(layer.patch), firstFile, fileCount,
      };
      firstFile += fileCount;
      return entry;
    });
    if (first.patch.trim() && firstFile === 0) throw new InspectCaptureError("unsupported_capture");
    const manifest: InspectionManifest = {
        version: 1, snapshotId: randomUUID(), ...before,
        sourceDigest, scopeDigest: digest(JSON.stringify(opts)),
        capturedAt: (options.now ?? Date.now)(), consistency: "optimistic-validated",
        complete: first.complete, options: JSON.parse(JSON.stringify(opts)) as DiffOptions, layers: manifestLayers,
        ...(first.provenance ? { provenance: structuredClone(first.provenance) } : {}),
    };
    if (!inspectionManifestSchema.safeParse(manifest).success) throw new InspectCaptureError("unsupported_capture");
    return { ...first, manifest };
  }
  throw new InspectCaptureError("inconsistent_capture");
}
