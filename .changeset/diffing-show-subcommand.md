---
"diffing": minor
---

Add a `diffing show <revspec>...` subcommand that is a drop-in for `git show` and surfaces commit metadata (subject, author, date, message body) in a `CommitBanner` above the diff in the web UI. Resolves the "viewing a commit's diffs" empty-file-list confusion: `diffing <sha>` runs `git diff <sha>` (working tree vs `<sha>`), so when the working tree matches `<sha>` the patch is empty; `diffing show <sha>` always renders the commit's changes.

**Behaviour**:
- Accepts every form `git show` understands — single commit, range (`a..b`, `a...b`), tag, branch tip, multiple SHAs.
- Pathspecs work via `--`: `diffing show HEAD -- src/`.
- Terminal mode streams `git show --no-color --no-ext-diff` byte-for-byte (verified by 7 e2e tests in `src/__tests__/cli-show.test.ts`).
- Web UI stacks a `CommitBanner` per commit (short SHA, author, relative date, committer-different badge, collapsible body, copyable SHA). Soft cap of 100 commits per invocation (`MAX_SHOW_COMMITS`) with the over-limit count surfaced in a `+N more commits not shown` badge.
- Strictly opt-in: `diffing <sha>` keeps its current `git diff <sha>` semantics; no auto-detection.

**Plan**: `0bd578e8-5b9c-4565-8e99-58599e397314` v2 (approved).

**Tests**: 11 parser fixtures in `git-show-parse.test.ts`, 4 server-side `showMode` cases in `server.test.ts`, 7 CLI e2e cases in `cli-show.test.ts`, 9 component tests in `CommitBanner.test.tsx`. All 312 vitest tests pass.
