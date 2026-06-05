---
name: diffing-start-review
description: "Start a code review session by launching the diffing server and opening the browser UI. Use when the user invokes /diffing-start-review."
user_invocable: true
---

# Start diffing Review — Detailed Reference

> See AGENTS.md for the workflow overview. This file contains the complete CLI
> reference for launching the review server.

---

## 1. Launch diffing

Run `diffing` in the background. By default it shows all working tree changes
(staged + unstaged + untracked).

```bash
diffing
```

Common variations — use when context calls for it:

```bash
diffing -- --staged          # Only staged changes
diffing -- HEAD~3            # Last 3 commits
diffing -- main..HEAD        # Current branch vs main
diffing -p 8080             # Custom port (default: random available port)
```

Anything after `--` is passed directly to `git diff`, so any valid git diff
arguments work.

**Important:** Run diffing in the background using the Bash tool with
`run_in_background: true`, so the server stays alive while the user reviews.

---

## 2. Tell the User

After launching, tell the user:

> diffing is running. Review your changes in the browser and leave inline
> comments. When you're done, click **"Send to agent"** in the toolbar — I'll
> pick the comments up automatically.

Keep it brief.

---

## 3. Wait for Handoff (Optional, Recommended)

Rather than making the user run a second command, block on the handoff
immediately:

```bash
diffing await-review
```

It sleeps until the user clicks **"Send to agent"**, then prints the review
comments as XML — at which point follow the `diffing-finish-review` workflow to
apply them. (If it exits with code 2 / `DIFFING_AWAIT_TIMEOUT`, just run it
again to keep waiting.) Agents configured with the diffing MCP server can use
the `await_review` tool instead.

---

## Summary

| Command | Purpose |
|---------|---------|
| `diffing` | Launch server + UI in background |
| `diffing -- --staged` | Review only staged changes |
| `diffing -- HEAD~3` | Review last 3 commits |
| `diffing -- main..HEAD` | Review branch vs main |
| `diffing await-review` | Block until human sends review |