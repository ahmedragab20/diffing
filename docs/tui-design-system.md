# Gridline TUI design system

Gridline is diffing's terminal-native design system. It keeps the interface
dense without making every region compete for attention, and it gives every
web-derived theme the same semantic hierarchy.

## Principles

1. **The diff is the product.** Chrome stays quieter than code, changes, and
   review feedback.
2. **Density is deliberate.** One cell is the base spacing unit. Use two
   columns at content edges and one blank row only between distinct sections.
3. **Focus is local.** A focused title, rail, or selected row communicates
   interaction. Do not turn a whole panel border into an accent rectangle.
4. **Color has one meaning.** Positive, warning, negative, info, and accent
   roles are not interchangeable. Pair them with markers or labels so color is
   never the only signal.
5. **Themes provide values; components consume roles.** Component code must
   not add RGB values or reinterpret a palette field.
6. **One control surface.** Primary navigation and mode verbs live in the
   status strip. Content may show a single muted footer line; it never repeats
   the full keymap.
7. **Same verbs everywhere.** A binding shown in the status strip uses the
   same key in help and in any mouse affordance. Chips mirror status verbs —
   they are not a second help system.
8. **Chrome never restates thrice.** Do not put the same bindings in a modal
   title, a chip row, and the status strip for the common path. Fullscreen may
   add mouse chips; keyboard users learn from the strip.
9. **Tokens all the way down.** Presentation paths — including image difference
   heat — consume `GridlineTokens` and `Tone`, not ad hoc RGB.

## Token layers

`themes.rs` parses the web theme catalog into `Palette`. This is the source
layer: canvas colors, syntax colors, semantic feedback, and diff fills.

`ui/gridline.rs` maps a `Palette` into `GridlineTokens`. This is the component
layer used by TUI chrome:

| Category | Tokens | Use |
| --- | --- | --- |
| Surfaces | `canvas`, `surface`, `raised`, `element`, `selected` | App, pane, overlay, control, active row |
| Text | `text`, `text_subtle`, `muted`, `code`, `gutter` | Primary, supporting, metadata, source, line numbers |
| Structure | `rule_subtle`, `rule`, `focus` | Pane separation, overlay boundary, current interaction |
| Feedback | `info`, `positive`, `warning`, `negative` | Questions/activity, success/addition, caution, failure/deletion |
| Diff | `added_surface`, `removed_surface` | Full-row semantic change fills |

`METRICS` owns shared shell density and responsive geometry. `GLYPHS` owns
focus, cursor, rule, and status markers. If a value repeats across components,
promote it to one of these sets instead of copying it.

## Surface hierarchy

```text
canvas
├── quiet application header and command strip
├── diff context rows
└── surface
    ├── file sidebar
    ├── active-file metadata
    └── raised
        ├── modal
        ├── field
        └── toast
```

Use rules to separate adjacent surfaces. Avoid stacking a divider beside a
border; one boundary should occupy one cell.

## Component recipes

### Pane

- Use `surface` and a `rule_subtle` boundary.
- Use a bold title only while the pane is focused.
- Use `focus_rail` for a focused bordered pane.
- Preserve two columns between the edge and primary content.

### Selectable row

- Fill the entire row with `selected`.
- Prefix it with `selection_marker`.
- Keep primary text readable; use `muted` only for metadata.
- Show semantic state in its own marker, not in the focus rail.
- In the file rail, right-align comment and change counts so filenames form a
  stable scan column. At narrow widths, drop change counts before review state
  and preserve a useful filename prefix.

### Overlay and field

- Dim the existing buffer, clear only the popup rectangle, and use
  `overlay_block`.
- Use `field_block` for nested controls. Focus changes the field title, not the
  complete border.
- Use the shared modal margins. A modal may be wider when its content genuinely
  benefits, such as search preview.
- Every destructive or completing modal action needs both a documented key and
  a visible button-sized mouse target. Never make clicking the dimmed content
  behind an overlay activate the underlying workspace.
- Single-line editors show an in-band caret, keep it visible while horizontally
  scrolling, and support Left/Right, Home/End, Backspace/Delete, `Ctrl-W`,
  `Ctrl-U`, and bracketed paste. Multi-line fields use `tui-textarea` and accept
  paste as one edit.

### Images

- Image comparisons are **inline-first** content in the diff pane. Optional
  thin fullscreen (`i`) shares the same `ImageViewState` and renderer — opening
  fullscreen does not reset zoom, pan, or mode.
- Give the raster the largest available surface. Path, dimensions, mode, zoom,
  and metrics belong in **one** quiet `content_footer` under the raster. The
  status strip owns key hints (`Tab mode · +/- zoom · hjkl pan · 0 fit · i
  fullscreen`).
- Before/After existence comes from Git change semantics and blob ids, not from
  whether a worktree path happens to exist. Default mode: both sides →
  side-by-side; added → after; deleted → before.
- Side-by-side may collapse to the available single side at narrow width, and
  normal diff Split layout falls back to Unified below its readable breakpoint.
- Use quiet side labels and a single `vertical_rule` between panes — not paired
  `field_block` borders around every raster.
- Decode and subprocess fallbacks must have byte, dimension, memory, and time
  bounds. An unavailable codec names the missing capability and recovery path.
- Difference heat maps through `GridlineTokens` / `Tone`, never hardcoded RGB in
  the presentation path.
- Render truecolor when available, ANSI-256 otherwise, and luminance glyphs for
  `NO_COLOR` / `TERM=dumb`; terminal-specific graphics protocols are optional,
  never required.

### Chip / toolbar (mouse affordance)

- Use `chip` / `chip_row` only where pointer users need targets — typically thin
  fullscreen image mode. Chips mirror status-strip verbs (mode, zoom, close);
  they do not introduce new bindings.
- Selected chips use `selected` / `accent`; idle chips stay on `canvas` or
  `surface`. Hover uses `selected` without changing the verb.
- Keyboard users should never need chips. If a chip label duplicates a status
  hint, remove the chip or the duplicate hint — not both control surfaces.

### Command hints

- Pass dot-separated commands to `hint_line`, for example
  `jk move · / search · ? help`.
- Keys are primary and bold; descriptions are muted; separators are rules.
- Keep the persistent strip contextual. The help overlay is the complete
  reference.
- Treat commands as higher priority than paths. When the strip is constrained,
  retain command hints, elide the leading path, and preserve the actionable
  filename/line-number tail.

### Search overlay

- Put the editable query first, followed by one compact row for scope and
  optional toggles. Do not repeat the active scope in the modal title.
- Keep keyboard bindings visible in the controls or the single modal footer;
  the dimmed application status strip stays quiet while search is active.
- Use one subtle rule between controls and results. Wide layouts split results
  and preview with one vertical rule; compact layouts give the full width to
  results.
- Preserve syntax colors in the preview, mark the selected result line with the
  shared focus rail, and render exact query spans with a high-contrast match
  style. Result names and paths may use fuzzy character emphasis.
- Give every scope a distinct empty state and result contract: All merges
  deduplicated file/symbol/text rows, Files is fuzzy, Text is literal or regex,
  and Symbols browses definitions from changed lines until a two-character
  query enables repository search. A symbol preview highlights the full
  definition name, even while browsing with an empty query.
- Keep the standalone renderer useful without its Node search bridge: changed
  files, text, symbols, and bounded working-tree previews must still work.

### Frame delivery

- Clear the alternate screen once on entry and disable terminal line wrapping
  while the TUI owns the screen. Restore both settings on every exit path.
- Wrap each dirty Ratatui draw in a synchronized terminal update. This keeps
  wide, split, and image frames atomic on supporting terminals and degrades to
  ordinary output where the protocol is unsupported.
- Redraw only for input or changed background state; never add a timer-driven
  animation loop to make static chrome feel active.

### Feedback and review state

- Approved, success, additions, and praise use `positive`.
- Changes requested, caution, diagnostics, and nits use `warning`.
- Rejected, blocking, failure, and deletions use `negative`.
- Questions, comments, and agent activity use `info`.
- General focus/navigation uses `accent` or `focus`.

### Toast

Toasts are one-row raised strips with a semantic rail and bullet. They do not
use a box border: a one-row box spends all its space on chrome and can overwrite
the message.
Toasts redraw only when created or expired, expose a visible dismiss mark, and
must not turn a static screen into a high-frequency animation loop.

### Pointer mapping

- Keep render-time physical-to-logical row metadata. Wrapped lines and paired
  split rows make `scroll + pointer_y` incorrect.
- Give the change map its own click/drag target and map its height
  proportionally to the logical document.
- Modal geometry is shared between renderer and hit testing; duplicate modal
  rectangle math is a bug source.

## Theme and accessibility contract

- Primary and code text meet 4.5:1 contrast on canvas, panel, selection, and
  diff surfaces.
- Muted text meets 3:1 contrast on the main surfaces.
- Selection and diff fills stay closer to the canvas than their semantic
  foreground color, keeping large terminal regions quiet.
- A subtle rule is never stronger than the default rule.
- Truecolor palettes degrade to ANSI-256, and `NO_COLOR`/`TERM=dumb` remains a
  monochrome path.
- Square terminal corners and plain rules are intentional; do not introduce a
  second border language for individual components.

The theme-catalog and render-level tests enforce these invariants. When adding
a theme or component, run:

```bash
cargo test -p diffing-tui themes::tests --lib
cargo test -p diffing-tui ui:: --lib
cargo test -p diffing-tui --lib --tests
```

## Contributor checklist

- Can an existing semantic token express this state?
- Is the focus state still clear without relying on color alone?
- Did a new divider duplicate an existing border?
- Does the component remain usable at its compact breakpoint?
- Are keys and descriptions styled through the shared hint grammar?
- Did render tests cover the selected, focused, warning, and empty states?
- Does the result remain readable in light, dark, ANSI-256, and monochrome
  terminals?
- Can every text field edit in the middle, paste, clear, and recover from an
  empty/no-match state?
- Do mouse targets still select the correct logical row with wrap and split
  enabled?
- Are binary/image dimensions, allocations, subprocesses, and Git paths
  bounded and repository-contained?
- Did this add a third place that shows the same binding?
