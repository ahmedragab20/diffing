---
title: Comments XML
description: Schema for agent handoff comment documents.
summary: Structured XML with instructions, optional general-comment, file groups, severity, and replies for await-review payloads.
order: 4
section: reference
---

Exported via `diffing comments`, `await-review`, MCP list/await tools, and UI clipboard.

## Elements

| Element | Role |
|---------|------|
| `<code-review-comments>` | Root |
| `<instructions>` | Self-documenting agent instructions |
| `<general-comment>` | Optional round-level markdown (CDATA) |
| `<file path="…">` | Groups threads per path |
| `<comment>` | Thread — attrs below |
| `<code>` | Optional line context (`+`/`-` prefixes) |
| `<body>` | Markdown (CDATA) |
| `<replies>` / `<reply>` | Thread replies |

### comment attributes

| Attr | Values |
|------|--------|
| `id` | UUID |
| `line` | `"15"` · `"10-15"` (inclusive) · `"file"` |
| `side` | `additions` \| `deletions` |
| `status` | `open` \| `resolved` |
| `severity` | optional `blocking` \| `nit` \| `question` \| `praise` |
| `created-at` | ISO-8601 |

### reply attributes

| Attr | Values |
|------|--------|
| `id` | UUID |
| `role` | `user` \| `agent` |
| `model` | set when role is agent |
| `created-at` | ISO-8601 |

## Example

```xml
<code-review-comments>
  <instructions>…</instructions>
  <general-comment><![CDATA[Looks good overall.]]></general-comment>
  <file path="src/utils/parser.ts">
    <comment id="c1" line="42-45" side="additions" status="open" severity="blocking" created-at="2026-05-24T22:00:00.000Z">
      <code><![CDATA[
+ const parsedToken = tokenize(input);
]]></code>
      <body><![CDATA[Guard undefined inputs.]]></body>
      <replies>
        <reply id="r1" created-at="2026-05-24T22:05:00.000Z" role="agent" model="claude">
          <![CDATA[Added a guard.]]>
        </reply>
      </replies>
    </comment>
  </file>
</code-review-comments>
```

## Severity policy for agents

| Severity | Action |
|----------|--------|
| `blocking` | Must address before resolve |
| `nit` | Optional |
| `question` | Answer; usually leave open |
| `praise` | No code change |
| omitted | Treat as normal open request |
