# diffit

A local code review tool designed for the coding agent workflow. Review AI-generated changes in a GitHub PR-like web UI, leave inline comments, then hand them back to your coding agent to fix.

![screenshot](https://raw.githubusercontent.com/ahmedragab20/diffit/main/screenshot.png)

## Install

```bash
npm install -g diffit
```

## Usage

Run in any git repository:

```bash
diffit
```

This starts a local server and opens your browser with a diff review UI.

### Options

```
diffit [options] [-- <git-diff-args>]

Options:
  -p, --port <port>   Server port (default: 3433)
  --no-open           Don't auto-open browser

Examples:
  diffit                          # Review working tree changes
  diffit -p 8080                  # Use custom port
  diffit -- HEAD~3                # Diff against 3 commits ago
  diffit -- main..HEAD            # Diff between branches
  diffit -- --cached -- src/      # Staged changes in src/
```

## Features

- **Split / Unified view** — Toggle between side-by-side and inline diff
- **Syntax highlighting** — Powered by Shiki with GitHub themes
- **File tree** — Hierarchical file browser with search filter and file change-type icons
- **Inline comments** — Click the `+` button on any line to add a review comment
- **Comment replies** — AI agents can reply to comments via API, displayed with bot avatar in the UI
- **Comment status tracker** — Sidebar widget showing open, replied, and resolved comment counts with click-to-navigate links
- **Send to agent** — One click hands your comments to a waiting agent automatically — no copy-paste, works with any agent/model via the `diffit` CLI or an MCP server
- **Copy comments** — One-click copy all comments as structured XML for AI coding agents (offline fallback)
- **Image preview** — Side-by-side comparison for added, modified, and deleted images
- **Viewed tracking** — Mark files as reviewed to track progress
- **Staged / Untracked toggles** — Choose which changes to include
- **Custom diff commands** — Pass any `git diff` arguments after `--`
- **EditorConfig support** — Respects `.editorconfig` for per-file tab size
- **Persistent settings** — Your preferences are saved across sessions

## Comment Output Format

When you click "Copy comments", the output is structured XML optimized for AI agents, featuring embedded self-documenting instructions, complete metadata, XML safety using CDATA blocks, and reply threads:

```xml
<code-review-comments>
  <instructions>
    You are an AI coding assistant. You are receiving a structured list of code review comments to address in the repository.
    For each file, review the inline comments and apply the changes requested.
    - Target lines are specified by the "line" attribute (e.g. line="10" or line="10-15").
    - "side" indicates whether the comment is on "additions" (added/modified lines) or "deletions" (deleted/old lines).
    - "status" indicates whether the comment is "open" or "resolved". Only address comments with status="open".
    - The <code> block contains the specific code context at the reviewed lines, prefixed with "+" or "-".
    - The <body> tag contains the review feedback or request.
    - If developers have replied to the comment, their discussion is captured under the <replies> element.
    - The comment "id" attribute can be used to reference or update the comment via API if available.

    HOW TO REPLY OR ASK FOR CLARIFICATION:
    If you need to ask for clarification, explain what you did, or reply to any comment:

    Option A: Via the diffit CLI or MCP (Preferred — port-agnostic, no copy-paste)
      diffit reply <comment-id> --body "Your response" --model "<your-model-name>"
      diffit resolve <comment-id>
    (Or the equivalent MCP tools: reply_to_comment, resolve_comment.)

    Option B: Via the local HTTP API (if you know the running port)
      POST http://localhost:<port>/api/comments/<comment-id>/replies
      Payload: { "body": "Your response or clarification request here", "model": "<your-model-name>" }
      PUT  http://localhost:<port>/api/comments/<comment-id>  Payload: { "status": "resolved" }

    Option C: Via Text Response (Offline / Chat Copy-Paste)
    If you do not have local API access, output your comments/replies inside a structured XML block at the end of your response:
      <comment-replies>
        <reply to="<comment-id>" model="<your-model-name>"><![CDATA[Your reply or clarification request here]]></reply>
      </comment-replies>
  </instructions>
  <file path="src/utils/parser.ts">
    <comment id="c1" line="42" side="additions" status="open" created-at="2026-05-24T22:00:00.000Z">
      <code><![CDATA[+ const parsedToken = tokenize(input)]]></code>
      <body><![CDATA[Rename `x` to `parsedToken` for clarity.]]></body>
      <replies>
        <reply id="r1" created-at="2026-05-24T22:05:00.000Z" role="agent" model="claude-3-5-sonnet">
          <![CDATA[I agree, renamed.]]>
        </reply>
      </replies>
    </comment>
    <comment id="c2" line="15" side="deletions" status="open" created-at="2026-05-24T22:01:00.000Z">
      <code><![CDATA[- if (input != null) {]]></code>
      <body><![CDATA[This null check removal may cause a bug when `input` is undefined.]]></body>
    </comment>
  </file>
</code-review-comments>
```

Each comment includes:
- **Instructions**: A detailed system prompt instructing the agent on how to interpret and act on the comments.
- **Attributes**: Every `<comment>` includes its unique `id`, targeted line range (`line`), change `side` (`additions` or `deletions`), comment `status` (`open` or `resolved`), and ISO `created-at` timestamp.
- **CDATA Blocks**: Code snippets (`<code>`) and comment bodies (`<body>`) are wrapped in `<![CDATA[ ... ]]>` to prevent special characters from breaking XML parsers.
- **Replies**: Nested conversation history (if any) is preserved within `<replies>` and `<reply>` elements.

## Agent Handoff (no copy-paste)

Instead of copying comments into a chat, you can hand them to an agent automatically — and it works regardless of which agent/model is active. The model is **"the agent waits, you release it"**:

1. The agent runs a blocking command (or MCP tool) and sleeps.
2. You review in the browser and click **"Send to agent"** in the toolbar (a green dot on the button means an agent is connected and waiting).
3. The agent instantly receives your comments, applies changes, and replies — the UI updates live as it works. Add more comments and click Send again for another round.

### CLI (any agent with a shell)

The `diffit` binary doubles as a port-agnostic client. Each subcommand discovers the running server for the current repo via a lockfile — no port needed:

```bash
diffit await-review                 # block until you click "Send to agent"; prints comments as XML
diffit comments [--open] [--json]   # one-shot dump of current comments
diffit reply <id> --body "…" --model "<name>"   # post an agent reply
diffit resolve <id>                 # mark a comment resolved
diffit url                          # print the running server's base URL (for raw API calls)
```

`await-review` exits `0` when comments arrive (XML on stdout), `2` if it times out (just run it again to keep waiting), and `3` if no server is running.

### MCP server (any MCP-capable agent: Claude, Cursor, Codex, Gemini…)

Run `diffit mcp` as an MCP server over stdio. It exposes the tools `await_review`, `list_comments`, `reply_to_comment`, and `resolve_comment`. Configure your client:

```json
{ "mcpServers": { "diffit": { "command": "diffit", "args": ["mcp"] } } }
```

No port configuration is needed — the server is discovered from the repo's lockfile.

## Agent Skills

Install the diffit skills to use diffit directly from your AI coding agent:

```bash
npx skills add ahmedragab20/diffit
```

The review workflow uses two commands:

1. **`/diffit-start-review`** — Launches the diffit server and opens the browser. Review your changes and leave inline comments.
2. **`/diffit-finish-review`** — The agent runs `diffit await-review`, blocks until you click **"Send to agent"**, then applies the requested changes and marks each comment as resolved. The browser UI updates in real time as comments are resolved.

## License

MIT
