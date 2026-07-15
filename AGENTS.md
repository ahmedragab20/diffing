# diffing — Agent Guidance

**diffing** is a local-first CLI for reviewing, navigating, and discussing git diffs with AI. It runs a local web server that provides a GitHub-like review UI for any git changes (working tree, staged, commits, branches). Agents interact with it via port-agnostic CLI subcommands or MCP.

## Quick Start for Any Agent

Prefer the diffing MCP tools when the harness exposes them: call
`review_session_status`, then `start_review_session` when needed. The CLI is the
portable fallback:

```bash
diffing                    # Start review server for current repo (all changes)
diffing url                # Get server base URL (port-agnostic discovery)
diffing plan submit PLAN.md --model "<model>"  # Submit plan for review
diffing plan await         # Block until human reviews plan
diffing await-review       # Block until human sends code review comments
diffing comments --open    # Dump open review comments as XML
diffing reply <id> --body "..." --model "<model>"  # Reply to comment
diffing resolve <id>       # Mark comment resolved
```

## Skill Registry

Load a skill when your task matches its trigger. All skills live in `.agents/skills/`.

| Skill | Trigger / When to Use |
|-------|----------------------|
| `diffing` | Route any diffing request to the strongest available MCP, CLI, or offline workflow |
| `diffing-plan-review` | Submitting a markdown plan for human review before non-trivial work; awaiting verdict; replying/resolving plan comments |
| `diffing-review` | Performing a code review of local git changes; fetching diff/comments; posting inline comments; applying suggestions |
| `diffing-start-review` | Launching the diffing server so a human can review changes in the browser |
| `diffing-finish-review` | Waiting for human handoff ("Send to agent"), applying requested changes, resolving comments |

Load the matching skill through the harness's normal skill mechanism. Each skill
is self-contained and uses natural-language triggers; no slash command or
vendor-specific tool API is required.

---

## Core Workflows

### Plan Review (design → approval → implement)

```
1. Write plan → ~/.diffing/<repo>/plan-sources/PLAN.md
2. diffing plan submit PLAN.md --model "<model>"
3. diffing plan await              # blocks until human decides
4. Read <plan-review> XML:
   - decision="approved"      → implement
   - decision="changes-requested" → revise plan, resubmit with --id, goto 3
   - decision="rejected"      → stop, rethink
5. diffing plan reply <id> --body "..." --model "<model>"  # answer questions
6. diffing plan resolve <id>     # mark addressed
```

### Code Review (review → handoff → apply → resolve)

```
1. diffing                          # start server (or human already did)
2. diffing comments --open          # fetch human's comments as XML
3. For each open comment:
   - Change request → edit file → diffing reply --body "Done." --model "..." → diffing resolve
   - Question → diffing reply --body "Answer..." --model "..." (leave open)
   - Ambiguous → diffing reply --body "Clarify..." --model "..." (leave open)
4. diffing await-review             # block for next round (optional)
```

### Start → Finish Review (human-driven)

```
# Human or agent starts:
diffing                      # launches server + UI

# Agent finishes:
diffing await-review         # blocks until "Send to agent"
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

## Plan Review (Reference)

See `diffing-plan-review` skill for full API, flags, examples, MCP tools.

### Key Commands

```bash
diffing plan submit PLAN.md [--title] [--source] [--model] [--id <id>] [--wait]
diffing plan await [--timeout <sec>]
diffing plan list [--json]
diffing plan show <id> [--version <n>] [--json]
diffing plan versions <id> [--json]
diffing plan reply <comment-id> --body <text> [--model]
diffing plan resolve <comment-id>
```

### Decision Flow

| Decision | Action |
|----------|--------|
| `approved` | Implement as planned |
| `changes-requested` | Revise plan, `submit --id`, `await` again |
| `rejected` | Stop; do not implement |

---

## Code Review (Reference)

See `diffing-review` skill for full API, suggestion blocks, MCP tools.

### Key Commands

```bash
diffing comments [--open] [--json]
diffing reply <id> --body <text> [--model]
diffing resolve <id>
diffing await-review [--timeout <sec>]
diffing url
```

### HTTP API (for posting comments, applying suggestions)

```
POST   /api/comments              # Create inline comment
PUT    /api/comments/<id>         # Edit comment
DELETE /api/comments/<id>         # Delete comment
POST   /api/comments/<id>/replies # Agent reply
PUT    /api/comments/<id>         # Resolve: {status: "resolved"}
POST   /api/comments/<id>/apply-suggestion  # Apply ```suggestion block
```

---

## Plan/Review Integration

- **Plan review** happens *before* code — human approves approach
- **Code review** happens *after* changes — human reviews implementation
- Both use the same server, lockfile discovery, and comment/reply/resolve primitives
- A plan can spawn multiple code review rounds as implementation progresses

---

## Keep the Project Clean

THE CONSUMER PROJECT MUST STAY CLEAN. Never add scratch files (plans, notes, drafts, temp scripts, .diffing/ directories) to the project root or any tracked directory. All agent working files — **including implementation plans** — must live under `~/.diffing/`, which is outside the consumer project entirely.

If a file is not part of the shipped product, it does not belong in the user's source tree. Write plans, notes, experiments, and agent scratch to `~/.diffing/<repo>/plan-sources/` or pipe them on stdin. Nothing goes in the working tree.
