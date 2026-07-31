---
title: GitHub PR review
description: Review a GitHub pull request locally through diffing.
summary: Open a PR session with diffing gh pr or --gh-pr; use bounded inspect and gh_* tools; mutate GitHub only with explicit authorization.
order: 4
section: guides
---

diffing can mirror a GitHub PR into a local review session (`mode: gh-pr`) so you get the same UI/TUI ergonomics without leaving the machine for reads.

## Open a PR session

```bash
diffing --gh-pr 123
diffing --gh-pr owner/repo#123
diffing --gh-pr https://github.com/owner/repo/pull/123
# equivalent:
diffing "gh pr 123"
```

Requires `gh` auth (or token) with access to the repository.

## CLI reads

```bash
diffing gh status
diffing gh overview
diffing gh threads
diffing gh reviews
diffing inspect summary
diffing inspect files
```

## MCP

| Tool | Use |
|------|-----|
| `gh_overview` | PR metadata + summary |
| `gh_list_threads` | Conversation threads |
| `gh_list_reviews` | Submitted reviews |
| `gh_list_draft_comments` | Local drafts |
| `gh_create_draft_comment` | Stage a draft locally |
| `gh_refresh` | Re-fetch after force-push / new activity |
| `gh_submit_review` | **Publish** — requires explicit user authorization |

Prefer bounded `diff_summary` → `diff_files` → `diff_hunks` → `diff_slice` over dumping the full patch.

## Authorization rule

**Read** freely in a PR session. **Mutate** GitHub (submit review, publish replies) only when the user explicitly authorizes. Tool descriptions mark remote publication accordingly.

## Local vs remote plan tools

Plan review tools need a **web** local session. Do not tear down a PR/TUI session just to submit a plan — start or select a compatible web session (`diffing --web --no-open` or `sessions use`).

## Related

- [Sessions](/docs/concepts/sessions/)
- [MCP tools](/docs/reference/mcp/)
