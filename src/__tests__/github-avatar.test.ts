// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile: vi.fn(),
}));
vi.mock("node:util", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:util")>()),
  promisify: vi.fn(() => execFileAsync),
}));

import { fetchPrAvatar } from "../lib/github-avatar.js";

const session = { host: "github.company.test", url: "https://github.company.test/acme/repo/pull/1" };
const avatarUrl = new URL("https://github.company.test/avatars/u/42?s=64");
const remoteFetch = vi.fn();
const image = () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
const redirect = (location: string) => new Response(null, { status: 302, headers: { Location: location } });

beforeEach(() => {
  execFileAsync.mockReset().mockResolvedValue({ stdout: "enterprise-token\n" });
  remoteFetch.mockReset().mockImplementation(async () => image());
  vi.stubGlobal("fetch", remoteFetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchPrAvatar", () => {
  it.each([session, { url: session.url }])("authenticates with the Enterprise host, including legacy sessions: %j", async (pr) => {
    const response = await fetchPrAvatar(avatarUrl, pr);

    expect(response.status).toBe(200);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3]);
    expect(execFileAsync).toHaveBeenCalledWith("gh", ["auth", "token", "--hostname", session.host], expect.objectContaining({ timeout: 5_000 }));
    expect(remoteFetch).toHaveBeenCalledWith(avatarUrl, expect.objectContaining({ headers: { Authorization: "Bearer enterprise-token" }, redirect: "manual", signal: expect.any(AbortSignal) }));
  });

  it("retains host authentication across a same-origin redirect without rereading the token", async () => {
    remoteFetch.mockResolvedValueOnce(redirect("/avatars/u/42?size=64"));
    await fetchPrAvatar(avatarUrl, session);
    expect(remoteFetch).toHaveBeenLastCalledWith(new URL("https://github.company.test/avatars/u/42?size=64"), expect.objectContaining({ headers: { Authorization: "Bearer enterprise-token" } }));
    expect(execFileAsync).toHaveBeenCalledTimes(1);
  });

  it.each([
    "https://avatars.githubusercontent.com/u/42",
    "https://avatars.github.company.test/u/42",
    "https://other.company.test/avatar.png",
  ])("does not send credentials to a session-supplied external avatar host: %s", async (url) => {
    await fetchPrAvatar(new URL(url), session);
    expect(execFileAsync).not.toHaveBeenCalled();
    expect(remoteFetch.mock.calls[0][1].headers).toBeUndefined();
  });

  it.each([
    "https://avatars.github.company.test/u/42",
    "https://avatars.githubusercontent.com/u/42",
  ])("follows a trusted avatar redirect without forwarding credentials: %s", async (target) => {
    remoteFetch.mockResolvedValueOnce(redirect(target));
    await fetchPrAvatar(avatarUrl, session);
    expect(remoteFetch).toHaveBeenCalledTimes(2);
    expect(remoteFetch.mock.calls[1][0].href).toBe(target);
    expect(remoteFetch.mock.calls[1][1].headers).toBeUndefined();
  });

  it.each([
    "https://unrelated.test/avatar.png",
    "https://github.company.test.evil.test/avatar.png",
    "http://github.company.test/avatars/u/42",
    "https://user:password@github.company.test/avatars/u/42",
  ])("rejects untrusted redirects before requesting them: %s", async (target) => {
    remoteFetch.mockResolvedValueOnce(redirect(target));
    await expect(fetchPrAvatar(avatarUrl, session)).rejects.toThrow(/avatar/i);
    expect(remoteFetch).toHaveBeenCalledTimes(1);
  });

  it("bounds redirect loops", async () => {
    remoteFetch.mockImplementation(async () => redirect(avatarUrl.href));
    await expect(fetchPrAvatar(avatarUrl, session)).rejects.toThrow("Avatar redirect could not be followed");
    expect(remoteFetch).toHaveBeenCalledTimes(4);
  });

  it("keeps public avatars available when gh has no token", async () => {
    execFileAsync.mockRejectedValue(new Error("no saved credentials"));
    const response = await fetchPrAvatar(avatarUrl, session);
    expect(response.status).toBe(200);
    expect(remoteFetch.mock.calls[0][1].headers).toBeUndefined();
  });

  it("never sends a token over HTTP", async () => {
    await fetchPrAvatar(new URL("http://github.company.test/avatars/u/42"), { ...session, url: "http://github.company.test/acme/repo/pull/1" });
    expect(execFileAsync).not.toHaveBeenCalled();
    expect(remoteFetch.mock.calls[0][1].headers).toBeUndefined();
  });
});
