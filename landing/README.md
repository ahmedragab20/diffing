# diffing — landing page

A single-page, no-build, vanilla **HTML / CSS / JS** marketing site for the
[`diffing`](https://github.com/ahmedragab20/diffing) CLI. It uses a terminal
*aesthetic*, but note: diffing is a CLI that opens a browser-based review UI —
it is not a terminal UI application.

## View it

No build step, no dependencies to install. Either:

```bash
# Open directly from the filesystem
open landing/index.html          # macOS
xdg-open landing/index.html      # Linux

# …or serve it (better: lets the browser cache fonts and keeps file:// quirks away)
npx serve landing
# or
python3 -m http.server --directory landing
```

The only network asset is **Google Fonts** (Geist Mono + JetBrains Mono). Offline,
it degrades gracefully to the system monospace fallback.

## What it is

A faithful, interactive recreation of the diffing review workspace feel — not the
real app. Every fact, flag, command, number, color token, and sound parameter on
the page was verified against the `diffing` source.

### Real (ported verbatim from source)
- **Sound engine** — the `synth()` Web-Audio function and all **11** presets
  (`click, toggle, navigate, open, close, success, resolve, send, error, warning,
  remove`) are ported byte-for-byte from `src/ui/hooks/useHaptics.tsx`, including the
  global capture-phase click listener that scores every button/link/checkbox.
- **Theme tokens** — the 5 previewed themes (Nord, Catppuccin Mocha, Tokyo Night,
  Dracula, Rosé Pine) use the exact `[data-theme]` CSS-variable blocks from
  `src/ui/styles/global.css`.
- **Quotes** — all **31** developer quotes from `src/lib/startup-display.ts`.
- **Keyboard shortcuts** — the authoritative table (note: `t` cycles **tab size**;
  the theme picker is `g t`).
- **CLI command map** — the interactive shell prints accurate descriptions, the
  570s await timeout, exit codes `0/2/3/4/5`, the 10 MCP tools, and the help banner.
- **Facts** — version `0.2.1`, MIT, default host `127.0.0.1`, default theme `nord`,
  **52** themes, **10** MCP tools, 60+ git flags / 12 categories.

### Demo / creative liberty
- `127.0.0.1:4317` in the status strip is a labeled **demo placeholder** — the real
  CLI binds `127.0.0.1` on a **random free port** (or `--port`).
- Haptics use `navigator.vibrate` patterns approximating the real `web-haptics`
  presets (no-ops on unsupported browsers).
- The diff board, agent toast, and "Send to agent" flow are scripted demonstrations
  of the SSE handoff, not a live server.
- The landing page persists its own theme/AUDIO/HAPTICS choices to `localStorage`;
  the **real app stores no state in localStorage** (it's server-side).
- `t` is wired to cycle the page's tab-size indicator (matching the real binding);
  themes cycle via `g t`.

## Files

| File | Purpose |
|---|---|
| `index.html` | Semantic markup: status strip, hero, two-column workspace, feature panels, footer, overlays. |
| `styles.css` | All styling + the 5 verbatim `[data-theme]` blocks + responsive + reduced-motion. |
| `main.js` | All behavior: audio synth, haptics, themes, boot animation, shell, diff showcase, carousel, keybindings, vim bar, toast, help overlay. |
| `BUILD-SPEC.md` | The build specification this page implements. |

Repo: <https://github.com/ahmedragab20/diffing> · Originally forked from
[wong2/diffx](https://github.com/wong2/diffx). MIT.
