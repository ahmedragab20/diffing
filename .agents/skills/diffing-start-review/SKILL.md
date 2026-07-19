---
name: diffing-start-review
description: Start or reopen a diffing UI for local changes or a GitHub pull request and hand it to the human. Use when the user asks to open diffing, inspect changes in the review UI, start a review, or send work for human review.
---

# Start a diffing review

Start the local review UI for the repository in scope and make its URL available to the human. Do not review or edit the changes unless the user also asks for that work.

## Choose the available integration

1. If MCP tools are available, call **`review_session_status`** first and follow its mode-specific `nextAction`. Verify the returned repository and `diffArgs`; for `gh-pr`, verify PR identity with `diffing gh status` or `GET /api/gh/session`. Reuse only a matching session; report a scope/PR mismatch instead of trying to switch it. An active TUI is the human's terminal UI, not a browser URL; do not expose its capability-bearing agent API URL. Call **`start_review_session`** only when `mode: none`. It always starts a loopback web session and never launches or replaces the TUI or GitHub PR mode. Pass `diffArgs` only when the user requested a specific scope.
2. Otherwise, if a shell is available, start the requested mode as a **persistent** process from the repository: `diffing --web --no-open [scope…]` for local review, or `diffing --no-open --gh-pr <ref>` for a PR. Use `diffing url` to recover the URL. A foreground command that dies when the tool call ends is not sufficient; the interactive TUI belongs in the human's terminal, not an agent background process.
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
| GitHub PR | `diffing --no-open --gh-pr 1234` or `diffing "gh pr 1234" --no-open` |
| Commit series (show mode) | `diffing show <revspec>...` |
| Native TUI | `diffing --tui` (experimental; requires a separately built or installed `diffing-tui` binary) |

Use structured argument arrays with `start_review_session`; do not compose a shell string from untrusted user input.

`start_review_session` accepts safe line-oriented git-diff scope/filter/context/whitespace/rename arguments, but rejects diffing runtime flags, external drivers, output files, and non-patch formats. Modifiers need a revision or pathspec anchor; baseline mode accepts only staged/cached selection. Start GitHub PR mode through the CLI, not this MCP tool.

If the human starts the native TUI, agents can inspect its diff without full-patch transfer through MCP `diff_summary` / `diff_files` / `diff_hunks` / `diff_slice` / `diff_search` or CLI `diffing inspect …`. Do not start an extra web session merely to inspect a live TUI diff.

## Hand-off to the human

For web mode, return the verified base review URL; append `/plan` or `/plan/<id>` for plans and `/gh/pr` for a PR session. Do not invent a URL from a guessed port. For TUI mode, report that the review is already open in the human's terminal and do not return the agent API URL.

Set the correct expectation: local code review uses **Send to agent**, plan review uses **Submit review**, and GitHub PR mode uses local drafts followed by an explicitly authorized **Submit to GitHub**; PR mode has no Send-to-agent handoff.

If the user requested the complete review loop, continue with **`diffing-finish-review`** (code) or **`diffing-plan-review`** (plan); otherwise stop after the session is reachable.

Verdicts are behavioral controls: `comment-only` → no file edits; `changes-requested` → address open requests; `approved` → continue; `rejected` → stop building on the rejected approach.
