---
title: Gridline
description: Terminal-native design system shared by the web UI and TUI.
summary: Flat surfaces, mono type, one-pixel rules, semantic color roles — hierarchy from alignment and density, not glass or glow.
order: 1
section: design
---

**Gridline** is diffing's shared visual language. The Rust TUI defines the original semantic contract; the browser adapter lives in `src/ui/styles/gridline.css`. This docs site mirrors the same principles.

## Product character

The browser should feel like a **terminal workspace** with richer input — not a dashboard decorated with mono fonts. Hierarchy comes from type, alignment, density, and one-pixel rules. Persistent surfaces stay flat. Color communicates **state**, not ornament.

## Invariants

- No glass, blur, glow, gradient, or hover elevation on persistent chrome
- Square or shallow corners (2px controls; 4px overlays max)
- Accent rails only for active navigation / keyboard focus
- Pills only for compact status/count data
- UI and code are mono-first (Geist Mono + JetBrains Mono)
- Themes supply values; components consume semantic roles (`--gl-*`)

## Semantic roles

Surfaces: `canvas`, `surface`, `raised`, `element`, `selected`  
Text: `text`, `text-subtle`, `muted`, `code`, `gutter`  
Structure: `rule-subtle`, `rule`, `focus`  
Feedback: `info`, `positive`, `warning`, `negative`  
Diff: `added-surface`, `removed-surface`

Geometry: 4px unit · 44px app bar · 28px controls · 24px compact.

## Component recipes (summary)

- **Toolbar** — solid 44px status strip, rectangular controls  
- **Sidebar** — flat pane, one rule divider  
- **Diff file** — edge-defined pane, quiet header  
- **Comments** — status dots for lifecycle; neutral card border  
- **Modal** — raised surface + single overlay shadow  
- **Vim status** — viewport-edge line, not a floating glass pill  

## TUI notes

Density is deliberate (one cell base unit). Focus is local — not a full panel accent rectangle. Status strip owns key hints; help overlay is the full reference. See repository `docs/tui-design-system.md` for full TUI recipes.

## Related

- [Themes](/docs/design/themes/)
- Repo: `docs/design-system.md`, `docs/tui-design-system.md`
