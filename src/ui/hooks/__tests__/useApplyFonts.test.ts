import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useApplyFonts } from '../useApplyFonts.js'

const LINK_ID = 'gfonts-link'
const STYLE_ID = 'diffing-fonts-override'

function cdnHref(): string {
  const link = document.getElementById(LINK_ID) as HTMLLinkElement | null
  return link?.getAttribute('href') ?? ''
}

function overrideCss(): string {
  return document.getElementById(STYLE_ID)?.innerHTML ?? ''
}

afterEach(() => {
  cleanup()
  for (const id of [LINK_ID, STYLE_ID, 'gfonts-preconnect', 'gfonts-preconnect-static']) {
    document.getElementById(id)?.remove()
  }
})

describe('useApplyFonts', () => {
  it('loads a selected custom mono font from the Google Fonts CDN', () => {
    // Regression: picking "Fira Code" used to skip the CDN entirely (needsMonoCDN = !monoFont),
    // so the family was named in CSS but no @font-face was ever fetched -> silent fallback.
    renderHook(() => useApplyFonts(true, null, 'Fira Code'))
    expect(cdnHref()).toContain('Fira+Code')
  })

  it('loads a selected custom ui font from the Google Fonts CDN', () => {
    renderHook(() => useApplyFonts(true, 'Source Code Pro', null))
    expect(cdnHref()).toContain('Source+Code+Pro')
  })

  it('still loads the built-in defaults when no override is set', () => {
    renderHook(() => useApplyFonts(true, null, null))
    const href = cdnHref()
    expect(href).toContain('Geist+Mono')
    expect(href).toContain('JetBrains+Mono')
  })

  it('requests both selected families in a single request', () => {
    renderHook(() => useApplyFonts(true, 'Inconsolata', 'Fira Code'))
    const href = cdnHref()
    expect(href).toContain('Inconsolata')
    expect(href).toContain('Fira+Code')
  })

  it('still writes the --font-mono override so the family is applied', () => {
    renderHook(() => useApplyFonts(true, null, 'Fira Code'))
    expect(overrideCss()).toContain('"Fira Code"')
  })

  it('does nothing until settings are hydrated', () => {
    renderHook(() => useApplyFonts(false, null, 'Fira Code'))
    expect(document.getElementById(LINK_ID)).toBeNull()
  })

  it('treats a whitespace-only font as default and never emits an empty family= token', () => {
    // An empty family= token makes Google Fonts 400 the WHOLE request, which would
    // also drop the sibling default font's @font-face.
    renderHook(() => useApplyFonts(true, null, '   '))
    const href = cdnHref()
    expect(href).not.toContain('family=&')
    expect(href).not.toMatch(/family=$/)
    expect(href).toContain('JetBrains+Mono')
  })

  it('encodes spaces in family names as + (never %20)', () => {
    // Guards the .replace(/%20/g,'+') against a future bare-encodeURIComponent refactor.
    renderHook(() => useApplyFonts(true, null, 'Fira Code'))
    expect(cdnHref()).not.toContain('%20')
  })

  it('updates the request when the selected font changes (live picker flow)', () => {
    const { rerender } = renderHook(({ mono }) => useApplyFonts(true, null, mono), {
      initialProps: { mono: 'Fira Code' as string | null },
    })
    expect(cdnHref()).toContain('Fira+Code')

    rerender({ mono: 'Inconsolata' })
    expect(cdnHref()).toContain('Inconsolata')
    expect(cdnHref()).not.toContain('Fira+Code')
  })

  it('requests a single family when the ui and mono fonts are identical', () => {
    renderHook(() => useApplyFonts(true, 'Fira Code', 'Fira Code'))
    const segments = cdnHref().match(/family=/g) ?? []
    expect(segments).toHaveLength(1)
  })
})
