---
name: diffing-review
description: Review code with diffing, inspect every changed file, and post actionable inline feedback. Use when the user asks to review working-tree, staged, commit, branch, or GitHub pull-request changes through diffing.
---

# Review changes with diffing

Perform a review rather than implementing: inspect the complete diff, account for existing discussion, and post only findings that are specific and actionable.

## Local web or TUI review

When MCP tools are available:

1. Call `review_session_status` and branch on `mode`. Use `start_review_session` only for `none`; it creates a web session and never replaces a user-owned TUI or GitHub PR session. If the mode is `gh-pr`, use the separate workflow below.
2. Inspect with the cheapest complete path for that mode:
   - **Web or TUI**: call `diff_summary` until `complete` is true → page all `diff_files` via `nextCursor` → inspect each changed file with `diff_hunks` and bounded `diff_slice` pages. Continue slices with `nextRow`.
   - Carry the summary `generation` into hunks, slices, and searches. On a stale-generation error, rerun the summary and restart traversal. Continue search with both `nextFile` and `nextRow`.
   - Use `diff_search` only to target literal, case-insensitive matches in changed paths/content; it does not prove full review coverage.
   - Use `get_diff` only as an escape hatch. Check binary/untracked metadata and use the exact status `diffArgs` plus local repository reads/git inspection for omitted or surrounding context.
3. `list_comments` with `openOnly: true` so you do not duplicate active feedback. Fetch resolved history only when it is relevant.
4. For each real finding, `create_comment` with:
   - exact repo-relative path
   - diff **side** (`additions` | `deletions`)
   - target line or **inclusive range** (`lineNumber` = bottom; optional `startLineNumber` = top)
   - `lineContent` for the span (joined lines when multi-line)
   - concise body
   - optional **severity**: `blocking` | `nit` | `question` | `praise` (omit or `none` = untriaged)
5. Return a review summary. Await a human handoff only if the user asks you to stay in the loop.

Comment only on lines that exist on the selected side. When no changed line is an honest anchor, put the concern in the summary instead of fabricating a location. Small exact fixes may use a fenced ```suggestion block (human/agent can apply via `apply_suggestion`).

For rows returned by `diff_slice`, anchor `add` and `context` rows on `side: additions` with `newLineno`; anchor `del` rows on `side: deletions` with `oldLineno`. Use the exact `path` from `diff_files` and the row `content` as `lineContent`.

## GitHub PR review

When status reports `mode: gh-pr`, use the PR-aware MCP tools or their port-agnostic CLI mirrors:

1. Call `gh_overview` (or `diffing gh overview --json`) and confirm it is the requested PR. Report a mismatch rather than replacing the live session. Refresh matching stale or force-pushed state with `gh_refresh` / `diffing gh pr-fetch <ref>`.
2. Inspect every changed file through `diff_summary` → paged `diff_files` → `diff_hunks` and bounded `diff_slice`. Read published conversations with `gh_list_threads` / `gh_list_reviews`, preferring unresolved and truncated bodies.
3. Fetch local drafts with `gh_list_draft_comments` or `diffing gh pr-list-comments`; do not duplicate drafts or published findings.
4. Create each local draft with `gh_create_draft_comment` or `POST /api/gh/pr-session/comments` using `filePath`, `side`, `lineNumber`, optional inclusive `startLineNumber`, exact `lineContent`, actionable `body`, and optional severity. Use `lineNumber: 0` only for an honest file-level concern with no changed-line anchor.
5. Return a summary and the local PR UI URL. Do not publish, reply to published threads, edit/delete published comments, or resolve/reopen GitHub threads unless the user explicitly requested that external mutation.

When publication is authorized, validate first with `diffing gh pr-review --decision <approve|comment|request-changes|draft> --dry-run`; then omit `--dry-run` to submit. Only open draft comments are included. A `draft` decision keeps the GitHub review pending. Use the dedicated `/api/gh/existing-comments/*` and `/api/gh/review-threads/*` routes for authorized published-thread actions.

### Local severity (triage labels)

| Value | Meaning for you later (handoff XML) |
|-------|-------------------------------------|
| `blocking` | Must fix before considering the review done |
| `nit` | Optional polish |
| `question` | Needs an answer (usually leave open after reply) |
| `praise` | Positive; no change required |
| omitted / `none` | Untriaged — treat as a normal request |

Human-created comments use the same field. On handoff, open comments appear as `<comment … severity="blocking">` (etc.) in `<code-review-comments>`. Prefer **blocking** for correctness/security; do not mark every nit as blocking.

### Multi-line comments

- `startLineNumber` + `lineNumber` form an **inclusive** range on that side (`line="10-15"` in XML).
- Address the whole span, not only the last line.
- The UI anchors the thread under the bottom line and may show range steppers for humans.

## CLI / HTTP fallback

```bash
diffing --web --no-open
diffing url
diffing comments --json
# Bounded reads (web, TUI, or PR session):
diffing inspect summary
diffing inspect files --cursor 0 --limit 50
diffing inspect hunks --file 0 --generation <generation>
diffing inspect slice --file 0 --start 0 --max-lines 120 --generation <generation>
diffing inspect search "literal" --generation <generation> --limit 25
```

Follow `nextCursor`, `nextRow`, or the `nextFile` + `nextRow` pair until null. Compact JSON is the token-efficient default; omit `--pretty`.

Fetch `GET /api/diff` and post `POST /api/comments` (JSON body may include `severity`, `startLineNumber`) against `diffing url` only when native tools are unavailable. Do not hard-code a port or directly edit diffing's storage JSON.

Pasted `<code-review-comments>` XML is an offline discussion fallback and cannot create new live inline comments.

## Review quality

- Read the full diff and relevant surrounding code before commenting.
- Prioritize correctness, security, data loss, regressions, and missing tests over style.
- State the consequence and the smallest viable correction.
- Do not post praise, generic observations, or speculative issues without evidence — use severity `praise` only when intentional positive feedback is warranted.
- Check existing replies and resolved threads before duplicating.

When addressing existing human comments in the same request, follow **`diffing-finish-review`**: change requests are applied/replied/resolved; questions remain open after reply. **`comment-only` always forbids file edits.**
