---
name: diffing-start-review
description: Start or reopen a diffing UI for local changes or a GitHub pull request and hand it to the human. Use when the user asks to open diffing, inspect changes in the review UI, start a review, or send work for human review.
---

# Start a diffing review

Start the local review UI for the repository in scope and make its URL available to the human. Do not review or edit the changes unless the user also asks for that work.

## Choose the available integration

1. If MCP tools are available, call **`review_session_status`** first. Verify the repository, mode, and `diffArgs`. If they do not match, inspect `diffing sessions --json`: select an existing match with `diffing sessions use <id>`, then reconnect MCP so the new connection discovers it. For `gh-pr`, confirm identity with `gh_overview`; do not use the full `/api/gh/session` payload merely for status. An active TUI is the human's terminal UI, not a browser URL; never expose its capability-bearing agent API URL.
2. Call **`start_review_session`** only to start or pin a matching local web session. It is idempotent, accepts structured `diffArgs`, and never launches, stops, or replaces TUI/PR sessions. If the desired web scope has no session and an incompatible session is active, start `diffing --web --no-open [scope…]` through the CLI; it safely coexists and becomes active, after which a fresh MCP connection can attach.
3. If a shell is the available integration, first reuse a matching entry from `diffing sessions --json`; otherwise start the requested mode as a **persistent** process from the repository: `diffing --web --no-open [scope…]` for local review, or `diffing --no-open --gh-pr <ref>` for a PR. Every new launch coexists and becomes active. Use `diffing sessions open <id> --no-open` to select and print a specific web/PR URL. A foreground command that dies when the tool call ends is not sufficient; the interactive TUI belongs in the human's terminal, not an agent background process.
4. If neither MCP nor a persistent shell is available, explain that the host must start `diffing` in the repository.

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
| Native TUI | `diffing --tui` (bundled by the normal `npm i -g diffing` install) |

Use structured argument arrays with `start_review_session`; do not compose a shell string from untrusted user input.

`start_review_session` accepts safe line-oriented git-diff scope/filter/context/whitespace/rename arguments, but rejects diffing runtime flags, external drivers, output files, and non-patch formats. Modifiers need a revision or pathspec anchor; baseline mode accepts only staged/cached selection. Start GitHub PR mode through the CLI, not this MCP tool.

If the human starts the native TUI, agents can inspect its diff without full-patch transfer through MCP `diff_summary` / `diff_files` / `diff_hunks` / `diff_slice` / `diff_search` or CLI `diffing inspect …`. Do not start an extra web session merely to inspect a live TUI diff.

## Hand-off to the human

For web mode, return the selected session's verified base review URL; append `/plan` or `/plan/<id>` for plans and `/gh/pr` for a PR session. Do not use `diffing url` before selecting the intended session, and never invent a URL from a guessed port. For TUI mode, report that the review is already open in the human's terminal and do not return the agent API URL.

Set the correct expectation: local code review uses **Send to agent**, plan review uses **Submit review**, and GitHub PR mode uses local drafts followed by an explicitly authorized **Submit to GitHub**; PR mode has no Send-to-agent handoff.

If the user requested the complete review loop, continue with **`diffing-finish-review`** (code) or **`diffing-plan-review`** (plan); otherwise stop after the session is reachable.

Verdicts are behavioral controls: `comment-only` → no file edits; `changes-requested` → address open requests; `approved` → continue; `rejected` → stop building on the rejected approach.
