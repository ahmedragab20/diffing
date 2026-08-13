---
name: diffing-pr-read
description: Read a GitHub pull request through diffing with token-efficient bounded inspect APIs instead of dumping gh pr view/diff or the full patch. Use when summarizing a PR, inspecting PR changes, preparing a review, or reading PR discussion with minimal context.
---

# Read a GitHub PR through diffing (token-efficient)

Prefer diffing’s slim PR overview and bounded diff inspect over `gh pr view`, `gh pr diff`, or `GET /api/diff` full patches.

## Setup

1. Target the correct repository. List `diffing sessions --json` when a shell is available; reuse a `gh-pr` entry only when its scope matches the requested PR.
2. Select the match with `diffing sessions use <id>`. If none exists, start `diffing --gh-pr <ref> --no-open` (or `diffing "gh pr <ref>" --no-open`); it coexists with local and other PR reviews and becomes active.
3. Attach or reconnect MCP after selection, call `review_session_status`, then confirm normalized PR identity with `gh_overview`. `start_review_session` is for local web diffs and must not be used for PR mode.
4. Do not replace or stop another session just to read this PR. If the shell/session manager is unavailable and MCP is pinned to a different session, report that selection is required rather than reading the wrong PR.

`<ref>` may be a number, `owner/repo#N`, or a full PR URL.

## Token-efficient read ladder

Never load the full patch or full session JSON by default.

| Step | MCP | CLI |
|------|-----|-----|
| Identity + counts | `gh_overview` | `diffing gh overview [--json]` |
| Patch totals | `diff_summary` | `diffing inspect summary` |
| File list | `diff_files` (`path` glob, page filtered `nextCursor`) | `diffing inspect files --path GLOB --cursor N --limit 50` |
| Hunk map | `diff_hunks` (`path` XOR `file`) | `diffing inspect hunks --path FILE --generation G` |
| Body rows | `diff_slice` (`path` XOR `file`) | `diffing inspect slice --path FILE --start R --max-lines 120 --generation G` |
| Find text | `diff_search` (optional `path`) | `diffing inspect search "literal" --path GLOB --generation G` |
| Discussion | `gh_list_threads` (`unresolvedOnly`) | `diffing gh threads --unresolved` |
| Verdicts | `gh_list_reviews` | `diffing gh reviews` |

### Rules

- Carry `generation` from `diff_summary` into hunks/slice/search. On stale generation (HTTP 409), re-run summary and restart that file’s traversal.
- Consume MCP `structuredContent` and returned cursors directly. Do not call `review_session_status`, `gh_overview`, or the same page repeatedly when nothing changed.
- Keep default or smaller line/byte budgets; raise only when necessary.
- Continue slices with `nextRow` and file lists with `nextCursor`. Continue search with `nextFile` + `nextRow`.
- Prefer `gh_list_threads` with `unresolvedOnly: true` and truncated bodies. Use `fullBody` / `--full-body` only for threads you will act on.
- Compact JSON is default. Avoid `--pretty` and avoid `GET /api/gh/session` (fat UI payload).
- `get_diff` / full `GET /api/diff` is an escape hatch only when inspect is unavailable.

## Optional: leave review findings

This skill is **read-first**. To post draft review comments on the PR session, follow **`diffing-review`** (PR section): create drafts via `gh_create_draft_comment` / `POST /api/gh/pr-session/comments`, then publish only with explicit user authorization (`gh_submit_review` dry-run first).

## CLI sketch

```bash
diffing sessions --json
diffing sessions use <matching-pr-session-id>  # reuse when present
# Or, when none matches:
diffing --gh-pr 1234 --no-open                  # starts a concurrent active session
diffing gh overview --json
diffing inspect summary
diffing inspect files --path "src/**" --limit 50
diffing inspect hunks --path src/lib/foo.ts --generation <g>
diffing inspect slice --path src/lib/foo.ts --start 0 --max-lines 120 --generation <g>
diffing gh threads --unresolved          # XML default
diffing gh reviews --format json
```

## Anti-patterns

- Dumping `gh pr diff` or the entire unified patch into context.
- Calling `GET /api/gh/session` for “status” when `gh overview` exists.
- Loading every resolved historical thread body when only unresolved feedback matters.
- Starting a duplicate PR session when a compatible one can be selected by ID.
