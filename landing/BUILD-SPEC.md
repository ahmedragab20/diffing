# diffing — Landing Page Build Spec

> A single-page, no-build, vanilla HTML/CSS/JS marketing site for the **diffing** CLI,
> using a terminal *aesthetic* (diffing is a CLI that opens a browser-based review UI —
> it is NOT a terminal UI application). Every number, flag, command,
> color token, and sound parameter in this spec was re-verified against the source on
> 2026-05-31. **Use only the values written here. Where a README claim conflicts, the
> corrected value is in §4 "DO NOT SAY".**

---

## 0. VERIFICATION SUMMARY (anchors re-checked against source)

| Fact | Verified value | Source |
|---|---|---|
| Package name / version / license | `diffing` / `0.2.1` / MIT | package.json |
| Repo / bin | github.com/ahmedragab20/diffing / `diffing` → `./dist/cli.mjs` | package.json |
| Default theme | `nord` | settings.ts, App.tsx fallback `settings.theme \|\| 'nord'` |
| Default UI font | **Geist Mono** | global.css:51 `--font-sans` |
| Default mono/code font | **JetBrains Mono** | global.css:54 `--font-mono` |
| **Theme count** | **52** (exact, counted `{ id:` entries 14–91) | ThemeModal.tsx |
| **Developer quotes** | **31** (exact, QUOTES array lines 44–74) | startup-display.ts |
| Startup animations | 6 | startup-display.ts |
| Startup palettes | 6 monochromatic 256-color | startup-display.ts |
| Sound presets | 11 | useHaptics.tsx `synth()` |
| Haptic presets | 10 | useHaptics.tsx `HapticPreset` |
| MCP tools | 10 | mcp.ts `registerTool` × 10 |
| Theme selector key | **`g t`** (NOT plain `t`) | App.tsx:802 |
| Plain `t` | cycles **tab size** 2→4→8 | App.tsx:757 `cycleTabSize` |
| `await`/`plan await` default timeout | 570 s | cli-agent.ts:55 |
| Agent exit codes | 0 OK · 2 await-timeout · 3 no-server · 4 not-found · 5 usage | cli-agent.ts:21–25 |

> **CRITICAL CORRECTION (overrides the brief):** the design direction says "pressing `t`
> cycles themes app-wide." That is **wrong in the real app** — `t` cycles **tab size**, and
> the theme picker opens with **`g t`**. The landing page MUST teach `g t` for the theme
> selector. Plain `t` may be wired to cycle the page theme as a *creative liberty*, but the
> on-screen shortcuts help and copy must label the real binding. See §4.

---

## 1. FINAL, ACCURATE SITE COPY

All copy below is approved verbatim. Numbers/flags/commands are the verified ones.

### 1.1 Top status strip (always visible, fixed)
Left → right, monospace, separated by `│`:

```
▰ DIFFING   v0.2.1   127.0.0.1:4317   LOCAL-FIRST AI COLLABORATION REVIEW WORKSPACE   [ AUDIO ●ON ]  [ HAPTICS ●ON ]  [ ⭷ GitHub ]
```

- `▰ DIFFING` — brand badge (uses `--primary`).
- `v0.2.1` — literal version.
- `127.0.0.1:4317` — host:port. **4317 is a decorative placeholder port**; the real CLI binds `127.0.0.1` and picks a *random available port* (or `--port <port>`). Render the number with a subtle "(demo)" tooltip on hover so it never reads as a hard fact.
- `LOCAL-FIRST AI COLLABORATION REVIEW WORKSPACE` — tagline strip.
- `[ AUDIO ]` / `[ HAPTICS ]` — toggles (wired, §3.2/§3.3), persisted to localStorage.
- `[ ⭷ GitHub ]` — links to `https://github.com/ahmedragab20/diffing`.

### 1.2 Hero
- **Headline:** `git diff, reimagined as a review workspace.`
- **Sub-headline:**
  `diffing is a drop-in replacement for `git diff` that opens your changes in an interactive,
  local-first browser UI — review, comment, and hand off to your AI agent without leaving the terminal.`
- **Eyebrow / kicker:** `LOCAL-FIRST · NO ACCOUNT · NO CLOUD · MIT`
- **Primary CTA:** `npm install -g diffing`  (click-to-copy)
- **Secondary CTA:** `▷ Try the shell below` (scrolls to interactive shell)
- **Micro-line under CTAs:** `Auto-detects your terminal: TTY → opens the web UI · pipe/redirect → prints a unified patch.`

### 1.3 Install / Run / Update commands (click-to-copy each)
```
# Install (global)
npm install -g diffing

# Review uncommitted changes (opens the web UI on a TTY)
diffing

# Review staged changes
diffing --staged

# Review the last 3 commits
diffing HEAD~3

# Compare two branches
diffing main..feature

# Limit to a path
diffing -- src/

# Expose to your LAN (default bind is 127.0.0.1)
diffing --host 0.0.0.0

# Pick a fixed port (otherwise a random free port is chosen)
diffing --port 4317

# Don't auto-open the browser
diffing --no-open

# Upgrade to the latest version
diffing update
```
Footnote copy: `diffing update self-upgrades via npm (or pnpm if present): npm install -g diffing@latest`.

Skills install (for AI assistants):
```
npx skills add ahmedragab20/diffing
```

### 1.4 What it is (3 short value props)
1. **Drop-in for `git diff`.** Same revisions, options, and pathspecs. 60+ git-compatible flags across 12 categories. Swap `git diff` → `diffing` and review in the browser.
2. **Two output modes, auto-detected.** TTY launches the local web server; a pipe or redirect prints a standard unified patch to stdout. Force either with `--web` or `--terminal`.
3. **Built for human + agent review.** Inline comments, plan review, and an AI handoff protocol over a local HTTP/SSE server and an MCP server — all on `127.0.0.1`, nothing leaves your machine.

### 1.5 Web-UI features
- Split and unified diff views (toggle with `m`); syntax highlighting via Shiki.
- Inline comments anchored to `+`/`-` lines or whole files, with threaded replies.
- "Apply suggestion" — pull a ```` ```suggestion ```` block straight into the file and auto-resolve the comment.
- Image diff previews for PNG, JPEG, GIF, WebP, SVG, BMP, ICO, AVIF.
- Per-file "viewed" tracking, hunk revert, and per-hunk git-blame history.
- Open any file in your editor (VS Code, Zed, Vim, Neovim, or system default).
- All session state (sidebar, active file, scroll, viewed flags) is reconstructed from the server — no localStorage in the real app.

### 1.6 Themes
- Copy headline: **52 built-in themes** (not "42+") with instant switching, live preview, and dark/light variants.
- Body: `Nord (the default), the full GitHub family, Dracula, One Dark, Synthwave '84, Tokyo Night, Catppuccin (Mocha · Frappé · Macchiato · Latte), Solarized, Monokai, Ayu, the Nightfox family (7 colorways), Rosé Pine (3), Material (5), Slack (2), Vitesse (3), Vesper, Poimandres, Night Owl, and more.`
- Interaction line: `Press `g t` to open the theme picker — search, filter by dark/light, arrow-key navigate, Enter to apply, Esc to close.`

### 1.7 Search (Rust-powered, fff)
- Headline: **Native Rust-powered code search** across four scopes.
- Scopes: `Files` (fuzzy), `Text` (grep, with regex), `Symbols` (17 patterns across JS/TS, Go, Rust, Python), `All` (unified).
- Symbol kinds detected: functions, classes, interfaces, types, enums, variables, structs, impl blocks, traits, methods.
- Frecency-ranked results backed by SQLite (`frecency.db`, `history.db`) under the per-repo storage dir; the engine keeps its own filesystem watcher so the index stays fresh during review.
- "Changed only" filter restricts results to files in the active diff.
- Graceful degradation: if the native binary isn't available on your platform, search reports unavailable — the server never crashes.
- Limits: default 60 results, max 200.

### 1.8 Keyboard shortcuts table (authoritative — copy verbatim into the help overlay)

| Key | Action |
|---|---|
| `j` / `k` | Scroll down / up (100px) |
| `Ctrl+d` / `Ctrl+u` | Scroll half-page down / up |
| `g g` | Jump to top |
| `G` | Jump to bottom |
| `J` / `K` | Next / previous file |
| `v` | Toggle file viewed / unviewed |
| `m` | Toggle split / unified diff |
| `t` | Cycle tab size (2 → 4 → 8) |
| `w` | Toggle line wrap |
| `n` | Toggle line numbers |
| `i` | Cycle diff indicators (classic → bars → none) |
| `I` | Cycle inline diff type (word → word-alt → char → none) |
| `b` | Toggle sidebar |
| `/` | Text search palette |
| `s` | Symbol search palette |
| `g v` | File browser palette |
| `g t` | Theme picker |
| `Cmd/Ctrl + K` | Command palette (works inside text fields) |
| `?` | This shortcuts help |

> Multi-key sequences use an **800 ms** buffer. A vim-style status bar shows **NORMAL** /
> **INSERT** depending on whether a text field is focused; all shortcuts are disabled while
> typing in an input/textarea/contenteditable.

### 1.9 Real-time / SSE
- Single SSE endpoint: `GET /api/live`.
- Named events: `heartbeat` (every **15 s**), `change` (working-tree changes, 200 ms debounce), `comments` (120 ms debounce), `plans` (120 ms debounce), `agent-status`, `plan-review-status`.
- Filesystem watcher on the repo root (recursive, 200 ms debounce; skips `.git`, `node_modules`, `dist`, `.changeset`) and on the storage dir for `comments.json` / `plans.json`.
- Copy line: `Edit a file, drop a comment, or have your agent reply — every browser tab updates live, with a 15-second heartbeat keeping the stream warm.`

### 1.10 AI handoff + MCP + Skills
- Headline: **Hand the review to your AI agent — locally.**
- Body: `Click "Send to agent" in the UI with a verdict (Approve / Request Edits / Reject) and an optional note. Your agent — running in the same repo — picks up the comments, replies inline, applies fixes, and resolves threads. No port to configure: discovery is automatic via a per-repo lockfile.`
- **CLI subcommands** (agent-facing, port-agnostic): `diffing await-review`, `diffing reply <id> --body <text>`, `diffing resolve <id>`, `diffing comments [--open] [--json]`, `diffing url`.
  - `diffing await-review` long-polls until you send your comments (default timeout **570 s**).
  - Exit codes: `0` ok · `2` await-timeout · `3` no server · `4` not found · `5` usage.
- **MCP server:** `diffing mcp`. Register it as:
  ```json
  { "mcpServers": { "diffing": { "command": "diffing", "args": ["mcp"] } } }
  ```
  Exposes **10 tools**: `await_review`, `list_comments`, `reply_to_comment`, `resolve_comment`,
  `submit_plan`, `await_plan_review`, `list_plans`, `get_plan`, `reply_to_plan_comment`, `resolve_plan_comment`.
- **Skills:** `npx skills add ahmedragab20/diffing` installs diffing skills into your AI coding assistant.

### 1.11 Plan review
- Headline: **Get sign-off before you write code.**
- Body: `Submit a markdown implementation plan and block until a human approves, rejects, or requests changes. Comment on specific plan lines or sections; the agent replies and resolves — then proceeds, revises and resubmits, or stops.`
- CLI: `diffing plan submit <file> [--title T] [--wait]`, `diffing plan await`, `diffing plan list`, `diffing plan show [<id>]`, `diffing plan reply <id> --body <text>`, `diffing plan resolve <id>`.
- Verdicts: **pending · approved · changes-requested · rejected**. `plan await` default timeout **570 s**.

### 1.12 Security & local-first
- Binds to **127.0.0.1** by default (pass `0.0.0.0` only to expose to the LAN deliberately).
- Path-traversal protection: `..` and null bytes are rejected, paths are URL-decoded and validated to stay inside the repo root; escape attempts return **403**.
- Attachments are isolated to the per-repo `attachments/` directory.
- No account, no telemetry, no cloud. Project data lives under `~/.diffing/<repo-name>-<8-char-hash>/`; global settings at `~/.config/diffing/settings.json`. Projects inactive for 14+ days are auto-pruned.

### 1.13 The feel — sounds, haptics, animation
- Headline: **It feels like a tool, not a webpage.**
- Body: `Every interaction is scored: 11 synthesized Web-Audio cues, 10 haptic presets, a terminal
  startup animation, and a vim status bar. A capture-phase listener gives every button, link,
  and checkbox a tactile click. Toggle AUDIO and HAPTICS in the status strip.`
- Quote ribbon line: `One of 31 curated developer quotes greets you on launch.`

### 1.14 Footer
`diffing v0.2.1 · MIT · github.com/ahmedragab20/diffing` · `Made for people who read diffs.`
Small print: `This page recreates the DIFFING workspace feel in the browser. All facts verified against source.`

---

## 2. PAGE OUTLINE (section-by-section, order + interactivity)

The page is a **two-column workspace** under the fixed status strip, mirroring the MVP
screenshot but improved. On narrow viewports it collapses to a single column (status strip →
hero → left stack → right stack → footer).

```
┌─ STATUS STRIP (fixed top) ──────────────────────────────────────────────┐
│ ▰ DIFFING  v0.2.1  127.0.0.1:4317  TAGLINE  [AUDIO][HAPTICS][GitHub] │
└──────────────────────────────────────────────────────────────────────────┘
┌─ HERO (full width boxed panel) ─────────────────────────────────────────┐
│ headline · sub · kicker · [npm install -g diffing copy] · [Try shell ▷] │
│ + boot animation plays here on first paint (typewriter into the box)    │
└──────────────────────────────────────────────────────────────────────────┘
┌── LEFT COLUMN ────────────────┐ ┌── RIGHT COLUMN ───────────────────────┐
│ A. WORKSPACE GUIDE (carousel) │ │ D. INTERACTIVE SHELL                  │
│ B. SPEC PROFILE (facts panel) │ │ E. LIVE DIFF SHOWCASE BOARD           │
│ C. THE FEEL (sound/haptic lab)│ │ F. THEME SELECTOR                     │
└────────────────────────────────┘ └────────────────────────────────────────┘
┌─ FEATURE SECTIONS (full-width boxed panels, stacked) ───────────────────┐
│ G. Search · H. Real-time/SSE · I. AI handoff/MCP/Skills · J. Plan review │
│ K. Security · L. Keyboard shortcuts table                                │
└──────────────────────────────────────────────────────────────────────────┘
┌─ FOOTER ────────────────────────────────────────────────────────────────┐
└──────────────────────────────────────────────────────────────────────────┘
+ floating: VIM STATUS BAR (bottom-left), AGENT-ACTIVITY TOAST (bottom-right),
  SHORTCUTS HELP OVERLAY (modal, opened by `?`).
```

**A. Workspace Guide — carousel** *(interactive)*
- A "guided tour" stepper with 5–6 slides, each a boxed mini-panel. Steps (titles + the
  copy from §1.4–§1.5): `① Drop-in for git diff` → `② Two output modes` → `③ Inline review`
  → `④ Hand off to your agent` → `⑤ Plan-first reviews` → `⑥ Local-first & secure`.
- Controls: `‹ prev` / `next ›` buttons + dot indicators; auto-advances every ~7 s (pause on
  hover/focus). Arrow keys when focused. Buttons fire `navigate` sound + `selection` haptic.

**B. Spec Profile — facts panel** *(static, scannable)*
- A `key: value` ledger styled like a terminal-style info box. Rows: `package`, `version 0.2.1`,
  `license MIT`, `bin diffing → ./dist/cli.mjs`, `default theme nord`, `ui font Geist Mono`,
  `code font JetBrains Mono`, `themes 52`, `mcp tools 10`, `git flags 60+ / 12 categories`,
  `default host 127.0.0.1`, `quotes 31`.

**C. The Feel — sound/haptic lab** *(interactive)*
- A grid of 11 buttons, one per sound preset (`click`, `toggle`, `navigate`, `open`, `close`,
  `success`, `resolve`, `send`, `error`, `warning`, `remove`). Clicking plays the **exact** synth
  (§3.2) and fires a matching haptic. Each button shows its note params as a caption.
- A second small row of 10 haptic-preset chips (`success … nudge`) that fire `navigator.vibrate`.
- Respects the AUDIO / HAPTICS toggles.

**D. Interactive Shell** *(interactive — the centerpiece)*
- A boxed terminal emulator with a prompt `~/repo on  main ❯`. The user types real subcommands;
  pressing Enter prints accurate output (see §3.5 command map). Supports `↑`/`↓` history, `Tab`
  completion against known commands, and `clear`. Typing fires no sound per keystroke (avoid
  fatigue); Enter fires `navigate`. Unknown commands print a helpful `diffing --help` hint.
- Seeded with a blinking cursor and a one-line hint: `try: diffing · diffing --help · diffing await-review · diffing plan submit · diffing mcp · diffing update`.

**E. Live Diff Showcase Board** *(interactive)*
- Two real-looking diff hunks rendered split-style with line numbers, `+`/`-` gutters, and Shiki-ish
  token coloring (use theme tokens). Clicking any `+` or `-` line opens an **inline comment bubble**
  anchored under that line (echoing the app): a small boxed editor with `Comment` / `Cancel`,
  plus a faux `Apply suggestion` affordance on lines that contain a ```suggestion``` block.
- Posting a comment: fires `success` sound + haptic, drops a comment node, and — after ~1.2 s —
  triggers a scripted **agent-activity toast** ("Agent replied · claude-… ") to demo the SSE handoff.
- A `Send to agent` button with a green pulsing dot (the `--success` color) and a verdict popover
  (`Approve` / `Request Edits` / `Reject`). Clicking fires the `send` arpeggio.

**F. Theme Selector** *(interactive)*
- A modal-or-inline grid of swatches for the **5 embedded themes** (§3.4): Nord, Catppuccin Mocha,
  Tokyo Night, Dracula, Rosé Pine. Each swatch shows bg/secondary/accent. Selecting one swaps
  `data-theme` on `<html>`, persists to localStorage, fires `toggle` sound. Opened with `g t`,
  closed with `Esc`. Label it `Themes (52 in the app · 5 previewed here)` so the 52 count stays honest.

**G–L. Feature sections** — full-width boxed panels using copy from §1.7–§1.12 and the
shortcuts table from §1.8. Each panel has an ASCII-style header bar `┤ SEARCH ├`, body copy,
and a small monospace "spec chip" row (e.g. for SSE: `heartbeat 15s · change 200ms · comments/plans 120ms`).

**Floating UI**
- **Vim status bar** (bottom-left, fixed): `-- NORMAL --` / `-- INSERT --` + current theme name +
  `tab:4` indicator that updates when `t` is pressed.
- **Agent-activity toast** (bottom-right): bot glyph, `Agent replied · <model>`, file path, 120-char
  body preview, auto-dismiss after **8 s**, click to dismiss. `aria-live="polite"`.
- **Shortcuts help overlay** (`?`): centered modal rendering the §1.8 table; `Esc` closes.

---

## 3. EXACT TECHNICAL ASSETS TO REPRODUCE

### 3.1 Typography & base
- Load from Google Fonts with monospace fallback:
  `Geist Mono` (UI) and `JetBrains Mono` (code/diffs).
  ```html
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  ```
- CSS vars (port the `:root` typography block verbatim from global.css:47–55):
  ```css
  --font-sans: "Geist Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  ```
  Body uses `--font-sans`; all diff/code/shell uses `--font-mono`.

### 3.2 Sound presets — full table (port the synth VERBATIM)
Recreate `synth(ctx, preset)` exactly as in `src/ui/hooks/useHaptics.tsx`. Signature:
`note(freq, type, vol, delay, dur, freqEnd?)` — create an `OscillatorWithGain`:
`osc.type=type`; `frequency.setValueAtTime(freq, t+delay)`; if `freqEnd` defined
`frequency.exponentialRampToValueAtTime(freqEnd, t+delay+dur)`; `gain.setValueAtTime(vol, t+delay)`;
`gain.exponentialRampToValueAtTime(0.001, t+delay+dur)`; `osc.start(t+delay)`; `osc.stop(t+delay+dur)`.
Use one shared `AudioContext`, resume on first user gesture.

| Preset | note() calls (verbatim) |
|---|---|
| `click`    | `note(700,'sine',0.16,0,0.03,350)` |
| `toggle`   | `note(460,'square',0.06,0,0.04,230)` |
| `navigate` | `note(520,'sine',0.07,0,0.02)` |
| `open`     | `note(210,'sine',0.12,0,0.13,560)` |
| `close`    | `note(560,'sine',0.10,0,0.11,210)` |
| `success`  | `note(523,'sine',0.17,0,0.10)` + `note(784,'sine',0.17,0.09,0.13)`  (C5→G5) |
| `resolve`  | `note(659,'sine',0.15,0,0.10)` + `note(988,'sine',0.15,0.09,0.13)`  (E5→B5) |
| `send`     | `note(523,'sine',0.15,0,0.10)` + `note(659,'sine',0.15,0.07,0.10)` + `note(784,'sine',0.15,0.14,0.14)` (C5-E5-G5 arpeggio) |
| `error`    | `note(280,'sawtooth',0.16,0,0.15,80)` |
| `warning`  | `note(330,'sine',0.13,0,0.09)` + `note(330,'sine',0.09,0.12,0.09)` |
| `remove`   | `note(380,'sine',0.13,0,0.08,140)` |

**Global capture-phase click listener** (port from useHaptics.tsx:210–232): on `document` with
capture=true, match `closest('button, a[href], [role="button"], input[type="checkbox"], [role="option"]')`,
skip disabled, fire haptic `selection` + sound `toggle` if it's a checkbox else `click`. Resume the
AudioContext if suspended. Gate on the AUDIO/HAPTICS toggles.

### 3.3 Haptic presets (10) — via `navigator.vibrate`
The app uses `web-haptics`; for the static page approximate each preset with a `navigator.vibrate`
pattern (guard for unsupported browsers; gate on HAPTICS toggle). Map:

| Preset | vibrate pattern (ms) suggestion |
|---|---|
| `selection` | `8` |
| `light` | `10` |
| `soft` | `12` |
| `medium` | `18` |
| `rigid` | `22` |
| `heavy` | `30` |
| `nudge` | `[6,40,6]` |
| `success` | `[12,30,18]` |
| `warning` | `[20,40,20]` |
| `error` | `[30,30,30,30,40]` |

Keep all 10 names exactly: `success, warning, error, light, medium, heavy, soft, rigid, selection, nudge`.

### 3.4 Theme CSS-variable blocks to embed (port VERBATIM from global.css)
Embed these **5** `[data-theme="…"]` blocks exactly as written in `src/ui/styles/global.css`.
Nord is the default (`<html data-theme="nord">`). The page should reference these tokens
(`--bg-primary`, `--text-primary`, `--primary`, `--success`, `--danger`, `--warning`, `--accent`,
`--border-color`, `--comment-bg`, `--comment-border`, etc.) for every surface.

1. **`nord`** (default) — global.css:151–183. Key tokens:
   `--bg-primary:#2e3440; --bg-secondary:#242933; --bg-tertiary:#3b4252; --text-primary:#eceff4;
   --text-secondary:#e5e9f0; --text-muted:#d8dee9; --border-color:#3b4252; --border-normal:#434c5e;
   --border-focus:#88c0d0; --primary:#88c0d0; --primary-hover:#8fbcbb; --accent:#b48ead;
   --success:#a3be8c; --danger:#bf616a; --warning:#ebcb8b; --comment-bg:#3b4252; --comment-border:#4c566a;`
2. **`catppuccin-mocha`** — global.css:186–218.
   `--bg-primary:#1e1e2e; --bg-secondary:#181825; --bg-tertiary:#313244; --text-primary:#cdd6f4;
   --primary:#cba6f7; --accent:#f5c2e7; --success:#a6e3a1; --danger:#f38ba8; --warning:#f9e2af;
   --comment-bg:#11111b; --comment-border:#313244;` (+ remaining tokens verbatim).
3. **`tokyo-night`** — global.css:571–603.
   `--bg-primary:#1a1b26; --bg-secondary:#16161e; --bg-tertiary:#24283b; --text-primary:#a9b1d6;
   --primary:#7aa2f7; --accent:#bb9af7; --success:#9ece6a; --danger:#f7768e; --warning:#e0af68;
   --comment-bg:#24283b; --comment-border:#7aa2f7;` (+ remaining tokens verbatim).
4. **`dracula`** — global.css:466–498.
   `--bg-primary:#282a36; --bg-secondary:#1e1f29; --bg-tertiary:#343746; --text-primary:#f8f8f2;
   --primary:#bd93f9; --accent:#ff79c6; --success:#50fa7b; --danger:#ff5555; --warning:#f1fa8c;
   --comment-bg:#343746; --comment-border:#bd93f9;` (+ remaining tokens verbatim).
5. **`rose-pine`** — global.css:1411–1443.
   `--bg-primary:#191724; --bg-secondary:#1f1d2e; --bg-tertiary:#26233a; --text-primary:#e0def4;
   --primary:#c4a7e7; --accent:#ea9a97; --success:#31748f; --danger:#ebbcbc; --warning:#f6c177;
   --comment-bg:#1f1d2e; --comment-border:#c4a7e7;` (+ remaining tokens verbatim).

> Each block also defines `--bg-secondary-rgb`, `--accent-subtle`, `--border-weak/normal/strong`,
> and the `--feedback-*` triplets — copy them all so hover/feedback surfaces match the app.

### 3.5 Interactive shell — accurate command map
The shell parser matches a leading token list and prints the responses below. Anything else →
`diffing: '<cmd>' is not a diffing command. Try 'diffing --help'.`

- **`diffing`** → `Auto-detects mode. On a TTY this starts the local web server (binds 127.0.0.1 on a random free port) and opens your browser to review uncommitted changes. Piped/redirected, it prints a unified patch to stdout.`
- **`diffing --help`** / **`diffing -h`** → print the help banner:
  `diffing v0.2.1 – Local code review tool for git diffs` + `Usage: diffing [<git diff options>] [<revision>...] [-- <path>...]` + the categorized flag groups (Revision/Range, Diff Algorithm, Whitespace, Context, Word Diff, Moved/Copied, Output Format, Filtering, Output Control, Prefixes, Submodule, Misc) and the Server Options (`--port`, `--host` default 127.0.0.1, `--no-open`) and the Examples block — all from §1.3 / printHelp.
- **`diffing --version`** / **`diffing -v`** → `diffing v0.2.1`
- **`diffing --staged`** → `Reviews staged changes (git diff --staged).`
- **`diffing HEAD~3`** → `Reviews the last 3 commits.`
- **`diffing main..feature`** → `Compares the main and feature branches.`
- **`diffing --host 0.0.0.0`** → `Binds to 0.0.0.0 so other machines on your LAN can open the review.`
- **`diffing --terminal`** / **`--web`** → `Forces terminal (stdout patch) / web (browser UI) mode.`
- **`diffing await-review`** → `Long-polls the running server until you send your comments from the browser (default timeout 570s). Exit: 0 received · 2 timeout · 3 no server.`
- **`diffing reply`** → `Usage: diffing reply <commentId> --body <text> [--model <name>]  — posts an agent reply to a comment.`
- **`diffing resolve`** → `Usage: diffing resolve <commentId>  — marks a comment resolved.`
- **`diffing comments`** → `Prints all comments as XML (or JSON with --json; --open filters to open comments).`
- **`diffing url`** → `http://127.0.0.1:<port>  (the running server's base URL)`
- **`diffing mcp`** → `Starts the diffing MCP server (stdio). Register: {"mcpServers":{"diffing":{"command":"diffing","args":["mcp"]}}}. Exposes 10 tools: await_review, list_comments, reply_to_comment, resolve_comment, submit_plan, await_plan_review, list_plans, get_plan, reply_to_plan_comment, resolve_plan_comment.`
- **`diffing plan`** → `Plan-review subcommands: submit <file> [--title T] [--wait] · await · list · show [<id>] · reply <id> --body <text> · resolve <id>. Verdicts: pending, approved, changes-requested, rejected.`
- **`diffing plan submit`** → `Usage: diffing plan submit <file> [--title T] [--source S] [--model M] [--id <id>] [--wait] [--timeout N]  — submit a markdown plan for human review (default --timeout 570).`
- **`diffing plan await`** → `Blocks until the human decides (default timeout 570s). Exit: 0 decision · 2 timeout.`
- **`diffing update`** → `Checking for updates… Updating diffing via npm (or pnpm if present): npm install -g diffing@latest`
- **`clear`** → clears the shell buffer.
- **`help`** → lists the demoable commands.

Implement history (`↑`/`↓`) and `Tab` completion against the command list. Keep responses ≤ ~6 lines each except `--help`.

### 3.6 Startup animation choice
On first paint, run a **typewriter** boot sequence inside the hero box (it is the lowest-risk,
most legible of the 6 real animations: Typewriter, Wave Reveal, Slide-In, Pulse Border, Glitch
Noise, Matrix Rain). Sequence:
```
DIFFING v0.2.1 — booting…
▸ binding 127.0.0.1 … ok
▸ scanning working tree … ok
▸ loading nord theme … ok
"<one random quote of 31> — <author>"
ready ❯
```
Type char-by-char with a blinking block cursor; total ≤ ~2.2 s. Skip on `prefers-reduced-motion`
(render the final state instantly). Pick the quote at random from the embedded 31-quote array.
*(Optional flair: a brief Matrix-Rain canvas behind the hero using the Cyan palette — gate behind
reduced-motion. Not required.)*

### 3.7 Keybindings to wire
| Key | Binding |
|---|---|
| `j` / `k` | `window.scrollBy({top: 100})` / `{top:-100}` |
| `Ctrl+d` / `Ctrl+u` | scroll half viewport down / up |
| `g g` | scroll to top (800ms multi-key buffer) |
| `G` | scroll to bottom |
| `g t` | open theme selector (fire `open` sound + `medium` haptic) |
| `g v` | scroll to / focus the diff showcase (stand-in for file browser) |
| `t` | cycle the page tab-size indicator 2→4→8 (updates vim status bar) |
| `m` | toggle showcase split/unified (visual) |
| `/` `s` | focus the shell / focus search panel |
| `?` | open shortcuts help overlay |
| `Esc` | close any open overlay/modal |
| `Cmd/Ctrl+K` | open shortcuts help / command palette (works in fields) |

Multi-key buffer = **800 ms** (matches the app). Disable single-key shortcuts while a text
field (`input`/`textarea`/`[contenteditable]`) is focused; show **INSERT** in the vim bar then.

---

## 4. DO NOT SAY — README/docs inaccuracies → corrected values

The builder must never reintroduce these wrong claims. Use the **corrected** value.

| ❌ Do NOT say | ✅ Corrected (verified) |
|---|---|
| "42+ built-in themes" (README:52) | **52 themes** (exact; ThemeModal.tsx, counted) |
| "30 curated developer quotes" (ground truth) | **31 quotes** (startup-display.ts QUOTES, lines 44–74) |
| "32 developer quotes" (one agent report) | **31 quotes** — also wrong; the real count is 31 |
| "`t` cycles themes" (design brief & README keymap) | **`t` cycles tab size (2→4→8)**; the theme picker opens with **`g t`** (App.tsx) |
| "Cmd/Ctrl+`,` toggles settings" (README:126) | **No such binding exists** — do not document it. Use `g t` (themes) / `Cmd/Ctrl+K` (palette) |
| "monochromatic theme 'Blue'" (README:139) | The 6th-listed palette is **"Sky Blue"**; the 6 palettes are Cyan, Green, Magenta, Yellow, **Sky Blue**, Orange |
| "17+ language patterns / 17+ as a range" | **17 symbol patterns** across JS/TS, Go, Rust, Python (don't imply more) |
| "53 themes" (one agent report) | **52 themes** — also wrong; the real count is 52 |
| Implying a fixed/default port | Default is a **random available port**; default **host 127.0.0.1**. `--port` sets a fixed one. The `4317` on the page is a labeled demo placeholder |
| "settings stored in localStorage" (about the real app) | The real app stores nothing in localStorage — state is server-side at `~/.diffing/<repo>-<hash>/` and `~/.config/diffing/settings.json`. (The **landing page** may use localStorage for its own theme/toggles; just don't claim the app does.) |
| "powered by Shiki = 42 themes" | Themes count is **52**; Shiki powers code highlighting, not the theme count |

Also avoid: stating the MCP server version as `0.2.1` (the `McpServer` is constructed with
`version: '0.1.0'` internally — but the **package/CLI** is `0.2.1`; when in doubt, only cite the
package version `0.2.1`, never an MCP internal version).

---

## 5. FILE PLAN (vanilla, no build step; works via `file://` and a static server)

```
landing/
├── BUILD-SPEC.md      ← this document
├── index.html         ← single page; semantic sections per §2; status strip, hero,
│                         two-column workspace, feature panels, footer, overlays.
│                         Loads Google Fonts (§3.1). No frameworks. <html data-theme="nord">.
├── styles.css         ← all styling. Embeds the 5 verbatim [data-theme] blocks (§3.4),
│                         the :root typography vars (§3.1), terminal-style chrome (boxed panels,
│                         thin borders, ASCII header bars), responsive 2-col→1-col,
│                         prefers-reduced-motion handling, vim bar, toast, modal.
├── main.js            ← all behavior, plain ES modules / IIFE (no bundler):
│                         · AudioContext + synth() port (§3.2) + 11 presets
│                         · navigator.vibrate haptics (§3.3) + 10 presets
│                         · global capture-phase click listener (sound+haptic)
│                         · AUDIO/HAPTICS toggles ⇄ localStorage
│                         · theme selector + `g t` + localStorage persistence (§3.4)
│                         · typewriter boot animation + 31-quote array (§3.6)
│                         · interactive shell parser + history + Tab complete (§3.5)
│                         · diff showcase: inline comment bubbles + scripted agent toast (§2.E)
│                         · carousel autoplay/controls (§2.A)
│                         · keybindings + 800ms multi-key buffer + vim status bar (§3.7)
│                         · shortcuts help overlay (§1.8)
└── README.md          ← how to open: `open index.html` (file://) OR
                          `python3 -m http.server` / `npx serve landing`. Notes that it's
                          a marketing recreation, lists what's real vs. demo, links the repo.
```

**Constraints / quality bar**
- No external JS deps (Google Fonts CSS is the only network asset; degrade gracefully to
  monospace fallback if offline).
- Must open directly from `file://` (no fetch of local JSON; embed the quote array and theme
  data inline in `main.js`).
- Accessibility: keyboard-operable everywhere, `aria-live="polite"` on the toast, visible focus
  rings (use `--border-focus`), honor `prefers-reduced-motion` (skip boot typewriter + matrix rain).
- Audio must only start after a user gesture (resume the shared AudioContext on first click/keydown).
- Every embedded number/flag/command must match §0–§1; cross-check against §4 before shipping.
```
```
