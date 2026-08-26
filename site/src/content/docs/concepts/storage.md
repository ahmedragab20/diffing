---
title: Storage & security
description: Where state lives, bind defaults, path safety, and pruning.
summary: Per-repo data under ~/.diffing/, settings under ~/.config/diffing/, loopback bind by default with path-traversal protection.
order: 4
section: concepts
---

## Paths

| Location | Purpose |
|----------|---------|
| `~/.diffing/<repo-name>-<8-char-hash>/` | Per-repository server state |
| `~/.config/diffing/settings.json` | User preferences (theme, mode, editor, …) |
| `~/.diffing/backups/` | MCP config backups from setup merge |

Repo hash is `sha256(absolute-repo-root).slice(0, 8)`.

Typical per-repo contents:

```text
server.json
sessions/
comments.json
plans.json
mockups.json
mockup-sources/         # mirrors each submitted screen: <id>/<screen>.html
plan-sources/
ai-conversations.json   # Ask AI threads (capped count / age)
attachments/
fff/                 # search frecency + history DBs
```

Inactive projects may be auto-pruned after prolonged inactivity (see product settings/docs for current window).

## Network defaults

- **Host:** `127.0.0.1`
- **Port:** OS-selected free port, or `--port <n>`
- **LAN:** only with `--host 0.0.0.0` (or `::`) **and** `--insecure-no-auth`

## Path safety

- `..` and null bytes rejected
- Paths URL-decoded and constrained to the repository root
- Escape attempts return **403**
- Attachments isolated under the per-repo `attachments/` directory

## Privacy

- No account, no telemetry, no required cloud
- GitHub features only run when you open a PR session / authorize publish
- Agent plans and scratch should live under `~/.diffing/…/plan-sources/`, not in the consumer working tree
- Direct AI API keys use the OS credential vault (or session memory) — never `settings.json`. OpenCode/Cursor-managed keys stay in those runtimes.

## Related

- [Settings](/docs/reference/settings/)
- [AI assistance](/docs/guides/ai-assistance/)
- [Architecture](/docs/concepts/architecture/)
