---
title: Sessions
description: Concurrent review sessions, active pointer, and session manager commands.
summary: Multiple web/TUI/PR reviews can run concurrently; server.json points agent tools at the active session.
order: 3
section: concepts
---

## Concurrent sessions

Starting `diffing`, `diffing --web`, `diffing --tui`, or a GitHub PR review no longer conflicts with an existing review. Each launch gets its own port and registry record, becomes **active**, and leaves older sessions running.

| Flag | Behavior |
|------|----------|
| (default launch) | New session; becomes active |
| `--reuse-session` | Open the active session and exit |
| `--replace-session` | Stop active, then start with current args |

`--reuse-session` and `--replace-session` are mutually exclusive.

MCP `start_review_session` is conservative: it never stops or replaces a user-owned session and reports incompatible scope/mode conflicts.

## Session manager CLI

```bash
diffing sessions                       # table; * = active
diffing sessions --json
diffing sessions use <id>              # retarget agent commands
diffing sessions open [<id>|active]
diffing sessions stop <id>|active|all
diffing sessions kill <id>|active|all  # alias for stop
```

The first eight characters of an id are accepted when unique. Stopping the active session elects the newest remaining session.

## Agent tip

After `sessions use`, reconnect MCP so the new connection discovers the selected web session. Plan tools require `mode: web`.

## Modes on a session

| mode | Meaning |
|------|---------|
| `web` | Local working-tree (or range) review in browser |
| `tui` | Native terminal full review |
| `gh-pr` | GitHub PR mirror review |

In `gh-pr` mode, prefer `gh_*` and bounded `diff_*` tools; local plan tools need a web session.
