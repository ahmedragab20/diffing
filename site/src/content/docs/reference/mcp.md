---
title: MCP tools
description: All 37 Model Context Protocol tools exposed by diffing mcp.
summary: Session, bounded diff inspect, comments, plan review, and GitHub PR tools over stdio MCP.
order: 2
section: reference
---

Launch:

```bash
diffing mcp
diffing mcp --repo /absolute/path/to/repository
```

Client snippet:

```json
{
  "mcpServers": {
    "diffing": {
      "command": "diffing",
      "args": ["mcp"]
    }
  }
}
```

Successful calls return readable text plus schema-validated `structuredContent`. Count verified against `src/mcp.ts` `registerTool` (**37** tools).

## Session

| Tool | Purpose |
|------|---------|
| `review_session_status` | Inspect repo binding and active session; use `nextAction` first |
| `start_review_session` | Idempotently start/reuse loopback web session; never replaces user sessions |

## Diff inspection

Prefer bounded tools over `get_diff` for large trees.

| Tool | Purpose |
|------|---------|
| `get_diff` | Full patch (use sparingly) |
| `diff_summary` | High-level change summary (optional `exclude: ["lockfiles"]`) |
| `diff_files` | Paged file list (optional `path` glob; `nextCursor` is filtered) |
| `diff_hunks` | Hunks for a file (`path` XOR `file`) |
| `diff_slice` | Exact row window with budgets (`path` XOR `file`) |
| `diff_search` | Search within the diff (optional `path` glob) |

## Comments & handoff

| Tool | Purpose |
|------|---------|
| `create_comment` | Inline finding (path, side, line/range, body, optional severity) |
| `await_review` | Sync wait for human Send to agent |
| `list_comments` | Snapshot threads |
| `reply_to_comment` | Agent reply |
| `resolve_comment` / `unresolve_comment` | Lifecycle |
| `edit_comment` / `delete_comment` | Mutate thread |
| `edit_reply` / `delete_reply` | Mutate reply |
| `apply_suggestion` | Apply ```` ```suggestion ```` fence |
| `resolve_all_comments` | Bulk resolve |
| `report_progress` | Live toast |
| `get_review_history` | Multi-round history |

## Plan review

| Tool | Purpose |
|------|---------|
| `submit_plan` | Submit markdown (async park default) |
| `await_plan_review` | Sync wait for verdict |
| `list_plans` | All plans |
| `get_plan` | Current plan + comments as XML/data |
| `get_plan_versions` | Version metadata |
| `get_plan_version` | Historical body |
| `reply_to_plan_comment` | Reply |
| `resolve_plan_comment` | Resolve thread |

## GitHub PR

| Tool | Purpose |
|------|---------|
| `gh_overview` | PR overview |
| `gh_list_threads` | Threads |
| `gh_list_reviews` | Reviews |
| `gh_list_draft_comments` | Local drafts |
| `gh_create_draft_comment` | Create draft |
| `gh_refresh` | Re-fetch remote state |
| `gh_submit_review` | Publish review (**explicit user auth**) |

## Await semantics

`await_review` / `await_plan_review` return `status: "released" | "timeout"`. Timeout includes `disposition: "park"` and `nextAction` — **end the turn**, do not silent-loop.

| Mode | When | Action |
|------|------|--------|
| Async (default) | Human may take a while | Share URL; park |
| Sync | Human reviewing now | One await (~570s); on timeout park |

## Prompts & resource

- Prompt `review_local_changes`
- Prompt `submit_plan_for_review`
- Resource `diffing://agent-guide`

## Related

- [Agent handoff](/docs/guides/agent-handoff/)
- [Setup & MCP](/docs/guides/setup-and-mcp/)
