---
title: Themes
description: Built-in theme catalog and how to switch.
summary: 52 themes with default rose-pine; open the picker with g t.
order: 2
section: design
---

diffing ships **52** themes (counted from `ThemeModal.tsx`). Default: **`rose-pine`**.

## Switch theme

- Keyboard: <kbd>g</kbd> <kbd>t</kbd>
- Settings UI / toolbar
- Persist: `theme` in `~/.config/diffing/settings.json`

> <kbd>t</kbd> alone cycles **tab size**, not themes.

## Catalog

| Id | Notes |
|----|-------|
| `nord` | |
| `github-dark`, `github-dark-dimmed`, `github-dark-high-contrast` | |
| `github-light`, `github-light-high-contrast` | |
| `dracula`, `one-dark`, `synthwave-84`, `tokyo-night` | |
| `catppuccin-mocha`, `catppuccin-frappe`, `catppuccin-macchiato`, `catppuccin-latte` | |
| `solarized-dark`, `solarized-light` | |
| `monokai`, `ayu-dark`, `ayu-light` | |
| `nightfox`, `nordfox`, `duskfox`, `terafox`, `carbonfox`, `dayfox`, `dawnfox` | Nightfox family |
| `andromeeda`, `aurora-x`, `dark-plus`, `light-plus`, `houston`, `laserwave` | |
| `material-theme`, `material-theme-darker`, `material-theme-lighter`, `material-theme-ocean`, `material-theme-palenight` | |
| `min-dark`, `min-light`, `night-owl`, `one-light`, `plastic`, `poimandres` | |
| `rose-pine`, `rose-pine-moon`, `rose-pine-dawn` | Default family |
| `slack-dark`, `slack-ochre` | |
| `vesper`, `vitesse-black`, `vitesse-dark`, `vitesse-light` | |

Syntax highlighting uses Shiki via `@pierre/diffs` with dark/light pairs mapped per theme.

## Gridline requirement

Every theme must keep primary text readable and focus color visible. Components consume `--gl-*` roles derived from the theme palette.
