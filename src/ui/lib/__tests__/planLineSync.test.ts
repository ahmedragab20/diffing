import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  lineNumberFromOffset,
  findRangeForLine,
  lineProgressInRange,
  scrollTopToFaceInContainer,
  isFacePointInView,
  faceReadToSourceLine,
} from '../planLineSync.js'

describe('lineNumberFromOffset', () => {
  it('returns 1 for empty text or offset 0', () => {
    expect(lineNumberFromOffset('', 0)).toBe(1)
    expect(lineNumberFromOffset('hello', 0)).toBe(1)
  })

  it('counts newlines before the caret', () => {
    const text = 'a\nb\nc'
    expect(lineNumberFromOffset(text, 0)).toBe(1)
    expect(lineNumberFromOffset(text, 1)).toBe(1) // after 'a'
    expect(lineNumberFromOffset(text, 2)).toBe(2) // after '\n'
    expect(lineNumberFromOffset(text, text.length)).toBe(3)
  })
})

describe('findRangeForLine', () => {
  const ranges = [
    { startLine: 1, endLine: 3 },
    { startLine: 4, endLine: 10 },
    { startLine: 11, endLine: 12 },
  ]

  it('returns the containing range', () => {
    expect(findRangeForLine(ranges, 2)).toEqual({ startLine: 1, endLine: 3 })
    expect(findRangeForLine(ranges, 10)).toEqual({ startLine: 4, endLine: 10 })
  })

  it('returns nearest when outside', () => {
    expect(findRangeForLine(ranges, 100)?.startLine).toBe(11)
  })

  it('returns null for empty ranges or invalid line', () => {
    expect(findRangeForLine([], 1)).toBeNull()
    expect(findRangeForLine(ranges, 0)).toBeNull()
  })
})

describe('lineProgressInRange', () => {
  it('is 0 for single-line ranges', () => {
    expect(lineProgressInRange({ startLine: 5, endLine: 5 }, 5)).toBe(0)
  })

  it('interpolates within multi-line ranges', () => {
    expect(lineProgressInRange({ startLine: 1, endLine: 5 }, 1)).toBe(0)
    expect(lineProgressInRange({ startLine: 1, endLine: 5 }, 5)).toBe(1)
    expect(lineProgressInRange({ startLine: 1, endLine: 5 }, 3)).toBeCloseTo(0.5)
  })
})

describe('scrollTopToFaceInContainer', () => {
  it('computes container scrollTop from relative geometry', () => {
    const container = {
      getBoundingClientRect: () => ({ top: 100, height: 400 }),
      scrollTop: 50,
    } as HTMLElement
    const el = {
      getBoundingClientRect: () => ({ top: 200, height: 200 }),
    } as HTMLElement
    // point = (200-100) + 50 + 100 = 250; anchor 40 → 210
    expect(scrollTopToFaceInContainer(container, el, 0.5, 40)).toBe(210)
  })
})

describe('isFacePointInView', () => {
  it('is true when the face point sits inside the container with margin', () => {
    const container = {
      getBoundingClientRect: () => ({ top: 0, bottom: 400, height: 400 }),
    } as HTMLElement
    const el = {
      getBoundingClientRect: () => ({ top: 100, height: 50 }),
    } as HTMLElement
    expect(isFacePointInView(container, el, 0, 48)).toBe(true)
  })

  it('is false when the face point is above the container margin', () => {
    const container = {
      getBoundingClientRect: () => ({ top: 0, bottom: 400, height: 400 }),
    } as HTMLElement
    const el = {
      getBoundingClientRect: () => ({ top: -20, height: 20 }),
    } as HTMLElement
    expect(isFacePointInView(container, el, 0, 48)).toBe(false)
  })
})

describe('faceReadToSourceLine', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('scrolls only the provided pane, never window', () => {
    const pane = document.createElement('div')
    pane.className = 'plan-rendered-layout'
    Object.defineProperty(pane, 'clientHeight', { value: 200, configurable: true })
    Object.defineProperty(pane, 'scrollHeight', { value: 800, configurable: true })
    pane.scrollTop = 0

    const seg = document.createElement('div')
    seg.setAttribute('data-plan-source-start', '10')
    seg.setAttribute('data-plan-source-end', '20')
    pane.appendChild(seg)
    document.body.appendChild(pane)

    // Geometry: pane at y=0, segment far below → needs scroll
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 200,
      height: 200,
      left: 0,
      right: 100,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    vi.spyOn(seg, 'getBoundingClientRect').mockReturnValue({
      top: 500,
      bottom: 600,
      height: 100,
      left: 0,
      right: 100,
      width: 100,
      x: 0,
      y: 500,
      toJSON: () => ({}),
    })

    const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

    const did = faceReadToSourceLine(pane, 15, {
      scrollContainer: pane,
      onlyIfOutOfView: true,
      anchorY: 40,
    })
    expect(did).toBe(true)
    expect(pane.scrollTop).toBeGreaterThan(0)
    expect(windowScroll).not.toHaveBeenCalled()
  })

  it('refuses to scroll documentElement even if passed as container', () => {
    const root = document.createElement('div')
    const seg = document.createElement('div')
    seg.setAttribute('data-plan-source-start', '1')
    seg.setAttribute('data-plan-source-end', '5')
    root.appendChild(seg)
    document.body.appendChild(root)

    const did = faceReadToSourceLine(root, 1, {
      scrollContainer: document.documentElement,
    })
    expect(did).toBe(false)
  })
})
