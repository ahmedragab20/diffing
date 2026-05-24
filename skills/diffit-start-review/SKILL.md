---
name: diffit-start-review
description: "Start a code review session by launching the diffit server and opening the browser UI. Use when the user invokes /diffit-start-review."
user_invocable: true
---

# Start diffit Review

Launch the diffit server so the user can review their git changes in a browser-based UI and leave inline comments.

## What to do

### 1. Launch diffit

Run `diffit` in the background. By default it shows all working tree changes (staged + unstaged + untracked).

```bash
diffit
```

Common variations — use these when the context calls for it:

```bash
diffit -- --staged          # Only staged changes
diffit -- HEAD~3            # Last 3 commits
diffit -- main..HEAD        # Current branch vs main
diffit -p 8080             # Custom port (default: random available port)
```

Anything after `--` is passed directly to `git diff`, so any valid git diff arguments work.

**Important:** Run diffit in the background using the Bash tool with `run_in_background: true`, so the server stays alive while the user reviews.

### 2. Tell the user

After launching, tell the user:

> diffit is running. Review your changes in the browser and leave inline comments. When you're done, come back here and run `/diffit-finish-review`.

Keep it brief.
