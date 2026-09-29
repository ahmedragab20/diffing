// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

type ExecCallback = (error: Error | null, result?: { stdout: string; stderr: string }) => void;

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: mocks.existsSync,
}));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile: mocks.execFile,
  execFileSync: mocks.execFileSync,
}));

const CALLER_URL = "file:///fake/repo/dist/cli.mjs";
const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

function localCandidates() {
  return [
    "/fake/repo/dist/diffing-tui",
    "/fake/repo/target/release/diffing-tui",
  ];
}

function queueProbe() {
  const callbacks: ExecCallback[] = [];
  mocks.execFile.mockImplementation((_candidate: string, _args: unknown[], _options: unknown, callback: ExecCallback) => {
    callbacks.push(callback);
  });
  return callbacks;
}

async function loadFinder() {
  vi.resetModules();
  return import("../lib/find-tui-binary.js");
}

afterEach(() => {
  vi.restoreAllMocks();
  mocks.existsSync.mockReset();
  mocks.execFile.mockReset();
  mocks.execFileSync.mockReset();
  setPlatform(originalPlatform);
});

describe("findViewerTuiBinary probe scheduling", () => {
  it("starts local probes together, returns preferred success immediately, and aborts the rest", async () => {
    setPlatform("linux");
    mocks.existsSync.mockImplementation((candidate: string) => localCandidates().includes(candidate));
    const callbacks = queueProbe();
    const { findViewerTuiBinary } = await loadFinder();
    const resultPromise = findViewerTuiBinary(CALLER_URL);
    await Promise.resolve();
    expect(mocks.execFile).toHaveBeenCalledTimes(2);
    callbacks[0](null, { stdout: "--view-only", stderr: "" });
    await expect(resultPromise).resolves.toBe(localCandidates()[0]);
    const secondOptions = mocks.execFile.mock.calls[1][2] as { signal: AbortSignal };
    expect(secondOptions.signal.aborted).toBe(true);
    expect(mocks.execFileSync).not.toHaveBeenCalled();
  });

  it("waits for a lower-priority success after the preferred probe fails", async () => {
    setPlatform("linux");
    mocks.existsSync.mockImplementation((candidate: string) => localCandidates().includes(candidate));
    const callbacks = queueProbe();
    const { findViewerTuiBinary } = await loadFinder();
    const resultPromise = findViewerTuiBinary(CALLER_URL);
    await Promise.resolve();
    let settled = false;
    void resultPromise.then(() => {
      settled = true;
    });
    callbacks[1](null, { stdout: "--view-only", stderr: "" });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(mocks.execFile).toHaveBeenCalledTimes(2);
    callbacks[0](new Error("preferred candidate lacks viewer support"));
    await expect(resultPromise).resolves.toBe(localCandidates()[1]);
  });

  it("skips PATH after local success and queries PATH only after every local failure", async () => {
    setPlatform("linux");
    mocks.existsSync.mockImplementation((candidate: string) => localCandidates().includes(candidate));
    const localCallbacks = queueProbe();
    const { findViewerTuiBinary } = await loadFinder();
    const localResult = findViewerTuiBinary(CALLER_URL);
    await Promise.resolve();
    localCallbacks[0](new Error("first local candidate failed"));
    await Promise.resolve();
    expect(mocks.execFileSync).not.toHaveBeenCalled();

    mocks.execFileSync.mockReturnValue("/usr/local/bin/diffing-tui\n");
    const pathCallbacks = queueProbe();
    localCallbacks[1](new Error("second local candidate failed"));
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    expect(mocks.execFileSync).toHaveBeenCalledWith("which", ["diffing-tui"], expect.any(Object));
    expect(pathCallbacks).toHaveLength(1);
    pathCallbacks[0](null, { stdout: "--view-only", stderr: "" });
    await expect(localResult).resolves.toBe("/usr/local/bin/diffing-tui");
  });

  it("does not inspect process.report while looking up darwin candidates", async () => {
    setPlatform("darwin");
    mocks.existsSync.mockReturnValue(false);
    mocks.execFileSync.mockImplementation(() => {
      throw new Error("not on PATH");
    });
    const reportSpy = vi.spyOn(process.report, "getReport");
    const { findViewerTuiBinary } = await loadFinder();
    await expect(findViewerTuiBinary(CALLER_URL)).resolves.toBeNull();
    expect(reportSpy).not.toHaveBeenCalled();
  });
});
