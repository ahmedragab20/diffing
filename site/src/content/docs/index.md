---
title: Documentation
description: Map of diffing docs for humans and AI agents.
summary: Start here for the full documentation index — getting started, concepts, guides, and reference.
order: 1
section: start
---

**diffing** is a local-first CLI for reviewing git diffs with humans and AI agents. It runs a loopback web UI (or an experimental native TUI), stores review state under `~/.diffing/`, and exposes CLI + MCP tools for agent handoff and plan review.

## If you are an agent

1. Read [Agent handoff](/docs/guides/agent-handoff/) — async park is the default.
2. Install MCP / skills via [Setup & MCP](/docs/guides/setup-and-mcp/).
3. Prefer [MCP tools](/docs/reference/mcp/) when available; otherwise CLI from [CLI reference](/docs/reference/cli/).
4. For design sign-off before coding: [Plan review](/docs/guides/plan-review/).
5. Bulk ingest: [`/llms.txt`](/llms.txt) and [`/llms-full.txt`](/llms-full.txt).

| Verdict / signal | Action |
|------------------|--------|
| Plan `approved` | Implement the reviewed plan |
| Plan `changes-requested` | Revise plan, resubmit same id — do not implement |
| Plan `rejected` | Stop |
| Await `timeout` + `disposition=park` | End turn; resume when human is ready |
| Comment severity `blocking` | Must fix before resolve |
| Comment severity `question` | Reply; usually leave open |

## If you are a human

1. [Getting started](/docs/getting-started/) — install and first review.
2. [Code review](/docs/guides/code-review/) — web UI workflow.
3. [AI assistance](/docs/guides/ai-assistance/) — optional Ask AI rail (BYOK / SSO).
4. [Keyboard shortcuts](/docs/reference/keyboard/) — vim-style navigation.
5. [Themes](/docs/design/themes/) & [Gridline](/docs/design/gridline/) — visual system.

## Sections

| Section | What it covers |
|---------|----------------|
| **Start** | Install, setup, first review |
| **Concepts** | Architecture, sessions, storage |
| **Guides** | Review loops, AI assistance, agents, PR, TUI, search |
| **Reference** | CLI, MCP, HTTP API, XML, settings, exit codes |
| **Design** | Gridline design system, themes |

## Quick commands

```bash
npm install -g diffing
diffing setup
diffing                    # preferred interactive UI
diffing --staged
diffing view               # read-only native viewer
diffing mode tui           # make full TUI the default
diffing await-review       # sync handoff only
diffing plan submit PLAN.md --model "your-model"
diffing mcp
```

## Facts agents should not invent

| Do not assume | Correct |
|---------------|---------|
| Fixed default port | Random free port on `127.0.0.1` |
| App uses `localStorage` | Server-side under `~/.diffing/` + `~/.config/diffing/` |
| `t` cycles themes | `t` = tab size; themes = `g t` |
| ~10 MCP tools | **37** tools (see MCP reference) |
| ~42 themes | **52** themes; default **rose-pine** |
