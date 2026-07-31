---
title: Setup & MCP
description: First-run wizard, skills install, and MCP client configuration.
summary: Run diffing setup for doctor, skills, and MCP JSON; write IDE configs only with explicit flags.
order: 7
section: guides
---

## Setup wizard

```bash
diffing setup
diffing setup --yes
diffing setup --check
diffing setup skills
diffing setup mcp
diffing setup mcp --write-mcp
diffing setup mcp --write-project-mcp
```

`--write-mcp` merges **only** the `diffing` key into known IDE MCP configs and backs up under `~/.diffing/backups/`. Other servers are preserved.

## Skills

```bash
npx skills add ahmedragab20/diffing
```

| Skill | When |
|-------|------|
| `diffing` | Route any diffing request |
| `diffing-start-review` | Launch UI for human |
| `diffing-finish-review` | Process handoff comments |
| `diffing-review` | Agent posts inline review |
| `diffing-plan-review` | Plan gate before code |
| `diffing-pr-read` | Bounded PR inspection |
| `diffing-pr-address` | Turn PR feedback into local work |

## MCP server

```bash
diffing mcp
diffing mcp --repo /absolute/path/to/repo
```

Client config:

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

No port in the config. Repository is `--repo` or the git root of the MCP process cwd. Invalid selection fails instead of guessing.

## First tool calls

1. `review_session_status` — inspect binding / nextAction
2. `start_review_session` — only when needed (idempotent; never replaces user sessions)
3. Then diff inspect, comments, plan, or `gh_*` as appropriate

See [MCP tools](/docs/reference/mcp/) for the full 37-tool catalog.

## Doctor & completions

```bash
diffing doctor
diffing completion zsh
diffing completion bash
diffing completion fish
```
