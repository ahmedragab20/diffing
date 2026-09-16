import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { arch, cpus, platform, release } from "node:os";

import { buildAgentDiffIndex, type AgentDiffIndex } from "../src/lib/agent-diff-index.js";
import { FileInspectSnapshots, type CapturedFilesPage, type FileInspectError } from "../src/lib/file-inspect-snapshots.js";

const CASES = {
  small: { files: 20, changedLines: 100 },
  medium: { files: 500, changedLines: 100 },
  large: { files: 5_000, changedLines: 100 },
  "long-line": { files: 1, changedLines: 1 },
  unicode: { files: 1, changedLines: 1 },
  binary: { files: 1, changedLines: 0 },
  rename: { files: 1, changedLines: 0 },
} as const;

type CaseName = keyof typeof CASES;
type ErrorResult = Pick<FileInspectError, "status" | "code" | "error">;

function usage(message?: string): never {
  if (message) console.error(message);
  console.error("Usage: tsx scripts/review-inspect-baseline.ts [--case NAME[,NAME...]] [--runs N]");
  process.exit(1);
}

function parseArgs(): { cases: CaseName[]; runs: number } {
  let selected = ["small", "medium", "large"] as string[];
  let runs = 5;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--case") {
      const value = args[++i];
      if (!value) usage("--case requires a value");
      selected = value.split(",").filter(Boolean);
    } else if (arg === "--runs") {
      const value = args[++i];
      if (!value || !/^\d+$/.test(value)) usage("--runs must be an integer from 1 through 20");
      runs = Number(value);
      if (runs < 1 || runs > 20) usage("--runs must be an integer from 1 through 20");
    } else {
      usage(`Unknown argument: ${arg}`);
    }
  }
  if (selected.length === 0 || selected.some((name) => !(name in CASES))) {
    usage(`Unknown case: ${selected.find((name) => !(name in CASES)) ?? ""}`);
  }
  return { cases: selected as CaseName[], runs };
}

function additions(count: number): string {
  return Array.from({ length: count }, (_, index) => `+export const value_${index} = ${index};\n`).join("");
}

function regularPatch(files: number, changedLines: number): string {
  return Array.from({ length: files }, (_, fileIndex) => {
    const path = `bench/file-${String(fileIndex).padStart(5, "0")}.ts`;
    return [
      `diff --git a/${path} b/${path}\n`,
      "new file mode 100644\n",
      "--- /dev/null\n",
      `+++ b/${path}\n`,
      `@@ -0,0 +1,${changedLines} @@\n`,
      additions(changedLines),
    ].join("");
  }).join("");
}

function patchFor(name: CaseName): string {
  switch (name) {
    case "long-line":
      return `diff --git a/bench/long-line.ts b/bench/long-line.ts\n--- a/bench/long-line.ts\n+++ b/bench/long-line.ts\n@@ -0,0 +1,1 @@\n+${"x".repeat(1024 * 1024)}\n`;
    case "unicode": {
      const path = "bench/quote-\"-café.ts";
      const quoted = JSON.stringify(`a/${path}`);
      const quotedNew = JSON.stringify(`b/${path}`);
      return `diff --git ${quoted} ${quotedNew}\n--- ${quoted}\n+++ ${quotedNew}\n@@ -0,0 +1,1 @@\n+export const café = "✓";\n`;
    }
    case "binary":
      return "diff --git a/bench/image.bin b/bench/image.bin\nnew file mode 100644\nBinary files /dev/null and b/bench/image.bin differ\n";
    case "rename":
      return "diff --git a/bench/old-name.ts b/bench/new-name.ts\nsimilarity index 100%\nrename from bench/old-name.ts\nrename to bench/new-name.ts\n";
    default:
      return regularPatch(CASES[name].files, CASES[name].changedLines);
  }
}

function memory(): NodeJS.MemoryUsage {
  return process.memoryUsage();
}

function elapsed(run: () => unknown): { value: unknown; ms: number } {
  const start = performance.now();
  const value = run();
  return { value, ms: performance.now() - start };
}

function errorOf(value: unknown): ErrorResult | null {
  if (value && typeof value === "object" && "status" in value && "code" in value) {
    const result = value as FileInspectError;
    return { status: result.status, code: result.code, error: result.error };
  }
  return null;
}

function captureFiles(index: AgentDiffIndex): {
  start: CapturedFilesPage | ErrorResult;
  startMs: number;
  continuations: Array<{ ms: number; returned: number; omitted: number; error?: ErrorResult }>;
  returnedFiles: number;
  omittedEntries: number;
} {
  const snapshots = new FileInspectSnapshots();
  const first = elapsed(() => snapshots.start(index, 0, 100));
  const startError = errorOf(first.value);
  if (startError) {
    return { start: startError, startMs: first.ms, continuations: [], returnedFiles: 0, omittedEntries: 0 };
  }

  let page = first.value as CapturedFilesPage;
  let returnedFiles = page.files.length;
  let omittedEntries = page.omitted?.count ?? 0;
  const continuations: Array<{ ms: number; returned: number; omitted: number; error?: ErrorResult }> = [];
  while (page.nextContinuation) {
    const next = elapsed(() => snapshots.continue(page.nextContinuation!));
    const nextError = errorOf(next.value);
    if (nextError) {
      continuations.push({ ms: next.ms, returned: 0, omitted: 0, error: nextError });
      break;
    }
    page = next.value as CapturedFilesPage;
    const omitted = page.omitted?.count ?? 0;
    returnedFiles += page.files.length;
    omittedEntries += omitted;
    continuations.push({ ms: next.ms, returned: page.files.length, omitted });
  }
  return { start: page, startMs: first.ms, continuations, returnedFiles, omittedEntries };
}

function nearestRank(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

function statistics(values: number[]): { p50Ms: number | null; p95Ms: number | null } {
  return { p50Ms: nearestRank(values, 0.5), p95Ms: nearestRank(values, 0.95) };
}

function runCase(name: CaseName, runs: number) {
  const patch = patchFor(name);
  const generated = CASES[name];
  const samples = [];
  for (let run = 0; run < runs; run++) {
    const before = memory();
    const built = elapsed(() => buildAgentDiffIndex(patch));
    const index = built.value as AgentDiffIndex;
    const captured = captureFiles(index);
    const after = memory();
    const successful = !errorOf(captured.start) && captured.continuations.every((entry) => !entry.error);
    if (successful && captured.returnedFiles + captured.omittedEntries !== generated.files) {
      throw new Error(`${name}: captured ${captured.returnedFiles} files and omitted ${captured.omittedEntries}; expected ${generated.files}`);
    }
    samples.push({
      sample: run === 0 ? "cold" : "warm",
      inputBytes: Buffer.byteLength(patch, "utf8"),
      generatedFiles: generated.files,
      changedLinesPerFile: generated.changedLines,
      buildAgentDiffIndexMs: built.ms,
      fileInspectSnapshotsStartMs: captured.startMs,
      fileInspectSnapshotsStart: errorOf(captured.start) ?? {
        returnedFiles: captured.returnedFiles,
        omittedEntries: captured.omittedEntries,
      },
      fileInspectSnapshotsContinuations: captured.continuations,
      memoryBefore: before,
      memoryAfter: after,
      retainedRepresentationJsonBytes: Buffer.byteLength(JSON.stringify(index)),
    });
  }
  return {
    name,
    inputBytes: Buffer.byteLength(patch, "utf8"),
    generatedFiles: generated.files,
    changedLinesPerFile: generated.changedLines,
    samples,
    statistics: {
      buildAgentDiffIndexMs: statistics(samples.map((sample) => sample.buildAgentDiffIndexMs)),
      fileInspectSnapshotsStartMs: statistics(samples.map((sample) => sample.fileInspectSnapshotsStartMs)),
      fileInspectSnapshotsContinuationMs: statistics(samples.flatMap((sample) => sample.fileInspectSnapshotsContinuations.map((entry) => entry.ms))),
    },
  };
}

const { cases, runs } = parseArgs();
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const cpu = cpus()[0];
console.log(JSON.stringify({
  schemaVersion: 1,
  mode: "review-inspect-baseline",
  revision,
  runtime: {
    node: process.version,
    platform: platform(),
    osRelease: release(),
    arch: arch(),
    cpuModel: cpu?.model ?? "unknown",
    logicalCpus: cpus().length,
  },
  measurement: "index-only and same-process RSS; Git collection and UI timings are not measured",
  runs,
  cases: cases.map((name) => runCase(name, runs)),
}, null, 2));
