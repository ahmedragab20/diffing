---
"diffing": minor
---

Add a GitHub PR review mode to `diffing`. Review a pull request in the same diff UI you already use for the working tree, then push the review to the actual PR — no copy-paste of inline comments.

**Usage**:

- `diffing "gh pr 1234"` (or `--gh-pr 1234`) — open PR #1234 in the current repo.
- `diffing "gh pr https://github.com/foo/bar/pull/42"` — full URL form.
- `diffing "gh pr foo/bar#42"` — `owner/repo#N` shorthand.
- `diffing gh pr-review <ref> --decision <approve|comment|request-changes> [--body <text>]` — headless submit (CI / agent use).
- `diffing gh pr-fetch <ref>` — dump PR metadata as JSON.
- `diffing gh pr-list-comments` — list in-progress PR-mode comments (mirrors `diffing comments`).
- `diffing gh status` — show the active PR session (ref, owner/repo#n, comment count, submitted status).

**Behaviour**:

- Renders the PR's unified diff in the existing `<DiffViewer>` / `<FileTree>` machinery — no new renderer, no parallel UI. Existing PR review comments are fetched and shown as a read-only summary strip below each file so you can see what was already said before adding your own.
- "Submit to GitHub" builds a `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews` payload (the standard GitHub REST shape) and POSTs it. Multi-line comments are expanded to N single-line comments with a `[part N/M]` prefix. Existing comments are **never re-POSTed** — only the new ones.
- Auth: prefers the `gh` CLI (uses your existing `gh auth`). Falls back to `$GH_TOKEN` / `$GITHUB_TOKEN` / `$GITHUB_API_TOKEN` env vars when `gh` is missing or not authenticated.
- Verdict mapping: `approve → APPROVE`, `request-changes → REQUEST_CHANGES`, `comment → COMMENT`. The popover also offers `rejected` (an internal option) which maps to `REQUEST_CHANGES` because GitHub has no REJECT event.
- Storage: new `pr-session.json` sidecar in `~/.diffing/<repo>-<hash>/` — never collides with `comments.json` or `plans.json`. The local review flow and the plan review flow are byte-identical to before; all `/api/gh/*` routes 404 when no `pr-session.json` exists.
- The local "Send to agent" popover is **structurally absent** in PR mode — there's no way to invoke the agent handoff while reviewing a PR. A "Back to local review" button is provided.
- Web only for v1; TUI is unaffected.

**Plan**: `0ace193e-6f45-4750-838f-534bba8acad2` v3 (approved).

**Tests**: 10 PrSession store tests (`src/lib/__tests__/pr-session.test.ts`), 19 payload / mapping / parsePrRef tests (`src/lib/__tests__/pr-payload.test.ts`), 8 server route tests (`src/__tests__/gh-pr.test.ts`), 4 PrReviewApp empty-state tests (`src/ui/__tests__/PrReviewApp.test.tsx`).
