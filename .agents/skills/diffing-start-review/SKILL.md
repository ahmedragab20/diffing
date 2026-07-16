---
name: diffing-start-review
description: Start or reopen a local diffing review session and give the human its review URL. Use when the user asks to open diffing, inspect changes in the review UI, start a review, or send work for human review.
user_invocable: true
---

# Start a diffing review

Start the local review UI for the repository in scope and make its URL available to the human. Do not review or edit the changes unless the user also asks for that work.

## Choose the available integration

1. If diffing MCP tools are available, call `review_session_status` first. Reuse its URL when the matching session is already running; otherwise call `start_review_session`. Pass diff arguments only when the user requested a specific scope.
2. Otherwise, if a shell is available, start `diffing --web --no-open` as a persistent background process from the repository. Use `diffing url` to recover the URL. A foreground command that is terminated when the tool call ends is not sufficient.
3. If neither MCP nor a persistent shell is available, explain that the host must start `diffing` in the repository and return once it is running.

Never guess a repository. MCP should be bound with `diffing mcp --repo <absolute-path>` when the harness does not launch it from the workspace.

## Review scope

- Working tree (default): no diff arguments.
- Staged changes: `--staged`.
- Recent commits: `HEAD~3`.
- Branch comparison: `main..HEAD`.
- Path filtering: put paths after `--`.

Use structured argument arrays with `start_review_session`; do not compose a shell string from user input.

## Hand-off to the human

Return the local review URL and say that the human can leave inline comments and choose a verdict. If the user requested the complete review loop, continue with the `diffing-finish-review` workflow; otherwise stop after the session is reachable.

Verdicts are behavioral controls: `comment-only` means no file edits, `changes-requested` means address open requests, `approved` permits normal continuation, and `rejected` means stop building on the rejected approach.
