---
name: diffing
description: Use diffing for a native human-AI review loop over local code changes or implementation plans. Routes requests to start a review UI, review changes, submit a plan for approval, wait for human feedback, and address inline comments across MCP, CLI, or pasted XML.
user_invocable: true
---

# diffing workflow router

diffing is a local-first review bridge: an agent exposes a diff or plan, a human reviews it in a browser UI (or experimental `--tui`), and both sides exchange structured comments and verdicts in real time.

Authoritative reference: repository `docs/cli.md` and root `Agents.md`.

## Detect capabilities first

Use the strongest available integration without asking the user to choose plumbing:

1. **Native diffing MCP tools**: call `review_session_status` first and `start_review_session` when needed.
2. **Shell CLI**: run `diffing` commands from the target repository; commands discover the active port via the lockfile.
3. **Offline handoff**: act on pasted `<code-review-comments>` or `<plan-review>` XML and return structured replies when live tools are unavailable.

Never guess the repository or hard-code a port. For global MCP clients, bind the server explicitly with `diffing mcp --repo <absolute-path>`.

## Route by intent

| Intent | Skill / workflow |
|--------|------------------|
| Open the UI or send changes to the human | `diffing-start-review` |
| Review the user's local changes and create findings | `diffing-review` |
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

CLI mirrors: `await-review`, `comments`, `reply`, `resolve`, `unresolve`, `comment edit|delete`, `progress`, `plan …`, `inspect …` (TUI), `doctor`, `mcp`, `url`.

## Comment model (diff + plan handoffs)

Shared by code review and plan review agent XML:

| Field | Notes |
|-------|--------|
| Line / range | `line="N"` or inclusive `line="A-B"` (`startLineNumber`–`lineNumber`) |
| Side (diff only) | `additions` \| `deletions` |
| Severity (optional) | `blocking` \| `nit` \| `question` \| `praise`; omit = untriaged |
| Body / code context | Markdown body + optional `<code>` / quote / source snapshot |

UI supports multi-line selection, range adjust, collapsible threads, and severity dropdown. Plan Read mode shows inline comments under sections; `c` toggles comments map; `z` toggles zen Read; `m` cycles Source/Read/Split.

## Behavioral contract

- Timeouts from await tools are **expected**; retry while waiting is still requested.
- Only act on **open** comments.
- Apply and resolve clear change requests; reply without resolving questions or ambiguous requests.
- Honor **severity** when present: prioritize **blocking**, leave **question** open after answer, treat **nit** as optional, skip code changes for **praise**.
- Multi-line ranges are **inclusive** — address the full span.
- **`comment-only`** forbids file edits.
- A plan may be implemented only after **`approved`**; revise the same plan ID on **`changes-requested`**; stop on **`rejected`**.
- Send replies/resolutions as work completes so the human UI stays live; await another round only when the user wants the loop to continue.
- Prefer `report_progress` / `diffing progress` for long-running apply work so the human sees a toast.
- Keep agent scratch (plans, notes) under `~/.diffing/`, never in the consumer project tree.
