---
name: diffing-pr-read
description: Read a GitHub pull request through diffing with token-efficient bounded inspect APIs instead of dumping gh pr view/diff or the full patch. Use when summarizing a PR, inspecting PR changes, preparing a review, or reading PR discussion with minimal context.
---

# Read a GitHub PR through diffing (token-efficient)

Prefer diffing’s slim PR overview and bounded diff inspect over `gh pr view`, `gh pr diff`, or `GET /api/diff` full patches.

## Setup

1. Target the correct repository. Prefer MCP `review_session_status` when available.
2. Ensure a PR session:
   - Reuse when `mode: gh-pr` and the ref matches.
   - Otherwise start: `diffing --gh-pr <ref> --no-open` (or `diffing "gh pr <ref>" --no-open`).
3. Do not replace a user-owned session bound to a different PR or local mode — report the conflict.

`<ref>` may be a number, `owner/repo#N`, or a full PR URL.

## Token-efficient read ladder

Never load the full patch or full session JSON by default.

| Step | MCP | CLI |
|------|-----|-----|
| Identity + counts | `gh_overview` | `diffing gh overview [--json]` |
| Patch totals | `diff_summary` | `diffing inspect summary` |
| File list | `diff_files` (page `nextCursor`) | `diffing inspect files --cursor N --limit 50` |
| Hunk map | `diff_hunks` | `diffing inspect hunks --file N --generation G` |
| Body rows | `diff_slice` | `diffing inspect slice --file N --start R --max-lines 120 --generation G` |
| Find text | `diff_search` | `diffing inspect search "literal" --generation G` |
| Discussion | `gh_list_threads` (`unresolvedOnly`) | `diffing gh threads --unresolved` |
| Verdicts | `gh_list_reviews` | `diffing gh reviews` |

### Rules

- Carry `generation` from `diff_summary` into hunks/slice/search. On stale generation (HTTP 409), re-run summary and restart that file’s traversal.
- Keep default or smaller line/byte budgets; raise only when necessary.
- Continue slices with `nextRow` and file lists with `nextCursor`. Continue search with `nextFile` + `nextRow`.
- Prefer `gh_list_threads` with `unresolvedOnly: true` and truncated bodies. Use `fullBody` / `--full-body` only for threads you will act on.
- Compact JSON is default. Avoid `--pretty` and avoid `GET /api/gh/session` (fat UI payload).
- `get_diff` / full `GET /api/diff` is an escape hatch only when inspect is unavailable.

## Optional: leave review findings

This skill is **read-first**. To post draft review comments on the PR session, follow **`diffing-review`** (PR section): create drafts via `gh_create_draft_comment` / `POST /api/gh/pr-session/comments`, then publish only with explicit user authorization (`gh_submit_review` dry-run first).

## CLI sketch

```bash
diffing --gh-pr 1234 --no-open
diffing gh overview --json
diffing inspect summary
diffing inspect files --limit 50
diffing inspect hunks --file 0 --generation <g>
diffing inspect slice --file 0 --start 0 --max-lines 120 --generation <g>
diffing gh threads --unresolved          # XML default
diffing gh reviews --format json
```

## Anti-patterns

- Dumping `gh pr diff` or the entire unified patch into context.
- Calling `GET /api/gh/session` for “status” when `gh overview` exists.
- Loading every resolved historical thread body when only unresolved feedback matters.
- Starting a second PR server for the same ref when a compatible session is already live.
