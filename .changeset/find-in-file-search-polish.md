---
'diffing': patch
---

Polish the file-scoped find-in-file search (`⌘F` / `F`):

- Persistently highlight every match in the diff (with a distinct marker for
  the current match), including rows that lazy-mount inside the diff's shadow
  DOM.
- Re-focus and select the search field when `⌘F` is pressed again after the
  field blurs, and scroll the field back into view while typing after a match
  jump moved it off-screen.
- Harden "active file" detection so `⌘F` targets the file you're actually
  looking at: the card under the mouse, or the card with the most visible
  height in the viewport.
- Pressing `Esc` in the search bar now closes only the search — it no longer
  also exits zen mode.
