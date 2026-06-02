import { useEffect, useId, useRef, useState } from 'react'
import { SHIKI_THEME_MAP } from '../utils'

/**
 * Map the app's active theme (a `data-theme` attribute on <html>, keyed into
 * {@link SHIKI_THEME_MAP}) to one of Mermaid's built-in themes so diagrams match
 * light/dark mode.
 */
function resolveMermaidTheme(): 'dark' | 'default' {
  if (typeof document === 'undefined') return 'dark'
  const themeName = document.documentElement.getAttribute('data-theme') || 'nord'
  const type = SHIKI_THEME_MAP[themeName]?.type ?? 'dark'
  return type === 'light' ? 'default' : 'dark'
}

/**
 * Render a Mermaid diagram from its source. `mermaid` is imported dynamically so
 * the (heavy) library only loads when a diagram is actually present, keeping the
 * base bundle lean. On a parse/render failure we fall back to showing the raw
 * source so a malformed diagram never blanks the surrounding content.
 */
export function MermaidDiagram({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  // A DOM-safe, unique id for mermaid's internal temp element (it uses the id in
  // a selector, so strip the punctuation `useId` includes).
  const renderId = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!containerRef.current) return

    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: resolveMermaidTheme(),
        })
        const { svg, bindFunctions } = await mermaid.render(renderId, chart)
        if (cancelled || !containerRef.current) return
        // Mermaid sanitizes its own SVG output (securityLevel: 'strict' runs
        // DOMPurify internally), so assigning innerHTML here is safe.
        containerRef.current.innerHTML = svg
        bindFunctions?.(containerRef.current)
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [chart, renderId])

  if (error) {
    return (
      <div className="mermaid-error">
        <div className="mermaid-error-note">Failed to render diagram: {error}</div>
        <pre>
          <code>{chart}</code>
        </pre>
      </div>
    )
  }

  return <div className="mermaid" ref={containerRef} role="img" aria-label="Mermaid diagram" />
}
