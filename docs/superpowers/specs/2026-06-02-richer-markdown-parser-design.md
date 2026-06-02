# Richer Markdown Parser — Design Spec

**Date:** 2026-06-02
**Status:** Approved
**Branch:** `feat/richer-markdown-parser`

## Goal

Replace the current `marked`-based string→HTML markdown pipeline with a
component-based `react-markdown` integration that supports richer content
(GFM tables, images, task lists, syntax-highlighted code, and Mermaid
diagrams), eliminates `dangerouslySetInnerHTML`, and is safe-by-construction.
All markdown render sites across the UI are migrated. Video is deferred but the
architecture leaves a localized seam to add it later.

## Current State (before)

- **Single entry point:** `parseMarkdown()` in `src/ui/utils.ts` uses `marked`
  v18 with a custom `highlight.js` code renderer, after a blunt manual escape of
  all HTML (a coarse XSS guard that also disables raw HTML and is not a real
  sanitizer).
- **9 render call sites across 6 components**, all via
  `dangerouslySetInnerHTML` on a `.markdown-body` container:
  `MarkdownField`, `CommentForm`, `PlanReview` (×2), `CommentTracker` (×2),
  `PlanCommentBubble` (×2), `CommentBubble` (×2).
- **GFM tables already parse** (marked `gfm: true`) but have **no CSS**, so they
  render unstyled. **Images** are supported and styled.
- **`suggestion` code-block feature:** ` ```suggestion ` fences are special.
  In `CommentForm` they are split out and rendered as a "suggestion-card" diff;
  in all rendered bodies they are hidden via the CSS rule
  `.markdown-body pre:has(code.language-suggestion) { display: none }`.
- **highlight.js** provides code theming via `.hljs-*` classes in `global.css`.
- **Clipboard-image paste** uploads to `/api/attachments` and inserts
  `![](url)` into the textarea source (in `MarkdownField` / `CommentForm`).
- **Markdown round-trips to GitHub** as raw text (`SubmitToGitHubPopover` and PR
  flows), so the stored markdown source must stay standard/GFM-compatible.
- **Out of scope for rendering:** `server.ts`, `mcp.ts`, `cli-agent.ts`,
  `lib/plan-format.ts`, `lib/plan-types.ts` treat markdown as plain text (no
  rendering). The Rust TUI (`crates/diffing-tui`) is a separate terminal
  renderer.

## Architecture (after)

Introduce one reusable component:

```
src/ui/components/Markdown.tsx   →  <Markdown content={string} className?={string} />
```

It replaces every `parseMarkdown(x)` + `dangerouslySetInnerHTML` usage.

### Pipeline

- **`react-markdown`** core — renders markdown to React nodes. No
  `dangerouslySetInnerHTML`. Raw embedded HTML stays inert (we do **not** add
  `rehype-raw`), matching today's behavior. react-markdown's built-in
  `urlTransform` neutralizes dangerous URL protocols (`javascript:` etc.).
- **`remark-gfm`** — tables, strikethrough, task lists, autolinks, footnotes.
- **`rehype-highlight`** — syntax highlighting via lowlight (the AST form of
  highlight.js); emits the same `.hljs-*` classes the existing CSS targets, with
  no `dangerouslySetInnerHTML`. Configured with `ignoreMissing: true` and
  `plainText: ['mermaid', 'suggestion']` so those fences are left as raw text for
  the component override to intercept.
- **`rehype-sanitize`** — defense-in-depth with a schema extended to allow the
  `className` attributes used by hljs and the mermaid container, and to keep
  safe `img`/`a` protocols (http, https, mailto, and relative
  `/api/attachments/…`). Ordered so highlight classes survive sanitization.

### Component overrides (`components` map)

- **`code`/`pre`:** detect language class:
  - `language-mermaid` → render `<MermaidDiagram chart={rawText} />`.
  - `language-suggestion` → render **nothing** (preserves current
    CSS-hidden behavior in rendered bodies).
  - otherwise → default highlighted code block.
- **`a`:** external links get `target="_blank"` + `rel="noopener noreferrer"`.
- **`img`:** default element; existing `.markdown-body img` CSS applies.

### Mermaid

```
src/ui/components/MermaidDiagram.tsx
```

- `useEffect` renders the chart via a **dynamic `import('mermaid')`** so
  mermaid.js is only loaded when a diagram is actually present (keeps the base
  bundle lean).
- `mermaid.initialize({ securityLevel: 'strict', theme: <synced to app> })`.
- Graceful fallback: on parse error, render the raw mermaid source as a code
  block plus a small error note (so a malformed diagram never blanks the view).
- Theme is synced to the app's current light/dark mode.

## Styling

- Add the missing **GFM table CSS** under `.markdown-body` (GitHub-style:
  border-collapse, header background, cell borders, zebra rows, horizontal-scroll
  wrapper for wide tables). This is the real "tables support" gap.
- Add minimal `.markdown-body .mermaid` container styling (centered, responsive).
- Keep all existing `.markdown-body` rules unchanged (links, headings, images,
  code, blockquote, lists, suggestion-hide).

## Migration (all call sites)

Replace `dangerouslySetInnerHTML={{ __html: parseMarkdown(x) }}` with
`<Markdown content={x} className="markdown-body …" />`:

| File | Sites | Notes |
|------|-------|-------|
| `MarkdownField.tsx` | 1 | preview tab |
| `CommentForm.tsx` | 1 | keep suggestion-card split; pass full `body` to `<Markdown>` (suggestion fence renders nothing) |
| `PlanReview.tsx` | 2 | decision comment + plan body |
| `CommentTracker.tsx` | 2 | comment body + reply body |
| `PlanCommentBubble.tsx` | 2 | comment body + reply body |
| `CommentBubble.tsx` | 2 | comment body + reply body |

Then:

- Delete `parseMarkdown()` and the `marked` renderer config from
  `src/ui/utils.ts`.
- Remove the `marked` dependency from `package.json`.
- Keep `highlight.js` (still used, now via lowlight/rehype-highlight + the
  `.hljs-*` CSS). If `highlight.js` is no longer imported directly anywhere, it
  may remain only as a transitive need of styling; verify before removing.

## Data Flow

Stored/transmitted markdown is **unchanged plain text**. Server, MCP, CLI, plan
formatting, and the GitHub round-trip are unaffected. Mermaid fences degrade to
ordinary code blocks on GitHub (graceful). Suggestion fences are unchanged.

## Security

- No `dangerouslySetInnerHTML` and no `rehype-raw` → raw HTML in markdown stays
  inert (same as today, but via a robust mechanism instead of manual escaping).
- `rehype-sanitize` constrains attributes/URLs; react-markdown's `urlTransform`
  blocks dangerous protocols.
- Net result: removes 9 `dangerouslySetInnerHTML` sites and the fragile manual
  escape — strictly safer than before.

## Side-Effects Considered

- **Suggestion cards** (`CommentForm`) and **hidden suggestion blocks**
  elsewhere preserved.
- **`file://` plan links:** react-markdown's default `urlTransform` and the
  sanitize schema both strip `file:` URLs, which would have silently broken
  `PlanReview.handleMarkdownClick` (it reads `file:///…` hrefs to open in-app
  local-file previews). A custom `urlTransform` plus a sanitize-schema `href`
  protocol keep `file://` links intact; all other protocols stay sanitized.
- **GitHub line-break parity:** `remark-breaks` preserves the old
  `breaks: true` single-newline → `<br>` rendering used by `marked`.
- **`onClick` on the plan body** preserved by keeping the wrapper `<div>` and
  nesting `<Markdown>`; `handleMarkdownClick` uses `target.closest('a')`, so the
  extra wrapper element does not affect it.
- **Clipboard-image upload** untouched (it edits the textarea source string).
- **highlight.js** theming preserved (`.hljs-*` classes unchanged).
- **GitHub submission** unaffected (raw markdown source unchanged).
- **Rust TUI** is a separate renderer — out of scope, unaffected.
- **Bundle:** react-markdown + remark-gfm + rehype-* add modest weight; mermaid
  is lazy-loaded (no base-bundle cost until a diagram is rendered).

## Testing

Vitest + jsdom + `@testing-library/react` (already present). Unit tests for
`<Markdown>`:

- GFM table renders a `<table>`.
- Task list renders checkboxes.
- Fenced code gets `.hljs` highlighting and a `language-*` class.
- ` ```suggestion ` block renders nothing.
- ` ```mermaid ` block renders the mermaid container / lazy path (mocked).
- `[x](javascript:alert(1))` URL is neutralized (no `javascript:` href).
- Plain text / empty input render safely.

## Deferred

- **Video** support (local `<video>` and/or trusted embeds) — the `components`
  map + a small rehype hook make this a localized addition later.

## Implementation Order

1. Add deps (`react-markdown`, `remark-gfm`, `rehype-highlight`,
   `rehype-sanitize`, `mermaid`).
2. Build `MermaidDiagram.tsx`.
3. Build `Markdown.tsx` (pipeline + component overrides + sanitize schema).
4. Add table + mermaid CSS to `global.css`.
5. Migrate the 6 components / 9 call sites.
6. Remove `parseMarkdown` + `marked` from `utils.ts` and `package.json`.
7. Write `Markdown` unit tests.
8. Verify: `pnpm run test:ts` + `pnpm run build:ts`.
