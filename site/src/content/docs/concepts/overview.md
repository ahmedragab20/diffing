---
title: Overview
description: What diffing is, who it is for, and how the pieces fit together.
summary: diffing is a local-first git diff review tool for humans and AI agents with web UI, optional Ask AI, TUI, plan review, and MCP.
order: 1
section: concepts
---

## What it is

**diffing** replaces `git diff` when you want a review workspace instead of a patch dump:

- **Humans** review changes in a local browser UI (or experimental native TUI), leave inline comments, optionally use the in-UI Ask AI assistant, and send rounds to an agent.
- **Agents** discover the server via a per-repo lockfile, fetch comments, reply/resolve, submit plans for approval, and inspect diffs in bounded slices.
- **Nothing leaves the machine** by default — bind is `127.0.0.1`, storage is under `~/.diffing/`. Optional AI calls only run when you trigger them and only with providers you connect.

## What it is not

- Not a hosted SaaS or cloud review product
- Not a replacement for GitHub PR hosting (though it can **mirror** a PR for local review)
- Not only a terminal pager — the TUI is opt-in/experimental; web is the supported production path

## Surfaces

| Surface | Command | Role |
|---------|---------|------|
| Web review UI | `diffing` / `--web` | Full review: comments, plans, optional Ask AI, search, themes |
| Native TUI | `diffing --tui` / `mode tui` | Experimental full review in terminal |
| Read-only viewer | `diffing view` | Fast interactive diff browser |
| Terminal patch | pipe / `--terminal` | Standard unified diff on stdout |
| MCP | `diffing mcp` | Tool surface for AI coding agents |
| CLI agent cmds | `await-review`, `reply`, `plan …` | Port-agnostic handoff |

## Core loops

### Code review

```text
human opens diffing → comments on lines → Send to agent
  → agent replies / edits / resolves → human continues
```

### Plan review

```text
agent submits markdown plan → human comments + verdict
  → approved → implement
  → changes-requested → revise same plan id
  → rejected → stop
```

## Design language

The product UI uses **Gridline** — a terminal-native design system shared by the web UI and Rust TUI. Flat surfaces, monospaced type, one-pixel rules, color for state not decoration. See [Gridline](/docs/design/gridline/).

## Next

- [Architecture](/docs/concepts/architecture/)
- [Sessions](/docs/concepts/sessions/)
- [AI assistance](/docs/guides/ai-assistance/)
- [Agent handoff](/docs/guides/agent-handoff/)
