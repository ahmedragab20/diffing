// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { EditMarker } from '../editMarkers.js'
import { computeEditMarkers } from '../editMarkers.js'

const SOURCE = 'diffing'

function bySeverity(markers: EditMarker[], severity: EditMarker['severity']) {
  return markers.filter((m) => m.severity === severity)
}

describe('computeEditMarkers', () => {
  it('returns no markers for a clean file ending with a newline', () => {
    expect(computeEditMarkers('const x = 1;\n', 'file.ts')).toEqual([])
  })

  it('returns no markers for an empty string', () => {
    expect(computeEditMarkers('', 'file.ts')).toEqual([])
  })

  it('flags trailing whitespace as a warning over the trailing spaces', () => {
    const markers = computeEditMarkers('const x = 1;  \n', 'file.ts')
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({
      severity: 'warning',
      message: 'Trailing whitespace',
      source: SOURCE,
      start: { line: 0, character: 12 },
      end: { line: 0, character: 14 },
    })
  })

  it('flags a missing final newline as an error on the last line', () => {
    const markers = computeEditMarkers('line one', 'file.ts')
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({
      severity: 'error',
      message: 'File does not end with a newline',
      source: SOURCE,
      start: { line: 0, character: 7 },
      end: { line: 0, character: 8 },
    })
  })

  it('flags missing final newline only on the last line of a multi-line file', () => {
    const markers = computeEditMarkers('a\nb', 'file.ts')
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({
      severity: 'error',
      start: { line: 1, character: 0 },
      end: { line: 1, character: 1 },
    })
  })

  it('reports CRLF as info without a false trailing-whitespace warning', () => {
    const markers = computeEditMarkers('a\r\n', 'file.ts')
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({
      severity: 'info',
      message: 'CRLF line ending (the saved file will keep what the editor writes)',
      source: SOURCE,
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    })
  })

  it('flags tab indentation as a hint at character 0..1', () => {
    const markers = computeEditMarkers('\tcode()\n', 'file.ts')
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({
      severity: 'hint',
      message: 'Tab character used for indentation',
      source: SOURCE,
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    })
  })

  it('reports both a hint and a warning when a line combines tab indent and trailing whitespace', () => {
    const markers = computeEditMarkers('\tfoo  \n', 'file.ts')
    expect(bySeverity(markers, 'hint')).toHaveLength(1)
    expect(bySeverity(markers, 'warning')).toHaveLength(1)
    expect(bySeverity(markers, 'hint')[0]).toMatchObject({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    })
    expect(bySeverity(markers, 'warning')[0]).toMatchObject({
      message: 'Trailing whitespace',
      start: { line: 0, character: 4 },
      end: { line: 0, character: 6 },
    })
  })

  it('warns on trailing whitespace in the last real line without a missing-final-newline error', () => {
    const markers = computeEditMarkers('x  \n', 'file.ts')
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({
      severity: 'warning',
      message: 'Trailing whitespace',
      start: { line: 0, character: 1 },
      end: { line: 0, character: 3 },
    })
  })

  it('places distinct markers on the correct lines of a multi-line file', () => {
    const markers = computeEditMarkers('ok\nbad \t\nfinal', 'file.ts')
    expect(markers).toHaveLength(2)
    const warning = bySeverity(markers, 'warning')
    const error = bySeverity(markers, 'error')
    expect(warning).toHaveLength(1)
    expect(error).toHaveLength(1)
    expect(warning[0]).toMatchObject({
      message: 'Trailing whitespace',
      start: { line: 1, character: 3 },
      end: { line: 1, character: 5 },
    })
    expect(error[0]).toMatchObject({
      message: 'File does not end with a newline',
      start: { line: 2, character: 4 },
      end: { line: 2, character: 5 },
    })
  })
})