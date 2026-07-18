---
name: diffing-start-review
description: Start or reopen a local diffing review session and give the human its review URL. Use when the user asks to open diffing, inspect changes in the review UI, start a review, or send work for human review.
user_invocable: true
---

# Start a diffing review

Start the local review UI for the repository in scope and make its URL available to the human. Do not review or edit the changes unless the user also asks for that work.

## Choose the available integration

1. If MCP tools are available, call **`review_session_status`** first. Reuse its URL when the matching session is already running; otherwise call **`start_review_session`**. Pass structured diff arguments only when the user requested a specific scope.
2. Otherwise, if a shell is available, start `diffing --web --no-open` as a **persistent** background process from the repository. Use `diffing url` to recover the URL. A foreground command that dies when the tool call ends is not sufficient.
3. If neither MCP nor a persistent shell is available, explain that the host must start `diffing` in the repository.

Never guess a repository. Bind MCP with `diffing mcp --repo <absolute-path>` when the harness does not launch it from the workspace.

Optional health check: `diffing doctor`.

## Review scope

| Scope | How |
|-------|-----|
| Working tree (default) | no extra args |
| Staged | `--staged` |
| Recent commits | e.g. `HEAD~3` |
| Branch comparison | e.g. `main..HEAD` |
| Path filter | paths after `--` |
| GitHub PR | `diffing "gh pr 1234"` or `--gh-pr 1234` |
| Commit series (show mode) | `diffing show <revspec>...` |
| Native TUI | `diffing --tui` (experimental; requires a separately built or installed `diffing-tui` binary) |

Use structured argument arrays with `start_review_session`; do not compose a shell string from untrusted user input.

## Hand-off to the human

Return the local review URL (and plan URL if relevant: `/plan` or `/plan/<id>`). The human can leave inline comments and choose a verdict (**Send to agent** / plan **Submit review**).

If the user requested the complete review loop, continue with **`diffing-finish-review`** (code) or **`diffing-plan-review`** (plan); otherwise stop after the session is reachable.

Verdicts are behavioral controls: `comment-only` → no file edits; `changes-requested` → address open requests; `approved` → continue; `rejected` → stop building on the rejected approach.
