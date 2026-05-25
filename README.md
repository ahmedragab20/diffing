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
- **Copy comments** — One-click copy all comments as structured XML for AI coding agents
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

    Option A: Via API (Preferred if the diffit server is running locally)
    Send a POST request to add a reply:
      POST http://localhost:<port>/api/comments/<comment-id>/replies
      Payload: { "body": "Your response or clarification request here" }
    To mark a comment as resolved:
      PUT http://localhost:<port>/api/comments/<comment-id>
      Payload: { "status": "resolved" }

    Option B: Via Text Response (Offline / Chat Copy-Paste)
    If you do not have local API access, output your comments/replies inside a structured XML block at the end of your response:
      <comment-replies>
        <reply to="<comment-id>"><![CDATA[Your reply or clarification request here]]></reply>
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

## Agent Skills

Install the diffit skills to use diffit directly from your AI coding agent:

```bash
npx skills add ahmedragab20/diffit
```

The review workflow uses two commands:

1. **`/diffit-start-review`** — Launches the diffit server and opens the browser. Review your changes and leave inline comments.
2. **`/diffit-finish-review`** — The agent fetches all comments from the running diffit server via API, applies the requested changes, and marks each comment as resolved. The browser UI updates in real time as comments are resolved.

## License

MIT
