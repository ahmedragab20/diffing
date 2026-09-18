import { describe, expect, it } from "vitest";
import { reviewSessionApiOrigin, reviewSessionUrl } from "../lib/session-url.js";
import type { ServerLock } from "../lib/server-lock.js";

const lock: ServerLock = { host: "127.0.0.1", port: 43126, pid: 1, repoRoot: "/repo", startedAt: 1, version: "test", mode: "tui" };

describe("local session API origins", () => {
  it("provides a native API origin without inventing a browser review URL", () => {
    expect(reviewSessionApiOrigin(lock)).toBe("http://127.0.0.1:43126");
    expect(reviewSessionUrl(lock)).toBeNull();
    expect(reviewSessionApiOrigin({ ...lock, mode: "gh-pr" })).toBe("http://127.0.0.1:43126");
    expect(reviewSessionUrl({ ...lock, mode: "gh-pr" })).toBe("http://127.0.0.1:43126/gh/pr");
  });
  it("formats IPv6 loopback and refuses remote hosts or invalid ports", () => {
    expect(reviewSessionApiOrigin({ ...lock, host: "::1" })).toBe("http://[::1]:43126");
    expect(reviewSessionApiOrigin({ ...lock, host: "[::1]" })).toBe("http://[::1]:43126");
    for (const host of ["0.0.0.0", "::"]) expect(reviewSessionApiOrigin({ ...lock, mode: "web", host })).toBe("http://127.0.0.1:43126");
    for (const port of [0, -1, 1.5, 65536, NaN]) expect(reviewSessionApiOrigin({ ...lock, port })).toBeNull();
    for (const host of ["example.com", "192.168.1.1"]) expect(reviewSessionApiOrigin({ ...lock, host })).toBeNull();
  });
});
