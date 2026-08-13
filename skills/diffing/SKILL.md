---
name: diffing
description: Use diffing for a native human-AI review loop over local code changes, GitHub pull requests, or implementation plans. Route requests to start the UI, list/select/open/stop concurrent sessions, inspect and review diffs, submit plans for approval, wait for feedback, address inline comments, or operate any diffing CLI, MCP, or loopback HTTP capability.
---

# diffing workflow router

diffing is a local-first review bridge: an agent exposes a diff or plan, a human reviews it in the web UI or native TUI, and both sides exchange structured comments and verdicts in real time.

Authoritative reference: repository `docs/cli.md`, root `AGENTS.md`, and the current MCP tool schemas.

## First 60 seconds

1. Identify the **consumer** target Git repository (the project you are implementing for). Never infer it from an unrelated current directory or from MCP “bound to …/diffing” product checkout. Never `cd` into the diffing product tree to submit/start/await plans for other work.
2. Prefer `review_session_status`. Read `repository`, `serverState`, `mode`, `diffArgs`, and `nextAction` before calling another MCP tool. When the active mode or scope does not match the request, inspect `diffing sessions --json` before starting or stopping anything.
3. Select the focused workflow from **Route by intent** below.
4. Reuse a compatible session. Treat "active" as the routing target for agent commands, not as the only allowed session. Select by mode and scope only when the user's intent is clear; never stop or replace a user-owned session without explicit approval.

## Detect capabilities first

Use the strongest available integration without asking the user to choose plumbing:

1. **Native diffing MCP tools**: call `review_session_status` first and follow its `mode` / `nextAction`. Call `start_review_session` only when no compatible session exists; it starts a loopback web session, not the TUI.
2. **Shell CLI**: run `diffing` commands from the **consumer** target repository; commands discover the active port via `server.json`. Use `diffing sessions` to manage concurrent web/TUI/PR sessions. For plans, stdin or `~/.diffing/<consumer>/plan-sources/` only — not the diffing product checkout.
3. **Loopback HTTP**: use the URL from `diffing url` only when the needed operation has no MCP/CLI mirror. Keep TUI capabilities secret.
4. **Offline handoff**: act on pasted `<code-review-comments>` or `<plan-review>` XML when live tools are unavailable.

Never guess the repository or hard-code a port. For global MCP clients, bind the server explicitly with `diffing mcp --repo <absolute-path>`.

## Select the correct concurrent session

Web, TUI, and GitHub PR reviews can coexist for one repository. Every new CLI launch gets a session ID, becomes active, and leaves older sessions running.

```bash
diffing sessions --json                 # safe summaries: id, active, mode, scope, URL
diffing sessions use <id-prefix>        # retarget agent CLI commands
diffing sessions open <id>|active       # select and open/print the human UI
diffing sessions stop <id>|active|all   # explicit lifecycle action
```

- Match both **mode** and **scope**. For PRs, confirm identity with `gh_overview`; for local reviews, compare `diffArgs` / the session `scope`.
- Use a unique session ID prefix (the displayed first eight characters normally suffice). Never select solely because a session is newest.
- `use` retargets `url`, `comments`, `inspect`, plan commands, and newly attached MCP discovery without stopping another review. `open` also selects the target. Stopping the active session elects the newest remaining live session.
- MCP does not expose session-list/use/stop tools. Use the CLI manager when selection is needed, then attach a fresh repository-bound MCP connection. Once an MCP connection starts or reuses a web session, treat it as pinned: a later `sessions use` must not silently retarget that in-flight workflow; reconnect intentionally to switch.
- Prefer coexistence. Use `--reuse-session` only to open the active review and `--replace-session` only when replacement was explicitly intended.

## Branch on session mode

| Mode | Valid agent path |
|------|------------------|
| `none` | Start a loopback web session with MCP `start_review_session`, or CLI `diffing --web --no-open`. |
| `web` | Prefer bounded `diff_*` inspection; all local comment, handoff, history, progress, suggestion, and plan tools are available. |
| `tui` | Use bounded `diff_*` inspection. Available review operations are create/list/edit/delete comment, reply, resolve/unresolve, and await. No browser UI, plan API, progress/history, bulk resolve, suggestion apply, or reply edit/delete. |
| `gh-pr` | Use `gh_overview`, bounded `diff_*`, and `gh_list_threads` / `gh_list_reviews`. Local handoff/plan workflows do not apply. Publishing or mutating GitHub requires explicit user authorization. |

## Use MCP efficiently

- Call `review_session_status` once at workflow entry and again only after a real lifecycle change or connection recovery. Consume `structuredContent`; do not parse the readable text when typed fields are available.
- If `start_review_session` returns `started` or `reused`, use its URL/scope directly. Do not call status or `diffing url` again just to rediscover the same session. The tool starts/reuses only a matching local **web** session; launch/select TUI and PR sessions with the CLI.
- Prefer one purpose-built mutation over an HTTP round trip. Do not fetch comments again immediately after `await_review`, or fetch a plan again immediately after `await_plan_review`; released payloads already contain the actionable state.
- Do not poll status, comments, or plans. Use async park/resume by default and one `await_*` only for an explicitly synchronous wait.

## Minimize tokens while preserving coverage

Choose inspection tools from the active session mode:

- **All modes**: start with `diff_summary`, page `diff_files` via `nextCursor` (optional `path` glob), then inspect relevant files with `diff_hunks` and bounded `diff_slice` (`path` XOR numeric `file`). TUI uses its sparse disk-backed index; web and PR sessions use an in-process patch index.
- Carry the `generation` returned by `diff_summary` into `diff_hunks`, `diff_slice`, and `diff_search`. If a call reports a stale generation (HTTP 409 through CLI/API), rerun `diff_summary` and restart that traversal; never combine rows from different generations.
- Continue `diff_search` with both `nextFile` and `nextRow`. Keep default or smaller line/byte budgets unless more context is necessary.
- **`mode: web`**: use repository-local reads/search for surrounding source. Keep `get_diff` as an escape hatch when a consumer needs the complete patch.
- **`mode: gh-pr`**: call `gh_overview` first, then bounded diff tools. Fetch published discussion with `gh_list_threads` (prefer `unresolvedOnly`) and `gh_list_reviews`; avoid the fat `/api/gh/session` payload.

The CLI mirror works in web, TUI, and PR sessions: `diffing inspect summary|files|hunks|slice|search`. Its compact JSON default is best for agents; use `--pretty` only for human debugging. Select the intended session first. `start_review_session` cannot create a TUI or PR session.

## Route by intent

| Intent | Skill / workflow |
|--------|------------------|
| Open the UI or send changes to the human | `diffing-start-review` |
| Review local changes or a GitHub PR and create findings | `diffing-review` |
| Read or summarize a GitHub PR token-efficiently | `diffing-pr-read` |
| Turn PR feedback into an approved local implementation | `diffing-pr-address` |
| Wait for human code-review feedback and address it | `diffing-finish-review` |
| Get a plan approved before implementation | `diffing-plan-review` |

If the harness does not expose named skills, apply those workflows from this router and the MCP tool descriptions.

## MCP tool map (current)

| Area | Tools |
|------|-------|
| Session | `review_session_status`, `start_review_session` |
| Diff | `get_diff`, `diff_summary`, `diff_files`, `diff_hunks`, `diff_slice`, `diff_search` |
| Comments | `create_comment` (path, side, line/range, body, optional **severity**), `list_comments`, `reply_to_comment`, `resolve_comment`, `unresolve_comment`, `edit_comment`, `delete_comment`, `edit_reply`, `delete_reply`, `apply_suggestion`, `resolve_all_comments` |
| Loop | `await_review`, `report_progress`, `get_review_history` |
| Plan | `submit_plan`, `await_plan_review`, `list_plans`, `get_plan`, `get_plan_versions`, `get_plan_version`, `reply_to_plan_comment`, `resolve_plan_comment` |
| GitHub PR | `gh_overview`, `gh_list_threads`, `gh_list_reviews`, `gh_list_draft_comments`, `gh_create_draft_comment`, `gh_refresh`, `gh_submit_review` |

MCP also advertises workflow prompts `review_local_changes` and `submit_plan_for_review`, plus resource `diffing://agent-guide`. They aid discovery but do not replace the focused skills or tool schemas.

## Complete CLI map

| Need | Command |
|------|---------|
| Start/review a diff | `diffing [--web|--terminal|--tui] [--host H] [--port N] [--no-open] [git-diff args] [revisions] [-- paths…]` |
| Commit-series UI | `diffing show <revspec>... [-- paths…]` |
| MCP server | `diffing mcp --repo <absolute-path>` |
| Wait/snapshot | `diffing await-review`; `diffing comments [--open] [--format xml|json|md]` |
| Reply/lifecycle | `diffing reply`; `resolve`; `unresolve`; `comment edit|delete` |
| Human-visible status | `diffing progress --message "…" [--pct N] [--comment-id ID] [--agent-id ID]` |
| Plan gate | `diffing plan submit|await|list|show|versions|reply|resolve` |
| GitHub PR | `diffing "gh pr <ref>"`; `diffing gh status|overview|threads|reviews|pr-fetch|pr-list-comments|pr-review` |
| Bounded diff reads | `diffing inspect summary|files|hunks|slice|search` |
| Discovery/DX | `diffing url`; `sessions [list] [--json]`; `sessions use <id>`; `sessions open [<id>|active]`; `sessions stop|kill <id>|active|all`; `mode [web|tui]`; `doctor`; `completion bash|zsh|fish`; `update` |

Use `diffing --help` and `docs/cli.md` for the full git-compatible option set and exact exit codes. Prefer stdin for long Markdown bodies/replies. `comment delete`, `delete_comment`, `delete_reply`, and GitHub publication are destructive or externally visible; use them only when the request clearly authorizes them.

## HTTP fallback map

Resolve the base URL with `diffing url`; never hard-code it. Prefer the native tool when one exists.

- Local review: `GET /api/diff`, `/api/comments`, `/api/review/await|status|history`, and `/api/agent/progress`; mutate through the documented comment/reply/resolve/suggestion endpoints.
- Plans: `/api/plans*` and `/api/plan-review/await|status` (web only).
- GitHub PRs: prefer slim `/api/gh/overview`, `/api/gh/threads`, and `/api/gh/reviews`; use `/api/gh/session` only for UI/full-state needs. PR refresh, drafts, published-conversation mutation, and submission remain under the documented `/api/gh/*` routes.
- The remaining UI-oriented routes (attachments, search, settings, file text, hunk history, open/save/revert) are documented in `docs/cli.md`. Do not invoke working-tree or external mutations unless the user requested that action.

Use CLI/MCP/API operations instead of editing `comments.json`, `plans.json`, or `server.json`. Those are implementation-owned files in per-repository `~/.diffing/` storage, not a public database API.

## Comment model (diff + plan handoffs)

Shared by code review and plan review agent XML:

| Field | Notes |
|-------|--------|
| Line / range | `line="N"` or inclusive `line="A-B"` (`startLineNumber`–`lineNumber`) |
| Side (diff only) | `additions` \| `deletions` |
| Severity (optional) | `blocking` \| `nit` \| `question` \| `praise`; omit = untriaged |
| Body / code context | Markdown body + optional `<code>` / quote / source snapshot |

UI supports multi-line selection, range adjust, collapsible threads, and severity dropdown. Plan Read mode shows inline comments under sections; `c` toggles comments map; `z` toggles zen Read; `m` cycles Source/Read/Split; `e` live-edits the plan (autosave PUT / Save as new version POST; Esc discard).

## Behavioral contract

- **Async handoff is the default** after submitting a plan or opening a review for later: share the URL, end the turn, resume when the human says ready.
- **Sync `await_*`** only when the human is reviewing now or asked you to wait.
- Timeouts from await tools are **expected park signals** (`disposition=park`); do not silent-loop. At most one extra await if they asked you to keep waiting.
- Only act on **open** comments.
- Apply and resolve clear change requests; reply without resolving questions or ambiguous requests.
- Honor **severity** when present: prioritize **blocking**, leave **question** open after answer, treat **nit** as optional, skip code changes for **praise**.
- Multi-line ranges are **inclusive** — address the full span.
- **`comment-only`** forbids file edits.
- A plan may be implemented only after **`approved`**; revise the same plan ID on **`changes-requested`**; stop on **`rejected`**.
- Send replies/resolutions as work completes so the human UI stays live; await another round only when the user wants the loop to continue.
- In web mode, prefer `report_progress` / `diffing progress` for long-running apply work so the human sees a toast.
- Keep agent scratch (plans, notes) under `~/.diffing/`, never in the consumer project tree.
- **Plans:** prefer MCP `submit_plan` with inline `body`. MCP binding to the product repo is not cwd. If MCP `--repo` mismatches the consumer, use CLI in the consumer — never `cd` into the product to “fix” repo scope.
