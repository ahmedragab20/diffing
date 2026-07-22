---
"diffing": patch
---

Clarify async vs sync handoff for plan and code review waits.

After submit, park by default (share URL, end turn). Await tools still support
short sync waits; timeout returns disposition=park and tells agents not to
silent-loop.
