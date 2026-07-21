// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useFileMention } from '../useFileMention'

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function W({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

/**
 * Build a detached textarea wired to the hook so we can drive selectionStart /
 * scrollTop and dispatch raw events to exercise the caret/scroll repositioning
 * logic that the fix introduced.
 */
function mountTextarea(): HTMLTextAreaElement {
  const ta = document.createElement('textarea')
  document.body.appendChild(ta)
  return ta
}

describe('useFileMention — dropdown positioning', () => {
  let realGCS: typeof window.getComputedStyle

  beforeEach(() => {
    realGCS = window.getComputedStyle.bind(window)
    // Deterministic geometry so cursorTop is a pure function of the inputs.
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => ({
      ...(realGCS(el) as object),
      lineHeight: '21px',
      fontSize: '14px',
      paddingTop: '12px',
    }) as unknown as CSSStyleDeclaration)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [{ path: 'src/a.ts' }] }),
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  function setup(text: string) {
    const setText = vi.fn()
    const { result } = renderHook(({ t }) => useFileMention(t, setText), {
      initialProps: { t: text },
      wrapper: wrapper(),
    })
    const ta = mountTextarea()
    ta.value = text
    ta.selectionStart = ta.selectionEnd = text.length
    // Wire the textarea in; this binds the scroll/select/click listeners.
    act(() => {
      result.current.setTextareaRef(ta)
    })
    return { result, ta, setText }
  }

  /** Deterministically invoke the hook's inner recompute via a bound listener. */
  function recompute(ta: HTMLTextAreaElement) {
    act(() => {
      ta.dispatchEvent(new Event('click'))
    })
  }

  it('positions the dropdown under the caret on the first line', () => {
    const { result, ta } = setup('@f')
    recompute(ta)
    // caret at end (line 0): paddingTop(12) + (0+1)*21 - scrollTop(0) + 4 = 37
    expect(result.current.cursorTop).toBe(37)
    expect(result.current.isOpen).toBe(true)
  })

  it('compensates for textarea scrollTop so the dropdown tracks the visible caret', () => {
    const { result, ta } = setup('@f')
    recompute(ta)
    const topUnscrolled = result.current.cursorTop

    ta.scrollTop = 50
    act(() => {
      ta.dispatchEvent(new Event('scroll'))
    })
    const topScrolled = result.current.cursorTop

    // Exact delta: scrolling 50px must lower the dropdown by exactly 50px.
    expect(topScrolled).toBe(topUnscrolled - 50)
  })

  it('falls back to fontSize*1.5 when computed lineHeight is non-numeric', () => {
    vi.mocked(window.getComputedStyle).mockImplementation((el: Element) => ({
      ...(realGCS(el) as object),
      lineHeight: 'normal',
      fontSize: '14px',
      paddingTop: '0px',
    }) as unknown as CSSStyleDeclaration)

    const { result, ta } = setup('@f')
    recompute(ta)
    // caret at end (line 0): 0 + (0+1)*(14*1.5) - 0 + 4 = 25
    // (the old code used a hardcoded 20 fallback here → would have been 24)
    expect(result.current.cursorTop).toBe(25)
  })

  it('reopens the mention when the caret returns to the @query without a text change', () => {
    const { result, ta } = setup('@foo')
    recompute(ta)
    expect(result.current.isOpen).toBe(true)

    // Move the caret before the @ (same text, only caret moved): mention must close.
    ta.selectionStart = ta.selectionEnd = 0
    recompute(ta)
    expect(result.current.isOpen).toBe(false)

    // Move the caret back into the @query (still no text change): the caret
    // listener must reopen the mention — the old code only recomputed on text
    // changes, so this would have stayed closed.
    ta.selectionStart = ta.selectionEnd = 4
    recompute(ta)
    expect(result.current.isOpen).toBe(true)
  })
})