export const firstSha = "a".repeat(40);
export const secondSha = "b".repeat(40);
export const headSha = "c".repeat(40);
const patch = (path: string, before: string, after: string) =>
  `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,3 +1,3 @@\n export function review() {\n-${before}\n+${after}\n }\n`;
export const patches: Record<string, string> = {
  [firstSha]: patch(
    "src/lib/review-session.ts",
    "  return session;",
    "  return session.refresh();"
  ),
  [secondSha]: patch(
    "src/ui/ReviewToolbar.tsx",
    "  return 'Submit';",
    "  return 'Submit review';"
  ),
  [headSha]: patch(
    "src/lib/review-session.ts",
    "  return session.refresh();",
    "  return session.refresh({ preserveDrafts: true });"
  ),
};
export const fullPatch =
  patch(
    "src/lib/review-session.ts",
    "  return session;",
    "  return session.refresh({ preserveDrafts: true });"
  ) + patches[secondSha];
export const commits = [
  {
    sha: firstSha,
    subject: "Refresh review sessions without losing context",
    body: "Keep the review snapshot aligned with the pull request.",
    author: "octocat",
    authoredAt: "2026-09-28T10:00:00Z",
    parents: ["d".repeat(40)],
  },
  {
    sha: secondSha,
    subject: "Simplify the review toolbar",
    body: "",
    author: "octocat",
    authoredAt: "2026-09-28T11:00:00Z",
    parents: [firstSha],
  },
  {
    sha: headSha,
    subject: "Preserve drafts when new commits arrive",
    body: "Retain unfinished feedback across refreshes.",
    author: "octocat",
    authoredAt: "2026-09-28T12:00:00Z",
    parents: [secondSha],
  },
];
export const session = {
  prMode: true,
  ref: "142",
  owner: "acme",
  repo: "diffing",
  pullNumber: 142,
  title: "A calmer, more focused pull request review",
  url: "https://github.com/acme/diffing/pull/142",
  baseSha: "d".repeat(40),
  headSha,
  headRefName: "feat/review-experience",
  baseRefName: "main",
  author: { login: "octocat" },
  additions: 2,
  deletions: 2,
  changedFiles: 2,
  state: "open",
  isDraft: false,
  body: "## What changed\nA simpler way to work through pull requests, with less scrolling and more room for the code.\n\n- Keep drafts when refreshing\n- Make the review controls easier to scan\n\n## Validation\nSession and toolbar regression tests pass.",
  existingComments: [],
  existingReviews: [
    {
      id: 1,
      author: { login: "reviewer" },
      body: "The new review flow looks good. Please keep the draft state when refreshing.",
      state: "COMMENTED",
      submittedAt: "2026-09-28T14:00:00Z",
    },
  ],
  issueComments: [
    {
      id: 2,
      author: { login: "octocat" },
      body: "Draft preservation is covered by the final commit.",
      createdAt: "2026-09-28T15:00:00Z",
      updatedAt: "2026-09-28T15:00:00Z",
    },
  ],
  timelineEvents: [],
};
