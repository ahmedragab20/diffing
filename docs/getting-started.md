# Getting Started with diffing

> **Public docs:** [Getting started on the docs site](https://ahmedragab20.github.io/diffing/docs/getting-started/).

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

## AI assistance in web review

The web UI can connect local AI runtimes or provider API keys from **Settings →
AI connections**. Connections and the selected model are global: changing them
from a diff, plan, or mockup Settings panel updates every review surface.

Supported routes:

- Codex / ChatGPT and Claude Code account sign-in
- OpenCode- and Cursor-managed provider keys and model catalogs
- Direct Grok API keys

Direct keys are stored in the operating-system credential vault when available.
If the vault is unavailable, diffing keeps the key in server memory for the
current session only. Runtime-managed keys remain owned by OpenCode or Cursor;
diffing never reads or duplicates their credential files. Secrets are never
written to `settings.json`.

AI is **always user-triggered**. Loading a review, selecting lines, hovering,
refreshing a diff, switching plan versions, or changing Settings never starts
inference. Use a labeled Ask AI, Summarize, Review risks, Draft, or Improve
action. Generated text remains a draft until you explicitly insert or submit it.

The toolbar model picker (and **Settings → AI connections → Default model**)
persist the chosen model in `aiModel` across reloads. The connections section is
collapsed by default and remembers its expanded state.

**Ask AI** opens a resizable rail with surface-specific quick actions
(Summarize, Review risks / Find gaps, Review map / Explain context / Critique
plan). Conversations persist under the per-repo store (`ai-conversations.json`),
scoped by surface + repo/branch or plan id — list, rename, or delete threads as
needed.

Inside the AI composer, type `@` to attach repository files. Suggestions use
the same FFF index and frecency ranking as diffing search. Attached text is
loaded only when you explicitly send the request, is bounded to eight text
files / 64 KB total, and is shown as removable context chips. Paste, drag, or
attach images (PNG/JPEG/WebP/GIF; up to four, 10 MB each) when the selected
model source supports images.

A whole-diff ask sends the review’s changed-file map and diff content within
the context budget; the focused file is only a navigation hint. You can attach
up to eight explicit line ranges (64 KB total) to prioritize. Responses stream
into the rail as GFM Markdown (tables, fenced code, Mermaid, copy).

Comment forms offer Draft / Improve / Shorter / More specific / Generate
suggestion helpers. Send review can draft a summary from open comments.

Only the context preview shown in the UI is sent. Diff requests do not silently
include plans; plan requests do not silently include diffs; mockup requests do
not silently include diffs or plans.

Mockup review has **Ask AI** (the rail starts closed), comment chips, Generate
this screen, Rewrite region, and Attach preview. All of those are opt-in.
Opening `/mockup`, submitting a screen, pinning a comment, or switching versions
never starts inference. `--model` on CLI submit/reply is provenance only.

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
| -------- | ------------- |
| `not inside a git repository` | `cd` into a repo, or run `diffing setup` outside a repo then `cd <repo> && diffing` |
| First-run prompt every time | Run `diffing setup` to completion, or use `--skip-setup` |
| MCP tools missing in IDE | `diffing setup mcp --write-mcp` or paste JSON from `diffing setup --yes` |
| Skills not found | `npx skills add ahmedragab20/diffing` |
| Server won't start | `diffing doctor`, ensure port not blocked, try `diffing --port 3433` |

---

## Next steps

- [CLI reference](cli.md) — every subcommand, flag, exit code, and `/api/ai/*`
- [README](../README.md) — features, themes, plan review
- [AGENTS.md](../AGENTS.md) — agent workflows (plan review, code review, MCP)
