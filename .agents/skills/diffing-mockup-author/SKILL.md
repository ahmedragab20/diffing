---
name: diffing-mockup-author
description: Author HTML mockup screens that look like the product before submit_mockup. Use when creating or revising mockup HTML, splitting states into screens, tagging data-diffing regions, or avoiding generic AI chrome.
---

# Author a reviewable mockup

Write the HTML. Then use `diffing-mockup-review` to submit, await, inspect, and patch. Do not implement product UI until the mockup is approved.

## Hard rules (pi harness)

- **Lead only.** The lead writes and revises every mockup. Never spawn a worker/subagent to generate or check HTML.
- **Opt-in only.** Write a mockup only if the user asked for one or accepted a suggestion. Do not author HTML because a UI change looks large — mockups drain tokens.

## Never write mockups into the consumer repo

Prefer MCP `submit_mockup({ html })` or stdin. If you must stage a file, use only `~/.diffing/<repo>-<hash>/mockup-sources/`.

## Before any HTML

1. Call `get_design_system` / `diffing design show`. If a published system is present, use its tokens, fonts, and snippets. Do **not** invent a palette. If none exists, `extract_design_system` writes a draft — do not publish unless the human asks.
2. If there is no system, match the running product (existing CSS, a screenshot, or a prior approved mockup). Still do not invent Inter + indigo + Tailwind CDN.
3. List every distinct state as its own screen id **before** writing markup.

## One state per screen

Never put tabs, accordions, toggles, modals, dropdowns, or JS that swaps content inside one screen. Each variant is a `screens[]` entry with a stable `id` and a clear `label`.

Examples of separate screens: `checkout`, `checkout-empty`, `checkout-error`, `modal-closed`, `modal-open`. Only add `*-mobile` when the layout actually changes — viewports are a review control, not extra screens.

Submit every state in one `submit_mockup({ screens: [...] })` when you can. Cap is 24 screens.

## How to write the HTML

- Tag major regions: `data-diffing="hero"`, `data-diffing="toolbar"`, `data-diffing="empty"`. Humans can still click untagged blocks.
- Use real product copy and realistic numbers. No lorem, no "John Doe", no purple gradients, no Inter + indigo, no `cdn.tailwindcss.com`, no Google Fonts.
- Prefer a fragment (body contents). The design-system host shell wraps fragments by default (`mode: "fragment"`). Opt out with `mode: "document"` / `--mode document` — full HTML, no wrap.
- Give stable `id` or `data-diffing` names so comments survive revisions.

## After submit

Diffing returns soft `hints[]` (non-blocking):

- **state** — in-page tabs/modals/toggles. Split that screen.
- **style** — CDN Tailwind, Google Fonts, Inter+indigo. Restyle to match the product.

Fix hints before parking. Prefer `revise_mockup op=replace-region` (`region` + `replacement`) for a tagged block; use `op=patch` only for an exact string.

Then park with the `/mockup/<id>` URL. Do not `--wait` unless asked.
