import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ghHostnameArgs,
  parseGhPaginatedJson,
  type ResolvedPr,
} from "./github.js";
import type { PrCommit, PrCommitList } from "./pr-commits.js";

const execFileAsync = promisify(execFile);
const options = {
  encoding: "utf-8" as const,
  timeout: 45_000,
  maxBuffer: 20 * 1024 * 1024,
};

export class PrCommitsChangedError extends Error {
  constructor() {
    super(
      "This pull request has changed. Refresh the PR to review its latest commits."
    );
  }
}

/** Oldest first, as returned by GitHub. Its PR endpoint caps the list at 250. */
export async function fetchPrCommits(
  resolved: ResolvedPr,
  headSha: string
): Promise<PrCommitList> {
  const base = `repos/${encodeURIComponent(
    resolved.owner
  )}/${encodeURIComponent(resolved.repo)}`;
  const [metadata, list] = await Promise.all([
    execFileAsync(
      "gh",
      [
        "api",
        ...ghHostnameArgs(resolved),
        `${base}/pulls/${resolved.pullNumber}`,
      ],
      options
    ),
    execFileAsync(
      "gh",
      [
        "api",
        ...ghHostnameArgs(resolved),
        `${base}/pulls/${resolved.pullNumber}/commits?per_page=100`,
        "--paginate",
        "--slurp",
      ],
      options
    ),
  ]);
  const pr = JSON.parse(metadata.stdout);
  if (pr.head?.sha !== headSha) throw new PrCommitsChangedError();
  if (!Number.isSafeInteger(pr.commits) || pr.commits < 0)
    throw new Error("GitHub returned an invalid commit count");
  const commits = parseGhPaginatedJson(list.stdout).map((value): PrCommit => {
    const item = value as {
      sha: string;
      commit: { message: string; author?: { name?: string; date?: string } };
      author?: { login?: string };
      parents: { sha: string }[];
    };
    if (
      !/^[a-f0-9]{40,64}$/i.test(item.sha) ||
      typeof item.commit?.message !== "string" ||
      !Array.isArray(item.parents)
    ) {
      throw new Error("GitHub returned invalid commit metadata");
    }
    const [subject, ...body] = item.commit.message.split("\n");
    return {
      sha: item.sha,
      subject,
      body: body.join("\n").trim(),
      author:
        item.author?.login ?? item.commit.author?.name ?? "Unknown author",
      authoredAt: item.commit.author?.date ?? "",
      parents: item.parents.map((parent) => parent.sha),
    };
  });
  const complete = commits.length === pr.commits;
  // A push between the two requests must never relabel a newer list as this head.
  if (
    commits.length > pr.commits ||
    (complete && commits.length > 0 && commits.at(-1)?.sha !== headSha)
  ) {
    throw new PrCommitsChangedError();
  }
  return { headSha, commits, total: pr.commits, complete };
}

/** The diff media type includes the entire commit; transport failures stay errors. */
export async function fetchPrCommitDiff(
  resolved: ResolvedPr,
  sha: string
): Promise<string> {
  if (!/^[a-f0-9]{40,64}$/i.test(sha)) throw new Error("Invalid commit SHA");
  const endpoint = `repos/${encodeURIComponent(
    resolved.owner
  )}/${encodeURIComponent(resolved.repo)}/commits/${sha}`;
  const { stdout } = await execFileAsync(
    "gh",
    [
      "api",
      ...ghHostnameArgs(resolved),
      endpoint,
      "-H",
      "Accept: application/vnd.github.diff",
    ],
    options
  );
  if (stdout.trim() && !stdout.startsWith("diff --git "))
    throw new Error("GitHub did not return a commit diff");
  return stdout;
}
