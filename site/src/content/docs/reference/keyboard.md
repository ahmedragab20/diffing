---
title: Keyboard shortcuts
description: Vim-style navigation for the web review UI and plan page.
summary: j/k scrolling, g sequences for theme and files, m for split/unified, plan-page zen and edit keys.
order: 5
section: reference
---

Multi-key sequences use an **800 ms** buffer. A vim-style status bar shows **NORMAL** / **INSERT**; single-key shortcuts are disabled while typing in inputs.

## Scrolling & diffs

| Key | Action |
|-----|--------|
| <kbd>j</kbd> / <kbd>k</kbd> | Scroll down / up (100px) |
| <kbd>Ctrl+d</kbd> / <kbd>Ctrl+u</kbd> | Half-page down / up |
| <kbd>g</kbd> <kbd>g</kbd> | Jump to top |
| <kbd>G</kbd> | Jump to bottom |
| <kbd>m</kbd> | Toggle split / unified |
| <kbd>t</kbd> | Cycle tab size (2 → 4 → 8) |
| <kbd>w</kbd> | Toggle line wrap |
| <kbd>n</kbd> | Toggle line numbers |
| <kbd>i</kbd> | Cycle diff indicators |
| <kbd>I</kbd> | Cycle inline diff type |
| <kbd>Cmd+Shift+P</kbd> | Toggle comment preview |

## Files & UI

| Key | Action |
|-----|--------|
| <kbd>J</kbd> / <kbd>K</kbd> | Next / previous file |
| <kbd>v</kbd> | Toggle file viewed |
| <kbd>b</kbd> | Toggle sidebar |
| <kbd>/</kbd> | All-scope search |
| <kbd>s</kbd> | Symbol search |
| <kbd>g</kbd> <kbd>v</kbd> | File browser |
| <kbd>g</kbd> <kbd>t</kbd> | **Theme picker** |
| <kbd>Cmd/Ctrl+K</kbd> | Command palette |
| <kbd>?</kbd> | Shortcuts help |

> **Do not confuse:** <kbd>t</kbd> is **tab size**, not themes. Themes open with <kbd>g</kbd> <kbd>t</kbd>.

## Plan page (`/plan`)

| Key | Action |
|-----|--------|
| <kbd>m</kbd> | Source → Read → Split |
| <kbd>z</kbd> | Zen Read |
| <kbd>e</kbd> | Live plan edit |
| <kbd>⌘/Ctrl+S</kbd> | Flush autosave while editing |
| <kbd>o</kbd> | Outline |
| <kbd>c</kbd> | Comments map |
| <kbd>J</kbd> / <kbd>K</kbd> | Next / previous plan |
| <kbd>Esc</kbd> | Discard / exit zen / dismiss composer |

## TUI

The experimental TUI has its own keymap (vim-style). See repository `docs/cli.md` §4d for the full TUI table while the site stays web-authoritative.
