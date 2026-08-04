/**
 * Built-in diagnostic markers for the in-place edit surface (P1 v1).
 *
 * These run purely client-side on the edited document — no language server
 * required. The user opts in via the `editDiagnostics` setting; markers are
 * computed on attach and after each change (debounced by the caller).
 *
 * Marker positions are zero-based (line + character), matching the
 * @pierre/diffs Editor.setMarkers contract.
 */

export interface EditMarker {
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  source: string
  start: { line: number; character: number }
  end: { line: number; character: number }
}

/**
 * Start position for a line-end marker, extended back to the beginning of the
 * last non-whitespace run ("word").
 *
 * The editor's hover popover only triggers when the hovered character is a
 * TOKEN START inside the marker range. Trailing whitespace / the final CR is
 * usually merged into the preceding token, so a range covering only the
 * whitespace can never pop — the token's start lies far to the left. Covering
 * the last word puts a real token start (e.g. the identifier or number after
 * punctuation) inside the range in the common case, so hovering that word
 * shows the message. The squiggle grows by at most one word, which reads as
 * "this segment ends badly" — an acceptable trade for working hovers.
 */
function lineEndMarkerStart(line: string, fromIndex: number): number {
  let runStart = fromIndex
  while (runStart > 0 && !/[ \t]/.test(line[runStart - 1])) runStart--
  return runStart
}

/** Marker severity for each check. Keep hints under errors so the user can tell them apart. */
const TRAILING_WS_SEVERITY = 'warning'
const FINAL_NEWLINE_SEVERITY = 'error'
const CRLF_SEVERITY = 'info'
const TAB_IN_INDENT_SEVERITY = 'hint'

/**
 * Compute built-in markers for a document.
 *
 * - trailing whitespace on any line
 * - missing final newline
 * - CRLF line endings (info; the review writes whatever the editor produces)
 * - tabs used for indentation (hint; consistent with most diffing defaults)
 */
export function computeEditMarkers(content: string, _filePath: string): EditMarker[] {
  const markers: EditMarker[] = []
  const lines = content.split('\n')
  // A file whose last line has no trailing newline still yields a final
  // non-empty element; a file ending with \n yields a trailing '' element.
  const endsWithNewline = content.endsWith('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.endsWith('\r')) {
      // CRLF: report once per line as info (short range over the \r).
      const text = line.slice(0, -1)
      markers.push({
        severity: CRLF_SEVERITY,
        message: 'CRLF line ending (the saved file will keep what the editor writes)',
        source: 'diffing',
        start: { line: i, character: lineEndMarkerStart(text, text.length) },
        end: { line: i, character: Math.max(1, text.length) },
      })
    }
    const ws = line.match(/[ \t]+$/)
    if (ws) {
      markers.push({
        severity: TRAILING_WS_SEVERITY,
        message: 'Trailing whitespace',
        source: 'diffing',
        start: { line: i, character: lineEndMarkerStart(line, ws.index ?? 0) },
        end: { line: i, character: line.length },
      })
    }
    if (/^\t/.test(line)) {
      markers.push({
        severity: TAB_IN_INDENT_SEVERITY,
        message: 'Tab character used for indentation',
        source: 'diffing',
        start: { line: i, character: 0 },
        end: { line: i, character: Math.min(1, line.length) },
      })
    }
  }

  if (!endsWithNewline && lines.length > 0 && content.length > 0) {
    const lastLine = lines.length - 1
    const len = lines[lastLine]?.length ?? 0
    markers.push({
      severity: FINAL_NEWLINE_SEVERITY,
      message: 'File does not end with a newline',
      source: 'diffing',
      start: { line: lastLine, character: lineEndMarkerStart(lines[lastLine] ?? '', len) },
      end: { line: lastLine, character: Math.max(1, len) },
    })
  }

  return markers
}
