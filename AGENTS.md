# diffing — Agent Guidance

**diffing** is a local-first CLI for reviewing, navigating, and discussing git diffs with AI. It runs a local web server that provides a GitHub-like review UI for any git changes (working tree, staged, commits, branches). Agents interact with it via port-agnostic CLI subcommands or MCP.

## Quick Start for Any Agent

Prefer the diffing MCP tools when the harness exposes them: call
`review_session_status`, then `start_review_session` when needed. When running
inside the pi harness, prefer the built-in `diffing_*` extension tools
(registered by extensions/pi). The CLI is the portable fallback:

```bash
diffing                    # Start the preferred review UI for current repo
diffing setup              # First-time wizard (skills, MCP, doctor)
diffing mode <web|tui>     # Change the default interactive review mode
diffing sessions           # List/select/stop concurrent review sessions
diffing url                # Get server base URL (port-agnostic discovery)
diffing plan submit PLAN.md --model "<model>"  # Submit plan for review
diffing plan await         # Sync wait for verdict (prefer park after submit)
diffing mockup submit page.html --model "<model>"  # Submit HTML mockup
diffing mockup await       # Sync wait for mockup verdict (prefer park after submit)
diffing await-review       # Sync wait for Send to agent (prefer park when later)
diffing comments --open              # Dump open review comments as XML
diffing comments --format md         # Markdown export
diffing reply <id> --body "..." --model "<model>"  # Reply to comment
diffing resolve <id>                 # Mark comment resolved
diffing unresolve <id>               # Re-open a resolved thread
diffing comment edit <id> --body "..."
diffing progress --message "Working…" [--pct 40]
diffing doctor                       # Environment self-check
diffing mcp --repo /abs/path         # Stdio MCP server
```

Full CLI/MCP contracts: `docs/cli.md`. Human onboarding: `docs/getting-started.md`.

## Skill Registry

Load a skill when your task matches its trigger. All skills live in `.agents/skills/`.

| Skill | Trigger / When to Use |
| ------- | ---------------------- |
| `diffing` | Route any diffing request to the strongest available MCP, CLI, or offline workflow |
| `diffing-plan-review` | Submitting a markdown plan for human review before non-trivial work; awaiting verdict; replying/resolving plan comments |
| `diffing-mockup-author` | Authoring HTML mockup screens that match the product (states, `data-diffing`, no generic AI chrome) |
| `diffing-mockup-review` | Submitting HTML mockups for visual review; awaiting verdict; replying/resolving mockup comments |
| `diffing-review` | Performing a code review of local git changes; fetching diff/comments; posting inline comments; applying suggestions |
| `diffing-start-review` | Launching the diffing server so a human can review changes in the browser |
| `diffing-finish-review` | Waiting for human handoff ("Send to agent"), applying requested changes, resolving comments |
| `diffing-pr-read` | Reading or summarizing a GitHub PR through bounded, token-efficient inspect APIs |
| `diffing-pr-address` | Turning unresolved PR feedback into an approved local implementation |
| `diffing-release` | Cutting a new diffing release: `pnpm release --patch | --minor | --major`; version bump, changelog, tag, npm publish via CI, GitHub release |

Load the matching skill through the harness's normal skill mechanism. Each skill
is self-contained and uses natural-language triggers; no slash command or
vendor-specific tool API is required.

---

## Core Workflows

### Plan Review (design → approval → implement)

```
1. Write plan → ~/.diffing/<repo>/plan-sources/PLAN.md
2. diffing plan submit PLAN.md --model "<model>"
3. Share the plan URL; park (default). Only `plan await` / `--wait` if the human is reviewing now.
4. When they say ready (or after a sync await), read <plan-review> XML:
   - decision="approved"      → implement
   - decision="changes-requested" → revise plan, resubmit with --id, goto 3
   - decision="rejected"      → stop, rethink
5. diffing plan reply <id> --body "..." --model "<model>"  # answer questions
6. diffing plan resolve <id>     # mark addressed
```

Await timeout is a park signal — do not silent-loop. Resume with one `plan await` or `plan show` when the human is ready.

### Code Review (review → handoff → apply → resolve)

```
1. diffing                          # start server (or human already did)
2. diffing comments --open          # fetch human's comments as XML
3. For each open comment:
   - Change request → edit file → diffing reply --body "Done." --model "..." → diffing resolve
   - Question → diffing reply --body "Answer..." --model "..." (leave open)
   - Ambiguous → diffing reply --body "Clarify..." --model "..." (leave open)
4. Prefer async for the next round (park until human says ready); `await-review` only for sync waits
```

### Start → Finish Review (human-driven)

```
# Human or agent starts:
diffing                      # launches server + UI

# Agent finishes:
# Sync:  diffing await-review
# Async: share URL, park; when human says ready → await-review once or comments --open
# process comments as in Code Review above
```

---

## Development Workflow (for agents contributing TO diffing)

### Commands

```bash
pnpm build         # Full build (TypeScript + Rust TUI)
pnpm build:ts      # TypeScript only
pnpm test          # All tests (vitest + cargo)
pnpm test:ts       # TypeScript tests only
pnpm test:watch    # Watch mode
```

### Project Structure

```
src/
  cli.ts              # Main CLI entry, subcommand routing
  cli-agent.ts        # Agent subcommands (plan, review, gh, etc.)
  server.ts           # Hono web server (API + static UI)
  lib/                # Core logic (diff, git, comments, plans, etc.)
  ui/                 # React UI (components, hooks, Root.tsx)
  mcp.ts              # MCP server implementation
crates/
  diffing-tui/        # Native Rust TUI (optional --tui mode)
```

### Conventions

- **TypeScript**: Strict mode, ES modules, `node:` imports
- **React**: Function components, TanStack Query/Store, lucide-react icons
- **Testing**: Vitest + React Testing Library, colocated `__tests__/`
- **Imports**: Relative for `src/`, package names for deps
- **Paths**: Use `lib/path.ts` utilities, not raw `path` module
- **Errors**: Return `Result` types or throw; CLI exits with codes

---

## Mockup Review (Reference)

See `diffing-mockup-author` then `diffing-mockup-review`. Same verdicts as plans. Comment scope = **version + screen + viewport** (`desktop|tablet|mobile`). Storage: `mockups.json` + `mockup-sources/<id>/`. Cap is 24 screens. Prefer `revise_mockup op=replace-region` for a `data-diffing` block.
Never write mockup HTML into the consumer repo — submit inline (`submit_mockup({ html })`) or stdin.

```bash
printf '%s' "$html" | diffing mockup submit - --title T --model M
diffing mockup await [--timeout]
diffing mockup list|show|versions|handoff
diffing mockup inspect <summary|comments|comment|screen|preview> [<id>] [--status open] [--screen S] [--viewport V] [--version N] [--context none|anchor|source]
diffing mockup screen <upsert|remove|patch|replace-region> <id> <screen-id> [--file P|--text T --region R --replacement R] [--expected-version N]
diffing mockup threads <reply|edit|delete|resolve|unresolve> <comment-id> [<reply-id>] [--body "…"]
diffing design show|list|extract|propose|publish
```

Open `/mockup/<id>`. Comments are `section` / `block` / `point`; handoff XML is compact and open-only (`mockup-version=`/`viewport=` on each comment).
Bounded inspect → one-screen patch (`--expected-version` guarded, 409 on conflict) → atomic `threads` batch for replies/resolves.

## Plan Review (Reference)

See `diffing-plan-review` skill for full API, flags, examples, MCP tools.

### Key Commands

```bash
diffing plan submit PLAN.md [--title] [--source] [--model] [--id <id>] [--wait] [--save-source]
diffing plan await [--timeout <sec>]
diffing plan list [--json]
diffing plan show <id> [--version <n>] [--json]
diffing plan versions <id> [--json]
diffing plan reply <comment-id> --body <text> [--model]
diffing plan resolve <comment-id>
```

### Decision Flow

| Decision | Action |
| ---------- | -------- |
| `approved` | Implement as planned |
| `changes-requested` | Revise plan, `submit --id`, `await` again |
| `rejected` | Stop; do not implement |
| `comment-only` | Do not edit files; reply only |

### Plan UI (human)

Source / Read / Split (`m`), zen Read (`z`), **live edit** (`e` — autosave via `PUT`, Save as new version via `POST`, Discard / Esc for recent vs original rollback), outline (`o`), comments map (`c`), resizable split, inline comments on Source and Read (with severity + multi-line ranges), Submit review for verdict. See `docs/cli.md` §4b Plan review UI.

---

## Code Review (Reference)

See `diffing-review` skill for full API, suggestion blocks, MCP tools.

### Key Commands

```bash
diffing comments [--open] [--format xml|json|md]
diffing reply <id> --body <text> [--model]
diffing resolve <id>
diffing unresolve <id>
diffing comment edit <id> --body <text>
diffing comment delete <id>
diffing progress --message "…" [--model] [--pct]
diffing await-review [--timeout <sec>]
diffing url
diffing mode [web|tui]
diffing sessions [list|use|open|stop|kill]
```

### MCP (preferred when available)

Session: `review_session_status`, `start_review_session`  
Diff: `get_diff`, `diff_summary`, `diff_files`, `diff_hunks`, `diff_slice`, `diff_search`  
Comments: `create_comment` (path, side, line/range, body, optional **severity**), `list_comments`, `reply_to_comment`, `resolve_comment`, `unresolve_comment`, `edit_comment`, `delete_comment`, `apply_suggestion`, `resolve_all_comments`, `edit_reply`, `delete_reply`  
Loop: `await_review`, `report_progress`, `get_review_history`  
Plan: `submit_plan`, `await_plan_review`, `list_plans`, `get_plan`, `get_plan_versions`, `get_plan_version`, `reply_to_plan_comment`, `resolve_plan_comment`
Mockup: `submit_mockup`, `await_mockup_review`, `list_mockups`, `get_mockup`, `get_mockup_versions`, `get_mockup_version`, `inspect_mockup`, `revise_mockup`, `update_mockup_threads`, `reply_to_mockup_comment`, `resolve_mockup_comment`, `get_mockup_handoff`. Design system: `get_design_system`, `extract_design_system`, `propose_design_system`, `publish_design_system`

### HTTP API (for posting comments, applying suggestions)

```
POST   /api/comments              # Create inline comment (+ optional severity, multi-line)
PUT    /api/comments/<id>         # Edit body or {status: "resolved"|"open"}
DELETE /api/comments/<id>         # Delete comment
POST   /api/comments/resolve-all  # Resolve every open thread
POST   /api/comments/<id>/replies # Agent reply
POST   /api/comments/<id>/apply-suggestion  # Apply ```suggestion block
POST   /api/agent/progress        # Live progress toast
GET    /api/review/history        # Multi-round handoff history
```

---

## Plan/Review Integration

- **Plan review** happens *before* code — human approves approach
- **Code review** happens *after* changes — human reviews implementation
- Both use the same server, lockfile discovery, and comment/reply/resolve primitives
- A plan can spawn multiple code review rounds as implementation progresses

---

## Keep the Project Clean

THE CONSUMER PROJECT MUST STAY CLEAN. Never add scratch files (plans, notes, drafts, temp scripts, HTML mockups, .diffing/ directories) to the project root or any tracked directory. All agent working files — **including implementation plans and HTML mockups** — must live under `~/.diffing/`, which is outside the consumer project entirely.

If a file is not part of the shipped product, it does not belong in the user's source tree. Write plans to `~/.diffing/<repo>/plan-sources/`, never write mockup HTML into the repo (use MCP `submit_mockup({ html })` or stdin), and keep other scratch under `~/.diffing/`. Nothing goes in the working tree.

**This product tree is not a foreign plan host.** Agents must not `cd` into the diffing product checkout to submit, start, or await plans for other repositories. Prefer MCP `submit_plan` with inline `body`; otherwise run `diffing plan` from the consumer workspace. MCP “bound to …/diffing” names where the server runs — it is not an instruction to change cwd here for foreign work.
