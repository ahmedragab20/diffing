---
"diffing": patch
---

Fix plan review layout and comment saving:

- Keep comment composers from jumping on the first keystroke, and start long plan source context collapsed so the field stays in view.
- Keep floating panels above the status bar, and stop the plan toolbar from wrapping Submit review over the view toggle.
- On a narrow plan page, keep the outline from sticking over the text.
- If a comment or reply fails to save, leave the draft open and show the error.
- On Safari, stop haptic clicks and Escape from dismissing an open popover or composer, and focus Submit review on the verdict.
- Map a rendered selection back to the right source lines through inline markdown, lists, links, and fenced code, and ignore headings inside code fences.
- Clearing a comment draft no longer lets a delayed save restore it.
