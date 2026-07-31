---
title: Exit codes
description: Process exit codes for agent-facing CLI commands.
summary: 0 ok, 2 await timeout, 3 no server, 4 not found, 5 usage — timeout is a park signal.
order: 7
section: reference
---

| Code | Meaning | Typical commands |
|------|---------|------------------|
| `0` | Success | Most commands |
| `2` | Await **timeout** (park — not a crash) | `await-review`, `plan await` |
| `3` | No active server for this repository | Agent cmds needing lockfile |
| `4` | Resource not found (comment/plan id) | `reply`, `resolve`, … |
| `5` | Usage / invalid arguments | Any |

## Await timeout policy

Exit `2` means the wait budget elapsed (default **570s**). Agents should:

1. Treat it as `disposition=park`
2. **End the turn** (async resume later)
3. Re-await only if the human asked to keep waiting — never silent-loop

## Shell example

```bash
diffing await-review
case $? in
  0) echo "review received" ;;
  2) echo "park — human not done" ;;
  3) echo "start diffing first" ;;
  *) echo "error $?" ;;
esac
```
