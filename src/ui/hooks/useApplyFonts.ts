import { useEffect } from 'react'

export function useApplyFonts(loaded: boolean, uiFont?: string | null, monoFont?: string | null) {
  useEffect(() => {
    const fallback = ', ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

    // Wait until settings are hydrated from the server before deciding.
    if (!loaded) return

    const needsUiCDN = !uiFont
    const needsMonoCDN = !monoFont

    // Inject Google Fonts CDN links only for fonts not overridden by the user.
    const PRECONNECT_ID = 'gfonts-preconnect'
    const PRECONNECT_STATIC_ID = 'gfonts-preconnect-static'
    const LINK_ID = 'gfonts-link'
    const STYLE_ID = 'diffing-fonts-override'

    const ensurePreconnect = () => {
      if (!document.getElementById(PRECONNECT_ID)) {
        const a = document.createElement('link')
        a.id = PRECONNECT_ID
        a.rel = 'preconnect'
        a.href = 'https://fonts.googleapis.com'
        document.head.appendChild(a)
      }
      if (!document.getElementById(PRECONNECT_STATIC_ID)) {
        const b = document.createElement('link')
        b.id = PRECONNECT_STATIC_ID
        b.rel = 'preconnect'
        b.href = 'https://fonts.gstatic.com'
        b.crossOrigin = 'anonymous'
        document.head.appendChild(b)
      }
    }

    const removePreconnect = () => {
      document.getElementById(PRECONNECT_ID)?.remove()
      document.getElementById(PRECONNECT_STATIC_ID)?.remove()
    }

    if (needsUiCDN || needsMonoCDN) {
      ensurePreconnect()
      const families: string[] = []
      if (needsUiCDN) families.push('Geist+Mono:ital,wght@0,100..900;1,100..900')
      if (needsMonoCDN) families.push('JetBrains+Mono:ital,wght@0,100..800;1,100..800')
      const href = `https://fonts.googleapis.com/css2?family=${families.join('&family=')}&display=swap`
      let link = document.getElementById(LINK_ID) as HTMLLinkElement | null
      if (!link) {
        link = document.createElement('link')
        link.id = LINK_ID
        link.rel = 'stylesheet'
        document.head.appendChild(link)
      }
      if (link.href !== href) link.href = href
    } else {
      document.getElementById(LINK_ID)?.remove()
      removePreconnect()
    }

    // Dynamic style tag override for absolute font property guarantees
    let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = STYLE_ID
      document.head.appendChild(styleEl)
    }

    const uiFontVal = uiFont ? `"${uiFont}"` : '"Geist Mono"'
    const monoFontVal = monoFont ? `"${monoFont}"` : '"JetBrains Mono"'

    styleEl.innerHTML = `
      :root {
        --font-sans: ${uiFontVal}${fallback} !important;
        --font-mono: ${monoFontVal}${fallback} !important;
      }
    `

    return () => {
      styleEl?.remove()
    }
  }, [loaded, uiFont, monoFont])
}
