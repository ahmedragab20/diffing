---
name: diffing-pr-address
description: Turn GitHub pull-request review feedback into a human-approved local implementation through diffing. Use when asked to address PR comments, fix reviewer requests, turn unresolved PR feedback into a plan, or implement requested changes on a PR branch. Default to a local checkout plus plan/review cycle; reply, resolve, publish, or otherwise mutate GitHub only with explicit user authorization.
---

# Address GitHub PR feedback through diffing

Use token-efficient PR reads to understand feedback, then switch to the normal local plan and implementation loop. Treat GitHub publication and thread mutation as a separate, authorization-gated step.

## 1. Gather only actionable PR context

1. Run `diffing sessions --json` when available and select the matching `gh-pr` session with `diffing sessions use <id>`. If none exists, start the requested PR session; concurrent local/TUI/other PR sessions may remain running. Attach or reconnect MCP after selection, call `review_session_status`, and verify normalized identity with `gh_overview`.
2. Read identity and counts with MCP `gh_overview` or CLI `diffing gh overview --json`.
3. Page unresolved published threads with `gh_list_threads` (`unresolvedOnly: true`) or `diffing gh threads --unresolved`. Read full bodies only for threads being acted on.
4. Page reviews with `gh_list_reviews` or `diffing gh reviews --format json`; include `CHANGES_REQUESTED` review bodies that add requirements beyond inline threads.
5. Inspect referenced files and lines with `diff_summary` → `diff_files` → `diff_hunks` / bounded `diff_slice`. Carry `generation`; restart traversal after a stale-generation error. Do not dump the full patch or PR session by default.

Classify each item as a concrete change, question, already-addressed/outdated request, or conflict. Preserve thread IDs and paths in the plan so implementation can be traced back to feedback.

## 2. Submit a local implementation plan

Write the plan under `~/.diffing/<repo>/plan-sources/`; never place scratch files in the repository. Cover requested changes, tests, feedback that needs clarification, and explicit non-goals.

Plan APIs are web-only. Before selecting another mode, retain the compact PR overview, actionable thread list, and PR session ID. Do **not** end the PR review. Select an existing web session with `diffing sessions use <id>` or start a concurrent one, reconnect MCP to the selected web session, then follow `diffing-plan-review`:

```bash
diffing sessions --json
diffing sessions use <web-session-id>   # reuse when present
# Or, when none matches:
diffing --web --no-open                 # starts a concurrent active session
diffing plan submit <plan-file> --model "<model>" --save-source
diffing plan await
```

Obey the verdict: implement only `approved`; revise the same plan ID on `changes-requested`; stop on `rejected`; discuss only on `comment-only`. Reply to open questions and resolve only incorporated change requests.

## 3. Implement on the PR head branch

After approval, verify the local repository and current branch. If the PR head is not checked out, use `gh pr checkout <ref>` as the normal local preparation step, preserving unrelated working-tree changes and reporting any checkout conflict.

Implement the approved scope, run proportionate tests/builds, and use the local diffing code-review loop (`diffing-start-review` / `diffing-finish-review`) for human feedback. Keep every shipped edit in the repository and every plan/note under `~/.diffing/`.

## 4. Gate remote GitHub actions

Do not reply to published comments, resolve/reopen threads, submit reviews, push, or publish other GitHub state unless the user explicitly authorized that specific external action. Local draft creation is not publication.

When publication is authorized:

1. Reselect the saved PR session with `diffing sessions use <pr-session-id>`, reconnect MCP if used, and confirm it with `gh_overview` before refreshing.
2. Dry-run review submission first (`gh_submit_review` with `dryRun: true` or `diffing gh pr-review ... --dry-run`).
3. Publish only the authorized replies/verdict and report what changed remotely.

If authorization is absent, finish with a local implementation summary plus a mapping from unresolved thread IDs to completed changes or remaining questions.
