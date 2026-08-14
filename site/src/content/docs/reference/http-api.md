---
title: HTTP API
description: Loopback REST and SSE endpoints used by the UI, CLI, and agents.
summary: Review await/send, comments CRUD, plans, mockups, progress, live SSE, search, and attachments on the local server.
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

`GET /api/live` — events: `heartbeat`, `change`, `comments`, `plans`, `mockups`, `agent-status`, `plan-review-status`, `mockup-review-status`.

## Search

`POST /api/search` — `{ scope, query, limit, regex, changedPaths? }`  
`POST /api/search/track` — frecency update

## Attachments

`POST /api/attachments` (multipart) · `GET /api/attachments/:filename`  
Stored under per-repo `attachments/`.

## Plans

Plan CRUD and comments live under `/api/plans…` (list, get, versions, submit, comments, review status). Prefer CLI/MCP for agents; use HTTP when embedding or debugging.

## Mockups

Comment scope = **version + screen + viewport** (`desktop|tablet|mobile`); `viewport` is part of every posted comment and every inspect filter. Prefer CLI/MCP for agents; use HTTP when embedding or debugging.

| Method | Path | Role |
|--------|------|------|
| `GET` | `/api/mockups[?include=comments\|full]` | Compact summaries by default; `include=comments` adds threads (single-op lookup helpers); `include=full` returns raw records (compatibility) |
| `POST` | `/api/mockups` | Submit (`html` or `screens[]`; `id` resubmits → version++) |
| `GET` | `/api/mockups/:id` | One mockup (screens + comments) |
| `PUT` / `DELETE` | `/api/mockups/:id` | Update / delete |
| `GET` | `/api/mockups/:id/versions` · `/versions/:n` | Version metadata / historical body |
| `GET` | `/api/mockups/:id/inspect?view&status&screen&viewport&version&id&cursor&limit&context` | Bounded reads — `view=summary\|comments\|comment\|screen`, `context=none\|anchor\|source` (default `anchor`), bodies truncate at 400 chars, `nextCursor` pagination |
| `GET` | `/api/mockups/:id/screens/:screenId/document?version&viewport` | Served screen (injected probe; nonce echoed back on comment posts) |
| `PUT` | `/api/mockups/:id/screens/:screenId` | One-screen upsert (`html`, optional `label`, `expectedVersion`) |
| `PATCH` | `/api/mockups/:id/screens/:screenId` | Exact-text patch (`expectedText`, `replacement`, `expectedVersion`); 0 matches → 409 `exact-text-not-found` |
| `DELETE` | `/api/mockups/:id/screens/:screenId[?expectedVersion]` | One-screen remove (refuses last screen) |
| `POST` | `/api/mockups/:id/threads/batch` | **Atomic** thread batch `{ operations: [{ op: reply\|edit\|delete\|resolve\|unresolve, commentId, replyId?, body?, role?, model? }] }` — all validated before any applies; thread ops never bump the version |
| `POST` | `/api/mockups/:id/comments` | Create comment (`kind`, `screenId`, `body`, `viewport`, anchor fields, optional `nonce`) |
| `PUT` / `DELETE` | `/api/mockups/:id/comments/:commentId` | Edit body/status / delete |
| `POST` / `PUT` / `DELETE` | `/api/mockups/:id/comments/:commentId/replies[/:replyId]` | Reply / edit / delete reply |
| `POST` | `/api/mockups/:id/decision` | Submit review (`decision`, optional `decisionComment`, `mode`, focused `screen`/`viewport`); releases waiters |
| `GET` | `/api/mockup-review/await` · `/status` | Long-poll verdict / round snapshot |

Screen ops return the updated mockup; `expectedVersion` mismatch aborts with **409** (`version-mismatch`, nothing applied). Verdicts release waiters via `GET /api/mockup-review/await` and `GET /api/mockup-review/status`.

## Other

| Path | Role |
|------|------|
| `POST /api/open-file` | Launch editor (vscode/zed/vim/neovim/default) |
| Git/IDE helpers | Diff options, settings persistence, etc. |

Deep endpoint catalog remains in repository `docs/cli.md` §11 for rare routes.

## Related

- [Comments XML](/docs/reference/comments-xml/)
- [Architecture](/docs/concepts/architecture/)
