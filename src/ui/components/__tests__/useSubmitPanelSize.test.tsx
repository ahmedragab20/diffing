// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSubmitPanelSize, SUBMIT_PANEL_SIZE_KEY, SUBMIT_PANEL_WIDTH_KEY, SUBMIT_PANEL_MIN, SUBMIT_PANEL_MAX, SUBMIT_PANEL_MIN_WIDTH, SUBMIT_PANEL_MAX_WIDTH, SUBMIT_PANEL_PRESETS } from '../../hooks/useSubmitPanelSize'

const mockGet = vi.fn()
const mockSet = vi.fn()

vi.mock('../../utils/uiState', () => ({
  getUiStateItem: (...args: any[]) => mockGet(...args),
  setUiStateItem: (...args: any[]) => mockSet(...args),
}))

let rafCb: (() => void) | null = null
let sharedDiv: HTMLDivElement

beforeAll(() => {
  // Create element outside fake timers scope
  sharedDiv = document.createElement('div')
})

beforeEach(() => {
  mockGet.mockReset()
  mockSet.mockReset()
  rafCb = null
  vi.useFakeTimers()
  globalThis.requestAnimationFrame = vi.fn((cb: () => void) => {
    rafCb = cb
    return 1
  }) as any
  globalThis.cancelAnimationFrame = vi.fn() as any
})

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as any).requestAnimationFrame
  delete (globalThis as any).cancelAnimationFrame
})

describe('useSubmitPanelSize', () => {
  it('returns default 480 when no stored value', () => {
    mockGet.mockReturnValue(null)
    const { result } = renderHook(() => useSubmitPanelSize())
    expect(result.current.height).toBe(480)
  })

  it('loads stored value', () => {
    mockGet.mockReturnValue('600')
    const { result } = renderHook(() => useSubmitPanelSize())
    expect(result.current.height).toBe(600)
  })

  it('clamps stored value above max', () => {
    mockGet.mockReturnValue('9999')
    const { result } = renderHook(() => useSubmitPanelSize())
    expect(result.current.height).toBe(SUBMIT_PANEL_MAX)
  })

  it('clamps stored value below min', () => {
    mockGet.mockReturnValue('10')
    const { result } = renderHook(() => useSubmitPanelSize())
    expect(result.current.height).toBe(SUBMIT_PANEL_MIN)
  })

  it('returns default for NaN stored value', () => {
    mockGet.mockReturnValue('abc')
    const { result } = renderHook(() => useSubmitPanelSize())
    expect(result.current.height).toBe(480)
  })

  it('applyPreset updates height and persists', () => {
    mockGet.mockReturnValue(null)
    const { result } = renderHook(() => useSubmitPanelSize())
    act(() => { result.current.applyPreset(SUBMIT_PANEL_PRESETS[2]!) }) // L = 560×560
    expect(result.current.height).toBe(560)
    expect(result.current.width).toBe(560)
    expect(mockSet).toHaveBeenCalledWith(SUBMIT_PANEL_SIZE_KEY, '560')
    expect(mockSet).toHaveBeenCalledWith(SUBMIT_PANEL_WIDTH_KEY, '560')
  })

  it('activePreset returns correct index', () => {
    mockGet.mockReturnValue(null)
    const { result } = renderHook(() => useSubmitPanelSize())
    // Default (520,480) matches no preset
    expect(result.current.activePreset).toBe(-1)
    act(() => result.current.applyPreset(SUBMIT_PANEL_PRESETS[0]!)) // S
    expect(result.current.activePreset).toBe(0)
    act(() => result.current.applyPreset(SUBMIT_PANEL_PRESETS[1]!)) // M
    expect(result.current.activePreset).toBe(1)
    act(() => result.current.applyPreset(SUBMIT_PANEL_PRESETS[3]!)) // XL
    expect(result.current.activePreset).toBe(3)
    // Width-only match should not highlight
    act(() => result.current.applyPreset({ label:'X', width: 520, height: 500 } as any))
    expect(result.current.activePreset).toBe(-1)
  })

  it('popoverStyle contains CSS var', () => {
    mockGet.mockReturnValue(null)
    const { result } = renderHook(() => useSubmitPanelSize())
    const style = result.current.popoverStyle as Record<string, string>
    expect(style['--submit-panel-height']).toBe('480px')
    act(() => { result.current.applyPreset(SUBMIT_PANEL_PRESETS[0]!) })
    const style2 = result.current.popoverStyle as Record<string, string>
    expect(style2['--submit-panel-height']).toBe('340px')
    expect(style2['--submit-panel-width']).toBe('420px')
  })

  it('applyPreset clamps out-of-bounds components to within min/max', () => {
    mockGet.mockReturnValue(null)
    const { result } = renderHook(() => useSubmitPanelSize())
    act(() => { result.current.applyPreset({ label:'Huge', width: 9999, height: 9999 } as any) })
    expect(result.current.width).toBe(SUBMIT_PANEL_MAX_WIDTH)
    expect(result.current.height).toBe(SUBMIT_PANEL_MAX)
    expect(mockSet).toHaveBeenCalledWith(SUBMIT_PANEL_WIDTH_KEY, '720')
    expect(mockSet).toHaveBeenCalledWith(SUBMIT_PANEL_SIZE_KEY, '760')
  })

  it('startResize registers and cleans up drag listeners', () => {
    mockGet.mockReturnValue(null)
    const { result } = renderHook(() => useSubmitPanelSize())
    const styleStore: Record<string, string> = {}
const div = { style: { setProperty: (prop: string, val: string) => { styleStore[prop] = val }, getPropertyValue: (prop: string) => styleStore[prop] ?? '' } } as unknown as HTMLDivElement
    // Attach ref
    (result.current.panelRef as any).current = div

    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')

    const mouseDownEvent = new MouseEvent('mousedown', { clientY: 400 })
    act(() => {
      result.current.startResize(mouseDownEvent as any)
    })

    expect(addSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(addSpy).toHaveBeenCalledWith('mouseup', expect.any(Function))

    // Simulate mousemove (drag DOWN → increase height)
    const moveHandler = addSpy.mock.calls.find(c => c[0] === 'mousemove')![1] as any
    act(() => {
      moveHandler(new MouseEvent('mousemove', { clientY: 500 }))
    })

    // rAF should have been scheduled
    expect(globalThis.requestAnimationFrame).toHaveBeenCalled()
    // Flush rAF
    if (rafCb) act(() => rafCb())
    // Height should increase: clientY(500) - startY(400) = 100, default 480 + 100 = 580
    expect(div.style.getPropertyValue('--submit-panel-height')).toBe('580px')

    // Simulate mouseup
    const upHandler = addSpy.mock.calls.find(c => c[0] === 'mouseup')![1] as any
    act(() => {
      upHandler(new MouseEvent('mouseup'))
    })

    expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('mouseup', expect.any(Function))
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')

    addSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('returns default width 520 when no stored value', () => {
    mockGet.mockReturnValue(null)
    const { result } = renderHook(() => useSubmitPanelSize())
    expect(result.current.width).toBe(520)
  })

  it('clamps stored width above max', () => {
    mockGet.mockImplementation((key: string) => (key === SUBMIT_PANEL_WIDTH_KEY ? '9999' : null))
    const { result } = renderHook(() => useSubmitPanelSize())
    expect(result.current.width).toBe(SUBMIT_PANEL_MAX_WIDTH)
  })

  it('clamps stored width below min', () => {
    mockGet.mockImplementation((key: string) => (key === SUBMIT_PANEL_WIDTH_KEY ? '10' : null))
    const { result } = renderHook(() => useSubmitPanelSize())
    expect(result.current.width).toBe(SUBMIT_PANEL_MIN_WIDTH)
  })

  it('popoverStyle contains --submit-panel-width CSS var', () => {
    mockGet.mockReturnValue(null)
    const { result } = renderHook(() => useSubmitPanelSize())
    const style = result.current.popoverStyle as Record<string, string>
    expect(style['--submit-panel-width']).toBe('520px')
    expect(style['--submit-panel-height']).toBe('480px')
  })

  it('startLeftResize registers and cleans up drag listeners', () => {
    mockGet.mockReturnValue(null)
    const { result } = renderHook(() => useSubmitPanelSize())
    const leftStyleStore: Record<string, string> = {}
const div = { style: { setProperty: (prop: string, val: string) => { leftStyleStore[prop] = val }, getPropertyValue: (prop: string) => leftStyleStore[prop] ?? '' } } as unknown as HTMLDivElement
    // Attach ref
    (result.current.panelRef as any).current = div

    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')

    const mouseDownEvent = new MouseEvent('mousedown', { clientX: 400 })
    act(() => {
      result.current.startLeftResize(mouseDownEvent as any)
    })

    expect(addSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(addSpy).toHaveBeenCalledWith('mouseup', expect.any(Function))
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')

    // Simulate mousemove (drag LEFT → increase width)
    const moveHandler = addSpy.mock.calls.find(c => c[0] === 'mousemove')![1] as any
    act(() => {
      moveHandler(new MouseEvent('mousemove', { clientX: 300 }))
    })

    // rAF should have been scheduled
    expect(globalThis.requestAnimationFrame).toHaveBeenCalled()
    // Flush rAF
    if (rafCb) act(() => rafCb())
    // Width should increase: startX(400) - clientX(300) = 100, default 520 + 100 = 620
    expect(div.style.getPropertyValue('--submit-panel-width')).toBe('620px')

    // Simulate mouseup
    const upHandler = addSpy.mock.calls.find(c => c[0] === 'mouseup')![1] as any
    act(() => {
      upHandler(new MouseEvent('mouseup'))
    })

    expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('mouseup', expect.any(Function))
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(mockSet).toHaveBeenCalledWith(SUBMIT_PANEL_WIDTH_KEY, '620')

    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
