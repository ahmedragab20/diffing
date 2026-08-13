---
title: HTTP API
description: Loopback REST and SSE endpoints used by the UI, CLI, and agents.
summary: Review await/send, comments CRUD, plans, progress, live SSE, search, and attachments on the local server.
order: 3
section: reference
---

All endpoints are on the session base URL from `diffing url` (loopback). Authenticate with session cookie (browser) or `x-diffing-token` (CLI/MCP) on loopback binds.

## Handoff

| Method | Path | Role |
|--------|------|------|
| `POST` | `/api/review/send` | Human releases waiters; increments round |
| `GET` | `/api/review/await` | Long-poll (`sinceRound`, `timeoutMs` ≤ 50000) |
| `GET` | `/api/review/status` | Round / waiters snapshot |
| `GET` | `/api/review/history` | Multi-round history |

### send body

```json
{ "generalComment": "Optional markdown summary" }
```

### await response (released)

```json
{
  "status": "released",
  "round": 4,
  "payload": {
    "commentXml": "<code-review-comments>…</code-review-comments>",
    "openCount": 2,
    "comments": []
  }
}
```

## Bounded diff inspect

| Method | Path | Role |
|--------|------|------|
| `GET` | `/api/diff/summary?exclude` | Totals, kind counts, top-level directories. `exclude=lockfiles` drops lock/generated basenames from counts only |
| `GET` | `/api/diff/files?path&cursor&limit` | Paged file metadata. `path` is a git pathspec-ish glob; `nextCursor` indexes the filtered list |
| `GET` | `/api/diff/hunks?file\|path&cursor&limit&generation` | Hunk metadata. `path` XOR `file`; 0 matches → 404, many → 409 |
| `GET` | `/api/diff/slice?file\|path&start&maxLines&maxBytes&generation` | Bounded logical rows |
| `GET` | `/api/diff/search?q&path&file&row&limit&maxBytes&generation` | Literal search; optional `path` limits files |

## Comments

| Method | Path | Role |
|--------|------|------|
| `GET` | `/api/comments` | List threads |
| `POST` | `/api/comments` | Create (filePath, side, lineNumber, body, optional startLineNumber, severity) |
| `PUT` | `/api/comments/:id` | Edit body or `{ status }` |
| `DELETE` | `/api/comments/:id` | Delete |
| `POST` | `/api/comments/resolve-all` | Resolve all open |
| `POST` | `/api/comments/:id/replies` | Reply |
| `PUT` | `/api/comments/:id/replies/:replyId` | Edit reply |
| `DELETE` | `/api/comments/:id/replies/:replyId` | Delete reply |
| `POST` | `/api/comments/:id/apply-suggestion` | Apply suggestion fence |

## Agent progress

| Method | Path |
|--------|------|
| `POST` | `/api/agent/progress` |
| `GET` | `/api/agent/progress` |

```json
{ "message": "Working…", "model": "…", "pct": 40 }
```

## Live SSE

`GET /api/live` — events: `heartbeat`, `change`, `comments`, `plans`, `agent-status`, `plan-review-status`.

## Search

`POST /api/search` — `{ scope, query, limit, regex, changedPaths? }`  
`POST /api/search/track` — frecency update

## Attachments

`POST /api/attachments` (multipart) · `GET /api/attachments/:filename`  
Stored under per-repo `attachments/`.

## Plans

Plan CRUD and comments live under `/api/plans…` (list, get, versions, submit, comments, review status). Prefer CLI/MCP for agents; use HTTP when embedding or debugging.

## Other

| Path | Role |
|------|------|
| `POST /api/open-file` | Launch editor (vscode/zed/vim/neovim/default) |
| Git/IDE helpers | Diff options, settings persistence, etc. |

Deep endpoint catalog remains in repository `docs/cli.md` §11 for rare routes.

## Related

- [Comments XML](/docs/reference/comments-xml/)
- [Architecture](/docs/concepts/architecture/)
