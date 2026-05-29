# ⚡ diffing

A local-first code review tool and double-sided bridge designed for the modern AI coding agent workflow. Review AI-generated changes in a high-fidelity, GitHub-like web UI, leave inline comments, and hand them back to your coding agent to fix in real time.

![screenshot](https://raw.githubusercontent.com/ahmedragab20/diffing/main/screenshot.png)

---

## 🚀 Quick Start

### 1. Install
Install `diffing` globally via npm:
```bash
npm install -g diffing
```

### 2. Run
Launch it within any active git repository:
```bash
diffing
```
This instantly spins up a local server, establishes an active repository watcher, and opens your default browser to an interactive code review dashboard.

---

## ✨ Features

- **🤖 Collaborative AI Replies** — Connected coding agents reply directly to inline comments via API or MCP, rendering in the web interface in real time with agent tags.
- **🔍 Rust-Powered Code Search (powered by fff)** — Blazing-fast, native fuzzy file search, text grep, and syntactic symbol lookup directly inside your browser review panel.
- **📤 Agent Handoff** — A single click on the **"Send to Agent"** toolbar button pushes comments directly to a waiting AI process (no copy-pasting required).
- **📂 Image Diff Previews** — Visual comparison modes for added, changed, and deleted image files.
- **🔄 Split / Unified View** — Seamlessly toggle between side-by-side or inline code diff layouts.
- **🎨 Syntax Highlighting** — Powered by Shiki with high-fidelity GitHub themes.
- **🌲 Interactive File Tree** — Hierarchical file navigation with views tracking and change-type indicators (added, modified, deleted).
- **💬 Inline Comment Threads** — Hover and click the `+` line button to add a comment directly onto any addition or deletion line.
- **📊 Status Dashboard** — Tracks open, replied, and resolved comments, providing instant click-to-navigate references.
- **⚙️ EditorConfig Integration** — Respects your local `.editorconfig` rules for accurate, per-file tab sizing.

---

## 🔌 Git Diff Drop-in Compatibility

`diffing` is designed as a **seamless, full drop-in replacement for `git diff`**. It features a comprehensive option parser that understands standard git revisions, options, and pathspecs, forwarding them directly to your local git engine.

Whether you are comparing branches, reviewing staged changes, or filtering specific directories, simply swap `git diff` for `diffing` to instantly elevate your review into a premium, interactive browser interface:

```bash
diffing                          # Review working tree changes in the browser UI
diffing --staged                 # Review staged changes (drop-in for git diff --staged)
diffing HEAD~3                   # Review working tree changes against 3 commits ago
diffing main..feature            # Compare two branches (drop-in for git diff main..feature)
diffing -- --cached -- src/      # Staged changes specifically in the src/ directory
```

### 🛠️ Intelligent Output Modes (TTY Auto-Detection)
To integrate flawlessly with your existing developer shell workflows, build pipelines, and command scripts, `diffing` automatically resolves the optimal output mode based on how stdout is directed:
- **Web Mode (Default for interactive TTY)**: When executed in an interactive terminal session, it boots the local Hono review server, registers the repository lockfile, and opens your default browser.
- **Terminal Mode (Default for pipes, redirects, or non-TTY)**: When output is piped (e.g. `diffing | grep "const"`) or redirected to a file, it falls back to behave **exactly like `git diff`**, streaming clean, standard unified diff patch text directly to standard output and exiting.

> [!TIP]
> Any standard output control or format-related flags (such as `--raw`, `--numstat`, `--stat`, `--exit-code`, `--quiet`, or `-o`) will automatically force Terminal Mode fallback.

> [!TIP]
> For a full list of all git option categories (algorithms, whitespace ignoring, context lines, word-level diffs, moved/copied detection, and path filtering) supported by `diffing`, see the [CLI Reference Manual](docs/cli.md).

---

## 🔍 Rust-Powered Search (powered by fff)

`diffing` features an incredibly fast code search capability integrated directly into the sidebar search palette, powered by a native Rust finder engine (`@ff-labs/fff-node`):

- **Fuzzy File Matching**: Rapidly locates files in your repository using error-tolerant fuzzy search.
- **Codebase Grep**: Instant case-insensitive text search across all file contents, with support for advanced **Regular Expressions**.
- **Syntactic Symbol Finder**: Easily tracks down function declarations, class headers, and variable definitions, automatically classified server-side.
- **Intelligent Frecency Ranking**: Remembers which files you open for specific queries using a local SQLite database, floating high-value results to the top of subsequent searches.
- **"Changed Only" Filter**: Restricts search scopes exclusively to the files changed in the active git diff (perfect for focusing on PR contents).

---

## 🤖 The AI Agent Loop (Handoff Protocol)

`diffing` solves the friction of copy-pasting code review notes into LLM chat boxes. It establishes an **"agent waits, human releases"** pipeline using a robust, port-agnostic lockfile mechanism.

```text
1. The agent runs a blocking command/tool and enters sleep mode.
2. You review code in your browser, leave inline comments, and click "Send to agent".
3. The agent wakes up instantly, receives comments as structured XML, applies edits, and posts replies.
```

### A. CLI Integration (For any terminal-based agent)
The `diffing` binary acts as a port-agnostic CLI client. It automatically discovers the running server by reading a local repository lockfile:

```bash
diffing await-review                 # Block process until you click "Send to agent"; outputs comments as XML
diffing comments [--open] [--json]   # One-shot query of the comments database
diffing reply <id> --body "..."     # Post an agent response or explanation
diffing resolve <id>                 # Mark a comment resolved, updating the UI live
diffing url                          # Retrieve the active server base URL
```

### B. Model Context Protocol (MCP) Server
If your agent supports MCP (such as Cursor, Claude Desktop, or Gemini), configure `diffing` as a stdio-based MCP server. No ports need to be configured:

```json
{
  "mcpServers": {
    "diffing": {
      "command": "diffing",
      "args": ["mcp"]
    }
  }
}
```
Exposes four powerful tools directly to your agent: `await_review`, `list_comments`, `reply_to_comment`, and `resolve_comment`.

### C. Agent Skills
You can install diffing skills directly into your AI coding assistant:
```bash
npx skills add ahmedragab20/diffing
```
Provides two primary commands to coordinate reviews:
1. **`/diffing-start-review`** — Launches the review server.
2. **`/diffing-finish-review`** — Blocks the agent using `await-review` until comments are sent, then applies requested edits.

---

## 📦 Comment XML Specification

When review comments are exported or streamed to a waiting agent, they are serialized into an optimized, self-documenting XML structure equipped with CDATA blocks:

```xml
<code-review-comments>
  <instructions>
    You are an AI coding assistant receiving a structured list of code review comments to address.
    For each file, review the inline comments and apply the changes requested.
    - Target lines are specified by the "line" attribute (e.g. line="42" for single lines, line="42-45" for multi-line blocks, or line="file" for file-level notes).
    - "side" indicates whether the comment is on "additions" (new code) or "deletions" (old code).
    - "status" indicates whether the comment is "open" or "resolved". Only address "open" comments.
    - The <code> block contains the code context at the reviewed lines.
    - The <body> tag contains the review feedback or request.
    
    HOW TO REPLY OR MARK AS RESOLVED:
    - Prefer using the diffing CLI or MCP server tools (reply_to_comment / resolve_comment).
    - CLI: `diffing reply <id> --body "..."`
    - CLI: `diffing resolve <id>`
  </instructions>

  <!-- [Optional] High-Level General Review Comment -->
  <general-comment>
    <![CDATA[Please refactor the parsing module to improve reliability.]]>
  </general-comment>

  <file path="src/utils/parser.ts">
    <!-- [Example A] Multi-Line Selection Addition Comment -->
    <comment id="c1" line="42-45" side="additions" status="open" created-at="2026-05-24T22:00:00.000Z">
      <code><![CDATA[
+ const parsedToken = tokenize(input);
+ if (parsedToken.type === 'EOF') {
+   return null;
+ }
]]></code>
      <body><![CDATA[Refactor this tokenization block to check for undefined inputs as well.]]></body>
      <replies>
        <reply id="r1" created-at="2026-05-24T22:05:00.000Z" role="agent" model="claude-3-5-sonnet">
          <![CDATA[I agree, I will add a guard clause for undefined.]]>
        </reply>
      </replies>
    </comment>

    <!-- [Example B] Whole-File General Comment -->
    <comment id="c2" line="file" side="additions" status="open" created-at="2026-05-24T22:08:00.000Z">
      <body><![CDATA[This parser module needs additional unit tests to cover negative bounds.]]></body>
    </comment>
  </file>
</code-review-comments>
```

---

## 📖 Deep-Dive Documentation

For advanced features, internal API endpoints, sequence specifications, and configuration parameters, explore the complete guide:

> [!IMPORTANT]
> Read the [CLI & Protocol Reference Manual](docs/cli.md) for detailed descriptions of:
> - TTY Auto-Detection and Output Mode resolution.
> - The port-agnostic discovery lockfile mechanics.
> - Monotonic sequence `round` synchronization for race-free polling.
> - Full Web API endpoints schema (`GET /api/review/await`, `POST /api/comments`, etc.).
> - Custom git config shell aliases.

---

## License

MIT
