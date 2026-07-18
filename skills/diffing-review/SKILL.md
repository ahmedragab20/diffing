---
name: diffing-review
description: Review local git changes in diffing, inspect every changed file, and post actionable inline feedback for the human. Use when the user asks for a code review of working-tree, staged, commit, or branch changes through diffing.
user_invocable: true
---

# Review changes with diffing

Perform a review rather than implementing: inspect the complete diff, account for existing discussion, and post only findings that are specific and actionable.

## Prefer native MCP

When MCP tools are available:

1. `review_session_status`; `start_review_session` only if no matching session is running.
2. Inspect the patch:
   - Full: `get_diff`
   - Large diffs (preferred): `diff_summary` → `diff_files` → `diff_hunks` / `diff_slice` / `diff_search` as needed
3. `list_comments` so you do not duplicate existing feedback.
4. For each real finding, `create_comment` with exact repo-relative path, diff **side** (`additions` | `deletions`), target line or range (`lineNumber` / `startLineNumber`), line context, concise body, and optional **severity** (`blocking` | `nit` | `question` | `praise`).
5. Return a review summary. Await a human handoff only if the user asks you to stay in the loop.

Comment only on lines that exist on the selected side. When no changed line is an honest anchor, put the concern in the summary instead of fabricating a location. Small exact fixes may use a fenced ```suggestion block (human/agent can apply via `apply_suggestion`).

## CLI / HTTP fallback

```bash
diffing --web --no-open
diffing url
diffing comments --json
# TUI-only bounded reads (when a TUI session is active):
diffing inspect summary
diffing inspect files --limit 50
```

Fetch `GET /api/diff` and post `POST /api/comments` against `diffing url` only when native tools are unavailable. Do not hard-code a port.

Pasted `<code-review-comments>` XML is an offline discussion fallback and cannot create new live inline comments.

## Review quality

- Read the full diff and relevant surrounding code before commenting.
- Prioritize correctness, security, data loss, regressions, and missing tests over style.
- State the consequence and the smallest viable correction.
- Do not post praise, generic observations, or speculative issues without evidence.
- Check existing replies and resolved threads before duplicating.

When addressing existing human comments in the same request, follow **`diffing-finish-review`**: change requests are applied/replied/resolved; questions remain open after reply. **`comment-only` always forbids file edits.**
