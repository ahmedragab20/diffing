import { memo, useEffect, useId, useRef, useState } from 'react'
import { SHIKI_THEME_MAP } from '../utils'

/**
 * Map the app's active theme (a `data-theme` attribute on <html>, keyed into
 * {@link SHIKI_THEME_MAP}) to one of Mermaid's built-in themes so diagrams match
 * light/dark mode.
 */
function resolveMermaidTheme(): 'dark' | 'default' {
  if (typeof document === 'undefined') return 'dark'
  const themeName = document.documentElement.getAttribute('data-theme') || 'rose-pine'
  const type = SHIKI_THEME_MAP[themeName]?.type ?? 'dark'
  return type === 'light' ? 'default' : 'dark'
}

/**
 * Render a Mermaid diagram from its source. `mermaid` is imported dynamically so
 * the (heavy) library only loads when a diagram is actually present, keeping the
 * base bundle lean. On a parse/render failure we fall back to showing the raw
 * source so a malformed diagram never blanks the surrounding content.
 *
 * Memoized so parent re-renders (e.g. plan selection → Add comment) do not
 * remount and flash an empty container while `mermaid.render` re-runs.
 */
export const MermaidDiagram = memo(function MermaidDiagram({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  // A DOM-safe, unique id for mermaid's internal temp element (it uses the id in
  // a selector, so strip the punctuation `useId` includes).
  const renderId = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const [error, setError] = useState<string | null>(null)
  // Keep the last good SVG in React state so a rare remount still paints
  // immediately instead of flashing an empty div while render re-runs.
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: resolveMermaidTheme(),
        })
        const { svg: nextSvg, bindFunctions } = await mermaid.render(renderId, chart)
        if (cancelled) return
        // Mermaid sanitizes its own SVG output (securityLevel: 'strict' runs
        // DOMPurify internally), so assigning innerHTML here is safe.
        setSvg(nextSvg)
        setError(null)
        // bindFunctions needs the live DOM node after React commits the SVG.
        requestAnimationFrame(() => {
          if (cancelled || !containerRef.current) return
          bindFunctions?.(containerRef.current)
        })
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

  return (
    <div
      className="mermaid"
      ref={containerRef}
      role="img"
      aria-label="Mermaid diagram"
      // Mermaid SVG is trusted (strict + DOMPurify); keep last paint across remounts.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  )
})
