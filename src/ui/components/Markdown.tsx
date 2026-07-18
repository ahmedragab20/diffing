import { isValidElement, useState, useCallback, type ReactNode } from 'react'
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
// Heading ids are allowed so the TOC can deep-link into the rendered body.
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), 'file', 'file-mention'],
  },
  attributes: {
    ...defaultSchema.attributes,
    h1: [...(defaultSchema.attributes?.h1 ?? []), 'id'],
    h2: [...(defaultSchema.attributes?.h2 ?? []), 'id'],
    h3: [...(defaultSchema.attributes?.h3 ?? []), 'id'],
    h4: [...(defaultSchema.attributes?.h4 ?? []), 'id'],
    h5: [...(defaultSchema.attributes?.h5 ?? []), 'id'],
    h6: [...(defaultSchema.attributes?.h6 ?? []), 'id'],
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

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[`*_~[\]()#.!?,:'"]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'section'
}

function CodeBlock({
  language,
  codeText,
  children,
}: {
  language: string | null
  codeText: string
  children: ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(codeText).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1400)
      },
      () => {},
    )
  }, [codeText])

  return (
    <div className="md-code-block">
      <div className="md-code-toolbar">
        <span className="md-code-lang">{language || 'code'}</span>
        <button type="button" className="md-code-copy" onClick={onCopy} aria-label="Copy code">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {/* Keep highlighted children from rehype-highlight */}
      <pre>{children}</pre>
    </div>
  )
}

function makeComponents(headingIds: Map<string, number>): Components {
  return {
    pre({ children }) {
      const codeClass = isValidElement(children)
        ? (children.props as { className?: string }).className
        : undefined
      const lang = languageOf(codeClass)
      if (lang === 'mermaid') {
        return <MermaidDiagram chart={textContent(children).replace(/\n$/, '')} />
      }
      if (lang === 'suggestion') return null
      const codeText = textContent(children).replace(/\n$/, '')
      return (
        <CodeBlock language={lang} codeText={codeText}>
          {children}
        </CodeBlock>
      )
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
    h1: heading('h1', headingIds),
    h2: heading('h2', headingIds),
    h3: heading('h3', headingIds),
    h4: heading('h4', headingIds),
    h5: heading('h5', headingIds),
    h6: heading('h6', headingIds),
  }
}

function heading(
  Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6',
  used: Map<string, number>,
): Components['h1'] {
  return function Heading({ children, ...props }) {
    const text = textContent(children)
    let id = slugifyHeading(text)
    const n = used.get(id) ?? 0
    used.set(id, n + 1)
    if (n > 0) id = `${id}-${n + 1}`
    return (
      <Tag id={id} className="md-heading" {...props}>
        <a href={`#${id}`} className="md-heading-anchor" aria-label={`Link to ${text}`}>
          #
        </a>
        {children}
      </Tag>
    )
  }
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
 *
 * Plan-viewer extras: per-code-block Copy, heading ids + `#` anchors for TOC.
 */
export function Markdown({ content, className }: MarkdownProps) {
  // Fresh collision map per render so heading ids stay stable for a given body.
  const headingIds = new Map<string, number>()
  const components = makeComponents(headingIds)

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        urlTransform={urlTransform}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
