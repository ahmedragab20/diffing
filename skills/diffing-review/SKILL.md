---
name: diffing-review
description: Review local git changes in diffing, inspect every changed file, and post actionable inline feedback for the human. Use when the user asks for a code review of working-tree, staged, commit, or branch changes through diffing.
---

# Review changes with diffing

Perform a review, rather than implementing the changes: inspect the complete diff, account for existing discussion, and post only findings that are specific and actionable.

## Prefer native MCP

When diffing MCP tools are available:

1. Call `review_session_status`; call `start_review_session` only if no matching session is running.
2. Call `get_diff` and inspect the entire patch, changed-file list, binary-file metadata, and repository context.
3. Call `list_comments` so you do not duplicate existing feedback.
4. For each real finding, call `create_comment` with the exact repo-relative path, diff side, target line or range, line context, and concise body.
5. Return a review summary. Await a human handoff only if the user asks you to stay in the review loop.

Comment only on lines that exist on the selected diff side. When no changed line is an honest anchor, include the concern in the review summary instead of fabricating an inline location. Small, exact fixes may use a fenced `suggestion` block.

## CLI fallback

If MCP is unavailable, use the port-agnostic CLI for discovery and discussion:

```bash
diffing --web --no-open
diffing url
diffing comments --json
```

Fetch `GET /api/diff` and post `POST /api/comments` against the URL returned by `diffing url` only when native `get_diff`/`create_comment` tools are unavailable. Do not hard-code a port. Use structured JSON and an HTTP client available in the harness; `curl` and `jq` are examples, not requirements.

Pasted `<code-review-comments>` XML is an offline discussion fallback, but it cannot create new inline comments in the live UI.

## Review quality

- Read the full diff and relevant surrounding code before commenting.
- Prioritize correctness, security, data loss, regressions, and missing tests over style.
- State the consequence and the smallest viable correction.
- Do not post praise, generic observations, or speculative issues without evidence.
- Check existing replies and resolved threads before creating a duplicate.

When addressing existing human comments as part of the same request, follow `diffing-finish-review`: change requests are applied/replied/resolved, while questions and ambiguous requests receive replies and remain open. `comment-only` always forbids file edits.
