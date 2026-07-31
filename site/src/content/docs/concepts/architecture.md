---
title: Architecture
description: Local server, lockfile discovery, storage layout, and mode auto-detection.
summary: diffing runs a loopback Hono server, discovers sessions via per-repo lockfiles, and auto-detects TTY vs terminal patch output.
order: 2
section: concepts
---

## High level

```text
Human ──► Web UI / TUI ──► Local server (127.0.0.1:port)
                              │
Agent  ──► CLI / MCP  ────────┤
                              ▼
                     Git working tree
                     ~/.diffing/<repo>-<hash>/
```

The primary process either:

1. Starts a **review session** (web or TUI) with a random free port, or
2. Prints a **unified patch** when stdout is not a TTY (or `--terminal`).

## Output mode auto-detection

| Condition | Result |
|-----------|--------|
| Interactive TTY, preference `web` | Web server + browser |
| Interactive TTY, preference `tui` | Native review TUI |
| Pipe / redirect / non-TTY | Terminal patch (like `git diff`) |
| Explicit `--web` / `--tui` / `--view` / `--terminal` | Forced mode |
| Output-format flags (`--stat`, `--raw`, …) | Forces terminal mode |

Change preference: `diffing mode web` or `diffing mode tui` → stored in `~/.config/diffing/settings.json` as `defaultMode`.

## Session discovery

Every live web, TUI, or GitHub PR review registers under:

```text
~/.diffing/<repo-name>-<sha256(repo-root).slice(0,8)>/
├── server.json                 # active-session pointer
└── sessions/<session-id>.json  # one record per live session
```

Agent commands (`url`, `comments`, `await-review`, `plan …`, MCP) read the **active** session from `server.json` — no hardcoded ports.

Example lock shape:

```json
{
  "port": 3433,
  "host": "127.0.0.1",
  "pid": 45192,
  "repoRoot": "/Users/dev/my-app",
  "sessionId": "…",
  "mode": "web"
}
```

`mode` is `"web" | "tui" | "gh-pr"`. Stale PIDs are pruned; if the active session dies, the newest live session is elected.

See [Sessions](/docs/concepts/sessions/) for multi-session lifecycle.

## Auth on loopback

Loopback binds generate a per-session API token stored in the lockfile. The web UI uses an HttpOnly cookie; CLI/MCP send `x-diffing-token`. Browseable URLs never include `?token=`.

LAN expose requires deliberate flags:

```bash
diffing --host 0.0.0.0 --insecure-no-auth
```

## Storage

| Path | Contents |
|------|----------|
| `~/.diffing/<repo>-<hash>/` | comments, plans, sessions, attachments, search DBs |
| `~/.config/diffing/settings.json` | theme, defaultMode, editor, UI prefs |

The real app does **not** use browser `localStorage` for session state.

## Real-time

`GET /api/live` SSE: `heartbeat` (~15s), `change`, `comments`, `plans`, `agent-status`, `plan-review-status`. Filesystem watchers on the repo and storage dir keep UIs live.

## Next

- [Sessions](/docs/concepts/sessions/)
- [Storage & security](/docs/concepts/storage/)
- [HTTP API](/docs/reference/http-api/)
