// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

type TestLock = {
  host: string;
  port: number;
  mode: "tui";
  capability: string;
};

const lock = vi.hoisted(() => ({
  current: ({
    host: "127.0.0.1",
    port: 43123,
    mode: "tui" as const,
    capability: "test-capability",
  } as TestLock | null),
}));

vi.mock("../lib/server-lock.js", () => ({
  resolveActiveServerLock: () => lock.current,
}));

import { runSubcommand } from "../cli-agent.js";

const status = (round: number) => new Response(JSON.stringify({ round }), { status: 200 });
const registered = () => new Response(JSON.stringify({ agentId: "agent-test" }), { status: 200 });
const released = (round: number) =>
  new Response(JSON.stringify({ status: "released", payload: { commentXml: "<review />", round } }), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  lock.current = {
    host: "127.0.0.1",
    port: 43123,
    mode: "tui",
    capability: "test-capability",
  };
});

describe("await-review CLI protocol", () => {
  it("honors --since 3 even when the cached status round is 5", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      if (url.endsWith("/api/agent/register")) return registered();
      if (url.endsWith("/api/review/status")) return status(5);
      return released(6);
    }));
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    expect(await runSubcommand("await-review", ["--since", "3"])).toBe(0);
    expect(calls.find((url) => url.includes("/api/review/await"))).toContain("sinceRound=3");
  });

  it.each([5, 0])("replays the latest cached round by starting at round-1 (%s)", async (round) => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      if (url.endsWith("/api/agent/register")) return registered();
      if (url.endsWith("/api/review/status")) return status(round);
      return released(round + 1);
    }));
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    expect(await runSubcommand("await-review", [])).toBe(0);
    expect(calls.find((url) => url.includes("/api/review/await"))).toContain(`sinceRound=${Math.max(0, round - 1)}`);
  });

  it.each(["-1", "junk", "1.5", "9007199254740992"])("rejects unsafe --since %s before registering or polling", async (since) => {
    lock.current = null;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`unexpected process.exit(${code})`);
    });

    const args = since === "-1" ? ["--since=-1"] : ["--since", since];
    await expect(runSubcommand("await-review", args)).resolves.toBe(5);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("caps the long-poll request to the remaining --timeout 1 second budget", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.endsWith("/api/agent/register")) return registered();
      if (url.endsWith("/api/review/status")) return status(0);
      now = 1_001;
      return new Response(JSON.stringify({ status: "timeout", round: 0 }), { status: 200 });
    }));
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    expect(await runSubcommand("await-review", ["--timeout", "1"])).toBe(2);
    expect(calls.find(({ url }) => url.includes("/api/review/await"))?.url).toContain("timeoutMs=1000");
    expect(calls.at(-1)).toMatchObject({ method: "DELETE" });
  });

  it("keeps released XML and round output unchanged and unregisters on success", async () => {
    const calls: Array<{ url: string; method: string; capability: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        capability: new Headers(init?.headers).get("X-Diffing-Capability"),
      });
      if (url.endsWith("/api/agent/register")) return registered();
      if (url.endsWith("/api/review/status")) return status(5);
      if (url.includes("/api/review/await")) return released(6);
      return new Response("{}", { status: 200 });
    }));
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await runSubcommand("await-review", [])).toBe(0);
    expect(stdout).toHaveBeenCalledWith("<review />\n");
    expect(stderr).toHaveBeenCalledWith("DIFFING_REVIEW_ROUND=6");
    expect(calls.at(-1)).toMatchObject({ method: "DELETE" });
    expect(calls.at(-1)?.url).toContain("/api/agent/register/agent-test");
    expect(calls.every(({ url, capability }) => url.includes("/api/") && capability === "test-capability")).toBe(true);
  });
});
