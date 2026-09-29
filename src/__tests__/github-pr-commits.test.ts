// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedPr } from "../lib/github.js";

const execFileAsync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile: vi.fn(),
}));

vi.mock("node:util", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:util")>()),
  promisify: vi.fn(() => execFileAsync),
}));

import {
  fetchPrCommitDiff,
  fetchPrCommits,
  PrCommitsChangedError,
} from "../lib/github-pr-commits.js";

const headSha = "a".repeat(40);
const firstSha = "b".repeat(40);
const resolved: ResolvedPr = {
  owner: "acme",
  repo: "widget",
  pullNumber: 123,
  ref: "123",
};

function commit(sha: string, message = "subject\n\nbody") {
  return {
    sha,
    commit: {
      message,
      author: { name: "Commit Author", date: "2026-01-02T03:04:05Z" },
    },
    author: { login: "octocat" },
    parents: [{ sha: "d".repeat(40) }],
  };
}

beforeEach(() => {
  execFileAsync.mockReset();
});

describe("fetchPrCommits", () => {
  it("uses paginated gh output oldest-first and preserves commit metadata", async () => {
    execFileAsync
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ head: { sha: headSha }, commits: 2 }),
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          [
            commit(firstSha, "first subject\nfirst body"),
            commit(headSha, "second subject\nsecond body"),
          ],
        ]),
      });

    await expect(fetchPrCommits(resolved, headSha)).resolves.toEqual({
      headSha,
      total: 2,
      complete: true,
      commits: [
        {
          sha: firstSha,
          subject: "first subject",
          body: "first body",
          author: "octocat",
          authoredAt: "2026-01-02T03:04:05Z",
          parents: ["d".repeat(40)],
        },
        {
          sha: headSha,
          subject: "second subject",
          body: "second body",
          author: "octocat",
          authoredAt: "2026-01-02T03:04:05Z",
          parents: ["d".repeat(40)],
        },
      ],
    });
    expect(execFileAsync).toHaveBeenNthCalledWith(
      1,
      "gh",
      ["api", "repos/acme/widget/pulls/123"],
      expect.objectContaining({ timeout: 45_000 })
    );
    expect(execFileAsync).toHaveBeenNthCalledWith(
      2,
      "gh",
      [
        "api",
        "repos/acme/widget/pulls/123/commits?per_page=100",
        "--paginate",
        "--slurp",
      ],
      expect.objectContaining({ timeout: 45_000 })
    );
  });

  it("passes the GHES hostname flag to metadata and commit-list requests", async () => {
    const ghes: ResolvedPr = { ...resolved, host: "github.example.com" };
    execFileAsync
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ head: { sha: headSha }, commits: 0 }),
      })
      .mockResolvedValueOnce({ stdout: "[]" });

    await fetchPrCommits(ghes, headSha);

    expect(execFileAsync).toHaveBeenNthCalledWith(
      1,
      "gh",
      [
        "api",
        "--hostname",
        "github.example.com",
        "repos/acme/widget/pulls/123",
      ],
      expect.anything()
    );
    expect(execFileAsync).toHaveBeenNthCalledWith(
      2,
      "gh",
      [
        "api",
        "--hostname",
        "github.example.com",
        "repos/acme/widget/pulls/123/commits?per_page=100",
        "--paginate",
        "--slurp",
      ],
      expect.anything()
    );
  });

  it("reports the GitHub total and incomplete status for the capped list", async () => {
    const commits = Array.from({ length: 250 }, (_, index) =>
      commit((index + 1).toString(16).padStart(40, "0"))
    );
    commits[commits.length - 1] = commit(headSha);
    execFileAsync
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ head: { sha: headSha }, commits: 251 }),
      })
      .mockResolvedValueOnce({ stdout: JSON.stringify([commits]) });

    const result = await fetchPrCommits(resolved, headSha);
    expect(result.total).toBe(251);
    expect(result.commits).toHaveLength(250);
    expect(result.complete).toBe(false);
  });

  it("rejects a changed head and malformed GitHub responses", async () => {
    execFileAsync
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ head: { sha: "f".repeat(40) }, commits: 0 }),
      })
      .mockResolvedValueOnce({ stdout: "[]" });
    await expect(fetchPrCommits(resolved, headSha)).rejects.toBeInstanceOf(
      PrCommitsChangedError
    );

    execFileAsync
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ head: { sha: headSha }, commits: 1 }),
      })
      .mockResolvedValueOnce({ stdout: JSON.stringify([{ sha: "bad" }]) });
    await expect(fetchPrCommits(resolved, headSha)).rejects.toThrow(
      "invalid commit metadata"
    );
  });
});

describe("fetchPrCommitDiff", () => {
  it("accepts an empty diff and requests the full diff media type", async () => {
    execFileAsync.mockResolvedValueOnce({ stdout: "" });
    await expect(fetchPrCommitDiff(resolved, firstSha)).resolves.toBe("");
    expect(execFileAsync).toHaveBeenCalledWith(
      "gh",
      [
        "api",
        "repos/acme/widget/commits/" + firstSha,
        "-H",
        "Accept: application/vnd.github.diff",
      ],
      expect.objectContaining({ timeout: 45_000 })
    );
  });

  it("rejects invalid responses and propagates gh failures", async () => {
    execFileAsync.mockResolvedValueOnce({ stdout: '{"sha":"not a diff"}' });
    await expect(fetchPrCommitDiff(resolved, firstSha)).rejects.toThrow(
      "did not return a commit diff"
    );

    const failure = new Error("gh failed");
    execFileAsync.mockRejectedValueOnce(failure);
    await expect(fetchPrCommitDiff(resolved, firstSha)).rejects.toBe(failure);

    await expect(fetchPrCommitDiff(resolved, "invalid")).rejects.toThrow(
      "Invalid commit SHA"
    );
  });
});
