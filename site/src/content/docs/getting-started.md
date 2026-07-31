---
title: Getting started
description: Install diffing, run setup, and open your first review in minutes.
summary: Install with npm, run the setup wizard, then launch diffing inside a git repo to open the review UI.
order: 2
section: start
---

**Requirements:** Node.js 20+, `git` on your PATH, and a Git repository when reviewing code.

## Install

```bash
npm install -g diffing
# or
pnpm add -g diffing
# try without installing:
npx diffing setup --check
```

A short postinstall banner may print in interactive terminals (print-only — nothing is written to your IDE or project).

Upgrade later:

```bash
diffing update
```

## First-time setup

### Interactive gate

The first time you run `diffing` in a TTY (and setup is not marked complete), you get:

```text
[Y] Run setup now   [n] Skip   [?] Docs
```

- **Y** — runs `diffing setup` (doctor, default mode, optional skills/MCP)
- **n** — continues without setup
- **?** — prints the getting-started docs URL

Skip anytime with `diffing --skip-setup`. CI and non-TTY environments never show the prompt.

### Setup wizard

```bash
diffing setup          # interactive wizard
diffing setup --yes    # install skills + print MCP JSON (no IDE writes)
diffing setup --check  # preflight only
diffing setup --reset  # clear setupCompletedAt marker
```

Partial steps:

```bash
diffing setup skills
diffing setup mcp
diffing setup mcp --write-mcp              # merge into IDE MCP configs
diffing setup mcp --write-project-mcp      # opt-in project .cursor/mcp.json
```

Aliases: `diffing init`, `diffing onboard`.

The wizard:

1. Checks Node ≥20, `git`, and `~/.config/diffing/`
2. Runs `diffing doctor`
3. Lets you choose **web** vs **TUI** as the default interactive mode
4. Optionally prints shell completions (`diffing completion <shell>`)
5. Installs agent skills via `npx skills add ahmedragab20/diffing`
6. Prints MCP JSON; writes IDE configs only with `--write-mcp` / `--write-project-mcp`

## Review your changes

```bash
cd /path/to/your-repo
diffing
```

This starts the preferred interactive UI (web by default) and opens your browser.

Useful variants:

```bash
diffing --staged
diffing HEAD~3
diffing main..feature
diffing -- src/
diffing view              # read-only native TUI browser
diffing --tui             # full native review TUI (experimental)
diffing mode tui          # make TUI the interactive default
diffing --no-open         # start server without opening browser
diffing --port 3433       # fixed port
```

TTY auto-detect: interactive terminals open the UI; pipes/redirects print a unified patch like `git diff`. Force with `--web`, `--terminal`, `--view`, or `--tui`.

## Agent handoff (optional)

1. Run `diffing setup` and paste MCP JSON or use `--write-mcp`
2. Install skills: `npx skills add ahmedragab20/diffing`
3. Start a review: `diffing`
4. Agent waits only when you are reviewing now: `diffing await-review` or MCP `await_review`

Default agent behavior is **async**: share the UI URL, end the turn, resume when you say ready. See [Agent handoff](/docs/guides/agent-handoff/).

## Troubleshooting

```bash
diffing doctor
diffing setup --check
```

| Symptom | What to try |
|--------|-------------|
| `not inside a git repository` | `cd` into a repo |
| First-run prompt every time | Complete `diffing setup`, or use `--skip-setup` |
| MCP tools missing in IDE | `diffing setup mcp --write-mcp` or paste JSON from `diffing setup --yes` |
| Skills not found | `npx skills add ahmedragab20/diffing` |
| Server won't start | `diffing doctor`, try `diffing --port 3433` |

## Next

- [Code review](/docs/guides/code-review/)
- [CLI reference](/docs/reference/cli/)
- [Architecture](/docs/concepts/architecture/)
