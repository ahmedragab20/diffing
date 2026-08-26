---
title: Agent handoff
description: Async vs sync review loops, park discipline, exit codes, and MCP/CLI pairing.
summary: Default is async park after sharing the URL; use await only for live reviews; timeout means park not retry-forever.
order: 4
section: guides
---

The handoff protocol is **agent waits, human releases** for sync waits, plus a default **async park/resume** path so agents do not burn tokens holding a turn open.

## Async (default)

```text
Agent opens review / submits plan
  → gets URL + nextAction=park
  → ends turn (no await loop)
Human reviews when ready
  → says "ready" / agent resumes
Agent runs one await OR comments --open / get_plan
```

**Do not** silent-loop on timeout. At most one extra await if the human asked you to keep waiting.

## Sync (human at the keyboard)

```bash
diffing await-review [--timeout 570]
# or MCP await_review
```

Long-poll until **Send to agent**. Default timeout **570s**.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | OK — payload received |
| `2` | Await timeout (expected park signal) |
| `3` | No server for this repo |
| `4` | Not found (e.g. comment id) |
| `5` | Usage error |

On timeout, stderr includes `DIFFING_AWAIT_TIMEOUT` and a park hint.

## Discovery

No port configuration:

```bash
diffing url
diffing sessions --json
diffing sessions use <id>
```

MCP binds a repository (`diffing mcp [--repo /abs/path]`) and discovers the active lockfile.

## MCP vs CLI

| MCP | CLI |
|-----|-----|
| `await_review` | `diffing await-review` |
| `list_comments` | `diffing comments [--open] [--format xml\|json\|md]` |
| `reply_to_comment` | `diffing reply` |
| `resolve_comment` / `unresolve_comment` | `diffing resolve` / `unresolve` |
| `report_progress` | `diffing progress --message "…"` |
| `diff_*` | `diffing inspect …` |
| Plan tools | `diffing plan …` |
| `gh_*` | `diffing gh …` |

Full catalog: [MCP tools](/docs/reference/mcp/).

## Comment-only mode

If a released handoff has mode `comment-only`, **reply without editing files**.

## Skills

```bash
npx skills add ahmedragab20/diffing
```

Skills: `diffing`, `diffing-start-review`, `diffing-finish-review`, `diffing-review`, `diffing-plan-review`, `diffing-pr-read`, `diffing-pr-address`.

## Related

- [Code review](/docs/guides/code-review/)
- [Plan review](/docs/guides/plan-review/)
- [Exit codes](/docs/reference/exit-codes/)
