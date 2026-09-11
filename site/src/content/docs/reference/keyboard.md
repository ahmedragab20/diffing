---
title: Keyboard shortcuts
description: Vim-style navigation for the web review UI and plan page.
summary: j/k scrolling, g sequences, plan-page keys, and Ask AI shortcuts on every surface.
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

## AI assistant

Ask AI is available on local diffs, PR review, plans, and mockups. Bare keys go through the vim-style buffer and do **not** fire while typing. <kbd>⌘/Ctrl+I</kbd> is a chord and **does** work while an editor is focused (like <kbd>⌘K</kbd>). Inside the rail, handled keys stop so global vim keys do not double-fire. Press <kbd>?</kbd> to see the same list in the shortcuts modal.

### All surfaces

| Key | Action |
|-----|--------|
| <kbd>a</kbd> | Toggle Ask AI (open and focus composer; close if the composer is already focused) |
| <kbd>⌘/Ctrl+I</kbd> | Same as <kbd>a</kbd>, including while typing |
| <kbd>A</kbd> | Open Ask AI with a **new** conversation |
| <kbd>Enter</kbd> / <kbd>⌘/Ctrl+Enter</kbd> | Send. <kbd>Shift+Enter</kbd> inserts a newline. Enter does not send while `@` mentions or `/` actions are open |
| <kbd>/</kbd> | Slash-command palette (empty composer only) |
| <kbd>⌘/Ctrl+.</kbd> | Stop the running request |
| <kbd>⌘/Ctrl+Shift+N</kbd> | New conversation (rail) |
| <kbd>⌘/Ctrl+[</kbd> / <kbd>⌘/Ctrl+]</kbd> | Previous / next conversation |
| <kbd>⌘/Ctrl+1</kbd> <kbd>2</kbd> <kbd>3</kbd> | Run quick action 1 / 2 / 3 |
| <kbd>⌘/Ctrl+M</kbd> | Open the inline model picker |
| <kbd>⌘/Ctrl+Shift+R</kbd> | Cycle reasoning effort (Auto → Low → Medium → High) |
| <kbd>⌘/Ctrl+Shift+C</kbd> | Copy the last assistant response |
| <kbd>⌘/Ctrl+Shift+Enter</kbd> | Retry the last failed / canceled request |
| <kbd>⌘/Ctrl+U</kbd> | Attach an image |
| <kbd>⌘/Ctrl+L</kbd> | Clear the composer (<kbd>⌘/Ctrl+Z</kbd> undoes when empty) |
| <kbd>⌘/Ctrl+Shift+F</kbd> | Insert `@` to attach a file |
| <kbd>Esc</kbd> | Close Ask AI (closes the mention or slash palette first) |
| <kbd>⌘/Ctrl+Shift+.</kbd> | Toggle “Context being shared” |

### Diff and PR only

| Key | Action |
|-----|--------|
| <kbd>g</kbd> <kbd>a</kbd> | Ask about the active file (`@path` in the composer) |

### Local diff only

| Key | Action |
|-----|--------|
| <kbd>⌘/Ctrl+Shift+A</kbd> | Add the current line selection to Ask AI (opens the rail if there is no selection) |

## TUI

The experimental TUI has its own keymap (vim-style). See repository `docs/cli.md` §4d for the full TUI table while the site stays web-authoritative.
