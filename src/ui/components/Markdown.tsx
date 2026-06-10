import { isValidElement, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { MermaidDiagram } from './MermaidDiagram'

// `remark-breaks` preserves the GitHub-style single-newline -> <br> behavior the
// previous `marked` config enabled via `breaks: true`.
const REMARK_PLUGINS: Options['remarkPlugins'] = [remarkGfm, remarkBreaks]

// Extend the safe GitHub default schema to also allow `file://` hrefs — the
// plan reviewer turns clicks on those into in-app local-file previews (see
// PlanReview.handleMarkdownClick). Everything else stays at the defaults.
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), 'file', 'file-mention'],
  },
}

// Order matters. `rehype-sanitize` runs first: its default schema already
// permits the `language-*` className on <code> (which both `rehype-highlight`
// and our `pre` override rely on) while stripping anything dangerous. Highlight
// then adds `hljs` classes/spans derived from that already-sanitized text, so
// they need no further sanitizing. `plainText` keeps mermaid/suggestion fences
// as raw text (so we can read their source), and `ignoreMissing` stops highlight
// from throwing on those non-languages.
const REHYPE_PLUGINS: Options['rehypePlugins'] = [
  [rehypeSanitize, SANITIZE_SCHEMA],
  [rehypeHighlight, { ignoreMissing: true, plainText: ['mermaid', 'suggestion'] }],
]

// react-markdown's default transform drops `file:` URLs; keep them so the plan
// reviewer's local-file links survive (other protocols stay sanitized).
function urlTransform(url: string): string {
  if (url.startsWith('file://')) return url
  if (url.startsWith('file-mention://')) return url
  return defaultUrlTransform(url)
}

/**
 * Flatten a React node tree to its text content. Works whether the fenced code
 * arrived as a raw string or `rehype-highlight` wrapped it in <span> elements.
 */
function textContent(node: ReactNode): string {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textContent).join('')
  if (isValidElement(node)) {
    return textContent((node.props as { children?: ReactNode }).children)
  }
  return ''
}

function languageOf(className: unknown): string | null {
  if (typeof className !== 'string') return null
  return /language-([\w-]+)/.exec(className)?.[1] ?? null
}

const COMPONENTS: Components = {
  // Fenced code blocks arrive as <pre><code class="language-x">…</code></pre>.
  // Intercept the special languages here; everything else renders as a normal
  // highlighted block.
  pre({ children }) {
    const codeClass = isValidElement(children)
      ? (children.props as { className?: string }).className
      : undefined
    const lang = languageOf(codeClass)
    if (lang === 'mermaid') {
      return <MermaidDiagram chart={textContent(children).replace(/\n$/, '')} />
    }
    // `suggestion` fences are surfaced as a dedicated card by CommentForm and
    // hidden in read-only bodies — render nothing for them here.
    if (lang === 'suggestion') return null
    return <pre>{children}</pre>
  },
  a({ href, children }) {
    if (typeof href === 'string' && href.startsWith('file-mention://')) {
      const path = href.slice('file-mention://'.length)
      return (
        <span className="mention-file" title={path}>
          {children}
        </span>
      )
    }
    const external = typeof href === 'string' && /^https?:\/\//.test(href)
    return (
      <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    )
  },
}

export interface MarkdownProps {
  /** Raw markdown source. */
  content: string
  /** Applied to the wrapping element; pass `markdown-body` for the shared styles. */
  className?: string
}

/**
 * Render markdown to React nodes via `react-markdown`: GFM tables, task lists,
 * autolinks, syntax-highlighted code, and lazy-loaded Mermaid diagrams. Replaces
 * the former `parseMarkdown` + `dangerouslySetInnerHTML` pipeline and is safe by
 * construction — raw HTML stays inert (no `rehype-raw`) and URLs are sanitized.
 */
export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        urlTransform={urlTransform}
        components={COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
