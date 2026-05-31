import { useEffect } from 'react'

export function useApplyFonts(loaded: boolean, uiFont?: string | null, monoFont?: string | null) {
  useEffect(() => {
    const fallback = ', ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

    // Wait until settings are hydrated from the server before deciding.
    if (!loaded) return

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

    // Encode a family name for the css2 `family=` param ("Fira Code" -> "Fira+Code").
    const encodeFamily = (name: string) => encodeURIComponent(name.trim()).replace(/%20/g, '+')

    // Request EVERY active family from Google Fonts — including user-selected
    // ones. A custom family that is only NAMED in CSS (with no matching
    // @font-face, and no local install the browser is willing to honour)
    // silently falls back to system monospace, which is most visible in code
    // diffs.
    //
    // Google Fonts ignores unknown families as long as the request contains at
    // least one valid family, so a family it does not host (e.g. a Nerd Font,
    // or the commercial "Dank Mono") is dropped server-side without breaking
    // the valid families in the same request. Such local-only fonts can render
    // only when (a) they are installed on the machine AND (b) the browser lets
    // pages use local fonts. Privacy browsers — notably Brave with Shields /
    // "Block fingerprinting" on — refuse to render uncommon local fonts as an
    // anti-fingerprinting measure, so there is nothing we can load for them and
    // they fall back. (See the README "A note on custom fonts" section.)
    //
    // Built-in defaults keep their full variable-axis spec; custom fonts are
    // requested by family name only since we can't know their available axes
    // (an unsupported axis would 400 the whole request).
    const uiSpec = uiFont?.trim() ? encodeFamily(uiFont) : 'Geist+Mono:ital,wght@0,100..900;1,100..900'
    const monoSpec = monoFont?.trim() ? encodeFamily(monoFont) : 'JetBrains+Mono:ital,wght@0,100..800;1,100..800'
    const families = [...new Set([uiSpec, monoSpec].filter(Boolean))]

    ensurePreconnect()
    const href = `https://fonts.googleapis.com/css2?family=${families.join('&family=')}&display=swap`
    let link = document.getElementById(LINK_ID) as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      link.id = LINK_ID
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    if (link.getAttribute('href') !== href) {
      link.setAttribute('href', href)
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
