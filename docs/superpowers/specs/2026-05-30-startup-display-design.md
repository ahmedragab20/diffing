# Startup Display: Animated Quote on Server Launch

**Date:** 2026-05-30  
**Status:** Approved

## Summary

When `diffing` starts in web mode, the server URL prints immediately (no delay), then a randomly selected terminal animation plays below it — settling to a styled quote block that stays in terminal history. Both the animation style and quote are picked at random each session.

## Architecture

**New file:** `src/lib/startup-display.ts`  
**Exports:** `playStartupDisplay(): void` (non-blocking — fire and forget)

**Integration:** `src/cli.ts` line 96 — called via `void playStartupDisplay()` immediately after `console.log(localUrl)`.

No new npm dependencies. Implementation uses:
- `process.stdout.write()` for raw terminal output
- ANSI escape codes (colors, cursor movement, bold) — inline constants
- `setTimeout` / `setInterval` for frame timing
- `Math.random()` for per-session selection

## Animation Pool

Six distinct animation styles — one selected at random per session:

| # | Name | Description | Duration |
|---|------|-------------|----------|
| 1 | **Typewriter** | Quote types out char-by-char | ~800ms |
| 2 | **Wave reveal** | Each char bounces in via staggered delay, left-to-right | ~900ms |
| 3 | **Matrix rain** | Brief column-drop effect, then quote fades in below | ~700ms |
| 4 | **Slide cascade** | Lines of the quote slide in from left, staggered | ~600ms |
| 5 | **Pulse border** | Box border draws itself around the quote (corners → sides) | ~700ms |
| 6 | **Glitch flash** | Quote flickers with random char substitutions 3–4×, then stabilizes | ~600ms |

All animations settle to the same **static final state**: a clean ANSI-styled block with the quote text and attribution.

## Quote Collection

~30 quotes across three tones, randomly selected independently of animation:

- **Motivational** — dev-craft wisdom (Knuth, Dijkstra, Kernighan, etc.)
- **Funny** — "It works on my machine", "git blame yourself", etc.
- **Redpill** — "The code review is the product", "Your abstractions are just someone else's bugs", etc.

Quote selection is independent of animation selection — all combinations are valid.

## Final Static State

After the animation completes, the terminal shows something like:

```
╭──────────────────────────────────────────────────────╮
│  "The best code is no code at all."                  │
│                               — Jeff Atwood          │
╰──────────────────────────────────────────────────────╯
```

Color scheme (one of ~4 random palettes): cyan, magenta, yellow, or green for the border; white/dim for the text.

## Error Handling

If stdout is not a TTY (piped output), `playStartupDisplay()` is a no-op — ANSI codes and animation have no place in piped output. Check `process.stdout.isTTY` before running.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/startup-display.ts` | New — full implementation |
| `src/cli.ts` | One line added after `console.log(localUrl)` |
