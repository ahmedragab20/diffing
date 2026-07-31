# Getting Started with diffing

A five-minute path from install to your first review — plus migration and troubleshooting.

**Requirements:** Node.js 20+, `git` on your PATH, and a Git repository when you want to review code.

---

## 1. Install

```bash
npm install -g diffing
# or
pnpm add -g diffing
# or try without installing globally:
npx diffing setup --check
```

After a global install you may see a short postinstall banner (print-only; nothing is written to your IDE or project).

---

## 2. First-time setup

### Interactive gate

The first time you run `diffing` in a TTY (and setup is not marked complete), you get:

```text
[Y] Run setup now   [n] Skip   [?] Docs
```

- **Y** — runs `diffing setup` (doctor, default mode, optional skills/MCP)
- **n** — continues without setup (you can run `diffing setup` later)
- **?** — prints the getting-started doc URL

Skip the gate anytime with:

```bash
diffing --skip-setup
```

### Setup wizard

```bash
diffing setup          # interactive wizard
diffing setup --yes    # install skills + print MCP JSON (no IDE writes)
diffing setup --check  # preflight only
diffing setup --reset  # clear setupCompletedAt marker
```

On an interactive terminal, `diffing setup` and the first-run welcome use colored
step headers and gold-bordered panels. Set `NO_COLOR`, use a non-TTY pipe, or
`TERM=dumb` for plain output (as in CI).

Partial steps:

```bash
diffing setup skills
diffing setup mcp
diffing setup mcp --write-mcp              # merge into ~/.cursor/mcp.json, Claude Desktop, etc.
diffing setup mcp --write-project-mcp      # opt-in: .cursor/mcp.json in cwd
```

Aliases: `diffing init`, `diffing onboard`.

The wizard:

1. Checks Node ≥20, `git`, and `~/.config/diffing/`
2. Runs `diffing doctor`
3. Lets you choose web vs TUI as the default interactive mode
4. Optionally prints shell completions (`diffing completion <shell>`)
5. Installs agent skills via `npx skills add ahmedragab20/diffing`
6. Prints MCP JSON; writes IDE configs only with `--write-mcp` (global) or `--write-project-mcp` (project)

---

## 3. Review your changes

Inside a Git repo:

```bash
cd /path/to/your-repo
diffing
```

This starts the review UI (web by default) and opens your browser.

Useful variants:

```bash
diffing --staged
diffing main..feature
diffing view              # read-only native TUI browser
diffing mode tui          # make TUI the default interactive mode
```

---

## 4. Agent handoff (optional)

For AI agents in Cursor, Claude Code, or other MCP clients:

1. Run `diffing setup` and either paste the printed MCP JSON or use `--write-mcp`
2. Install skills: `npx skills add ahmedragab20/diffing` (or let setup do it)
3. Start a review: `diffing` (human reviews in the browser)
4. Agent waits: `diffing await-review` or MCP `await_review`

Full CLI and MCP reference: **[cli.md](cli.md)**.

---

## Migrating from manual MCP / skills

Already using diffing without the wizard?

```bash
diffing setup --check
diffing setup mcp --write-mcp        # merge diffing entry only; backs up under ~/.diffing/backups/
diffing setup skills --yes
diffing setup --reset && diffing setup   # re-run full wizard
```

MCP merge updates **only** the `diffing` server key — other MCP servers are preserved.

---

## Troubleshooting

```bash
diffing doctor
diffing setup --check
```

| Symptom | What to try |
|--------|-------------|
| `not inside a git repository` | `cd` into a repo, or run `diffing setup` outside a repo then `cd <repo> && diffing` |
| First-run prompt every time | Run `diffing setup` to completion, or use `--skip-setup` |
| MCP tools missing in IDE | `diffing setup mcp --write-mcp` or paste JSON from `diffing setup --yes` |
| Skills not found | `npx skills add ahmedragab20/diffing` |
| Server won't start | `diffing doctor`, ensure port not blocked, try `diffing --port 3433` |

---

## Next steps

- [CLI reference](cli.md) — every subcommand, flag, and exit code
- [README](../README.md) — features, themes, plan review
- [AGENTS.md](../AGENTS.md) — agent workflows (plan review, code review, MCP)
