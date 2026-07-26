---
"diffing": patch
---

Add `diffing mode <web|tui>` to persist the default interactive review mode.

Explicit mode flags still take precedence, while pipes and redirects continue
to use terminal diff output.
