---
name: diffing-start-review
description: "Start a code review session by launching the diffing server and opening the browser UI. Use when the user invokes /diffing-start-review."
user_invocable: true
---

# Start diffing Review

Launch the diffing server so the user can review their git changes in a browser-based UI and leave inline comments.

## What to do

### 1. Launch diffing

Run `diffing` in the background. By default it shows all working tree changes (staged + unstaged + untracked).

```bash
diffing
```

Common variations — use these when the context calls for it:

```bash
diffing -- --staged          # Only staged changes
diffing -- HEAD~3            # Last 3 commits
diffing -- main..HEAD        # Current branch vs main
diffing -p 8080             # Custom port (default: random available port)
```

Anything after `--` is passed directly to `git diff`, so any valid git diff arguments work.

**Important:** Run diffing in the background using the Bash tool with `run_in_background: true`, so the server stays alive while the user reviews.

### 2. Tell the user

After launching, tell the user:

> diffing is running. Review your changes in the browser and leave inline comments. When you're done, click **"Send to agent"** in the toolbar — I'll pick the comments up automatically.

Keep it brief.

### 3. Wait for the handoff (optional, recommended)

Rather than making the user run a second command, you can block on the handoff immediately. Run:

```bash
diffing await-review
```

It sleeps until the user clicks **"Send to agent"**, then prints the review comments as XML — at which point follow the `diffing-finish-review` workflow to apply them. (If it exits with code 2 / `DIFFING_AWAIT_TIMEOUT`, just run it again to keep waiting.) Agents configured with the diffing MCP server can use the `await_review` tool instead.
