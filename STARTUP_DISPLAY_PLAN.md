# Startup Display: Animated Quote on Server Launch

## Overview

Add a non-blocking animated quote display to the `diffing` CLI startup sequence.
The URL prints immediately (no delay). A randomly selected animation then plays
below it, settling to a static styled quote block that persists in terminal
history. Both animation style and quote are chosen at random each session.

---

## Phase 1 — Create `src/lib/startup-display.ts`

### 1.1 ANSI helpers

Define inline constants for ANSI escape codes — no library needed:

- Color codes: reset, bold, dim, fg colors (cyan, magenta, yellow, green, white)
- Cursor codes: move up N lines, clear line, hide cursor, show cursor
- Helper: `colorize(text, ...codes)` wraps text in escape codes

### 1.2 Quote collection

Array of ~30 `{ text: string, author: string }` objects, spread across three tones:

**Motivational (dev-craft):**
- "The best code is no code at all." — Jeff Atwood
- "Programs must be written for people to read, and only incidentally for machines to execute." — Abelson & Sussman
- "Make it work, make it right, make it fast." — Kent Beck
- "Simplicity is the soul of efficiency." — Austin Freeman
- "Any fool can write code that a computer can understand. Good programmers write code that humans can understand." — Martin Fowler
- "First, solve the problem. Then, write the code." — John Johnson
- "Code is like humor. When you have to explain it, it's bad." — Cory House
- "Before software can be reusable it first has to be usable." — Ralph Johnson
- "Clean code always looks like it was written by someone who cares." — Robert C. Martin
- "The most dangerous phrase in the language is 'we've always done it this way'." — Grace Hopper

**Funny:**
- "It works on my machine." — Every developer, always
- "git blame yourself." — The terminal
- "There are only two hard things in CS: cache invalidation, naming things, and off-by-one errors." — Unknown
- "A QA engineer walks into a bar. Orders 0 beers. Orders 999999 beers. Orders -1 beers. Orders NULL beers." — Unknown
- "Debugging: being the detective in a crime movie where you're also the murderer." — Unknown
- "The code you wrote six months ago was written by an idiot." — Unknown
- "sudo make me a sandwich." — xkcd
- "I don't always test my code, but when I do, I do it in production." — Unknown

**Redpill:**
- "The code review is the product." — diffing
- "Your abstractions are just someone else's bugs." — Unknown
- "Every rewrite is a confession that you didn't understand the problem the first time." — Unknown
- "The best PR is no PR — ship it in the design." — Unknown
- "You don't own your code. Your code owns you." — Unknown
- "A diff is a conversation. What story does yours tell?" — Unknown
- "The senior engineer's superpower: knowing which shortcuts will haunt you." — Unknown
- "Production is the only real test environment." — Site Reliability truth
- "Tech debt is just deferred thinking." — Unknown
- "Comments lie. Code never does." — Ron Jeffries

### 1.3 Animation functions

Six named async functions, each taking `(quote: { text: string, author: string })`
and returning `Promise<void>` that resolves when the animation settles.

**`animTypewriter(quote)`**
- Print box border top
- Type out quote text char-by-char with ~25ms delay between chars
- Print closing border and author attribution
- Total: ~800ms for a typical quote

**`animWaveReveal(quote)`**
- Each character of the quote is revealed with a staggered 20ms delay left-to-right
- Characters "fall in" using cursor-up + overwrite trick
- Total: ~700ms

**`animSlide(quote)`**
- Print box top border
- Each line of the quote slides in from the left (padding shrinks per frame, 3 frames per line at 80ms)
- Total: ~600ms

**`animPulseBorder(quote)`**
- Draw quote box with dim border, then re-draw corners → sides → full border in bold color
- 3 passes at 150ms apart
- Total: ~500ms

**`animGlitch(quote)`**
- Print quote with random character substitutions (░▒▓, random ASCII noise)
- 4 flicker frames at 100ms apart, then print clean final version
- Total: ~500ms

**`animMatrixRain(quote)`**
- Print 5 lines of random `0`/`1` chars in dim green, clear them upward,
  replace with styled quote box
- Total: ~700ms

### 1.4 Main export

```ts
export function playStartupDisplay(): void
```

- Guard: `if (!process.stdout.isTTY) return` — no-op for piped output
- Pick random animation index and random quote index via `Math.random()`
- Hide cursor, await chosen animation, show cursor — in a void async IIFE
- Entire body wrapped in `try/catch` — any terminal error is silently swallowed
  (cosmetic only, must never crash the server)

---

## Phase 2 — Wire into `src/cli.ts`

**File:** `src/cli.ts`  
**Change:** Add import at top with other lib imports, add one call after the URL log:

```ts
import { playStartupDisplay } from './lib/startup-display.js'
// ... existing code ...
console.log(`diffing server running at ${localUrl}`)
void playStartupDisplay()   // non-blocking, cosmetic only
```

---

## Phase 3 — Build verification

Run `npm run build` to verify:
- TypeScript compiles without errors
- New module is bundled into `dist/cli.mjs`
- Bundle size increase is minimal (no new npm deps added)

---

## Out of Scope

- No tests (stdout animation, timing-dependent, cosmetic — not worth mocking)
- No config flag to disable (pipe output to suppress ANSI if needed)
- No changes to terminal mode, subcommands, or any other code path
