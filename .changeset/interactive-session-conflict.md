---
"diffing": patch
---

Prompt when starting `diffing` while another review already owns the repo.

In an interactive TTY, offer Open existing session, Replace it, or Cancel.
Scripts can skip the prompt with `--reuse-session` or `--replace-session`.
MCP still never replaces a user-owned session.
