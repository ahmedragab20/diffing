---
name: diffing-mockup-review
description: Submit an HTML mockup to diffing for visual review and obey the verdict before implementing UI. Use when an agent already has mockup HTML and needs submit_mockup / await_mockup_review / inspect_mockup / revise_mockup. Author the HTML with diffing-mockup-author first.
---

# Review an HTML mockup with diffing

Same loop as plan review: submit HTML screens, park, act on the verdict. Do not implement the UI until the mockup is approved. Create or revise the HTML with `diffing-mockup-author` first — this skill is the submit / inspect / patch loop only.

## Human AI in the UI is not this loop

The mockup review UI has Ask AI, comment chips, Generate this screen, Rewrite region, and Attach preview. Those run **only when the human clicks them**. Agents do not start inference. `--model` on submit/reply is provenance. Keep parking after submit; do not treat the UI rail as an agent tool.

## Never write mockups into the consumer repo

**Do not create or save mockup HTML (or a mockups/ folder) in the user's project.** Diffing stores screens itself under `~/.diffing/<repo>-<hash>/mockups.json` and `mockup-sources/<id>/`.

Prefer MCP inline HTML. If you must use a file, write only under `~/.diffing/<repo>-<hash>/mockup-sources/` and submit that path — never a path inside the git tree.

## Hard rule: one state per screen

**Never build tabs, accordions, toggle switches, modals, dropdowns, or any JS that swaps content inside a mockup screen.** Each distinct state, variant, or case (loading/empty/error, open/closed, selected/unselected, each tab's content, each responsive breakpoint) must be its own `screens[]` entry with a stable `id` and a clear `label`.

This keeps comments tab-aware: every comment anchors to one screen + element, and it vanishes cleanly when that element is gone instead of drifting across toggled states.

**Split efficiently:** submit all states at once via `submit_mockup({ screens: [...] })` (one version bump), or add states incrementally with `revise_mockup op=upsert` per screen. Diffing flags in-page state UI (tabs/accordion/modal/dropdown/toggle) in the submit response — split any flagged screen.

## Submit

Prefer MCP when `mode: web`:

```
submit_mockup({ title, html })                    # one Main screen
submit_mockup({ title, screens: [{ id, html }] }) # multi-screen
submit_mockup({ mockupId, html })                 # resubmit / bump version
```

CLI (from the **consumer** workspace, body on stdin):

```bash
printf '%s' "$html" | diffing mockup submit - --title "Checkout" --model "…"
```

A directory of `*.html` is only valid if it already lives under `~/.diffing/…/mockup-sources/` (`index.html` first).

**Async default:** print/share `/mockup/<id>` and park. Do not `--wait` unless asked.

## Await

When the human says ready (or for a sync wait):

```bash
diffing mockup await
# or MCP await_mockup_review
```

Read `<mockup-review decision="…">` — **compact, open-only**: open comments on the current version only, each with `screen="<id>"`, `mockup-version="<n>"`, `viewport="desktop|tablet|mobile"` (comment scope = version + screen + viewport), plus anchor fields.

| Decision | Action |
| ---------- | -------- |
| `approved` | Implement the mockup |
| `changes-requested` | Revise HTML, reply/resolve threads, resubmit same id, park again |
| `rejected` | Stop; do not implement |
| `comment-only` | Reply only; do not edit product files |

Comments: `kind="section"` + `target=` → `data-diffing` region; `kind="block"` + `selector=` (+ `fingerprint=`) → element; `kind="point"` + `x`/`y` → pin. `x`/`y`/`rect` are viewport-relative — pull the real markup via inspect instead.

## Efficient recipe (changes-requested)

1. **Inspect open comments** — compact, filterable by scope:

   ```bash
   diffing mockup inspect comments <id> --status open
   # or MCP inspect_mockup({ mockupId, view: 'comments', status: 'open' })
   # also: inspect preview — rendered preview metadata, no full HTML
   ```

   `context=none|anchor|source` (default `anchor`); `--version N` / `--viewport V` / `--screen S` filter the scope.
2. **Inspect one screen's source** (bounded, no full-mockup dump):

   ```bash
   diffing mockup inspect screen <id> --screen main --context source
   # or MCP inspect_mockup({ mockupId, view: 'screen', screenId: 'main', context: 'source' })
   ```

3. **Patch one screen** — version-bumping, `--expected-version` guarded (409 on conflict, nothing applied). Prefer `replace-region` when the comment has a `data-diffing` target; fall back to exact-text `patch`:

   ```bash
   diffing mockup screen replace-region <id> main --region hero --replacement '<h1>New</h1>' --expected-version 3
   # or MCP revise_mockup({ mockupId, op: 'replace-region', screenId, region: 'hero', replacement, expectedVersion })
   diffing mockup screen patch <id> main --text '<h1>Old</h1>' --replacement '<h1>New</h1>' --expected-version 3
   # also: screen upsert|remove — multi-screen changes → resubmit with same mockupId
   ```

4. **Batch reply + resolve** — one atomic call, all-or-nothing, never bumps the version:

   ```bash
   diffing mockup threads reply <c1> --body "fixed — resubmitted" --model "…"
   diffing mockup threads resolve <c1>
   # or MCP update_mockup_threads({ mockupId, operations: [{ op: 'reply', commentId, body }, { op: 'resolve', commentId }] })
   # threads also: edit [<reply-id>] / delete [<reply-id>] / unresolve
   ```

## Other

```bash
diffing mockup list [--json]
diffing mockup show [<id>] [--json] [--version N]
diffing mockup versions <id>
diffing mockup handoff [<id>]   # after approved: tokens + screen intent (MCP get_mockup_handoff)
```

Agents MAY tag regions with `data-diffing="hero"`. Humans can still click untagged blocks and drop pins.
