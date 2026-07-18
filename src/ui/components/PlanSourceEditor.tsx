import { useCallback, useEffect, useMemo, useRef } from 'react'
import { lineNumberFromOffset } from '../lib/planLineSync'

export interface PlanSourceEditorProps {
  value: string
  onChange: (value: string) => void
  /** 1-based line of the caret; fired on input, click, keyup, select. */
  onActiveLineChange?: (line: number) => void
  fontSize: number
  monoFontFamily: string
  defaultTabSize: number
  lineWrap: boolean
  showLineNumbers: boolean
  ariaLabel?: string
  /** Optional class on the outer shell. */
  className?: string
}

/**
 * Lightweight line-numbered markdown editor used when the plan page is in
 * edit mode. Reports the active caret line so Split can face the Read pane.
 */
export function PlanSourceEditor({
  value,
  onChange,
  onActiveLineChange,
  fontSize,
  monoFontFamily,
  defaultTabSize,
  lineWrap,
  showLineNumbers,
  ariaLabel = 'Plan source editor',
  className,
}: PlanSourceEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const lastLineRef = useRef(1)

  const lineCount = useMemo(() => {
    if (!value) return 1
    return value.replace(/\r\n/g, '\n').split('\n').length
  }, [value])

  const lineNumbers = useMemo(() => {
    const n = Math.max(1, lineCount)
    // Precompute as a single string so the gutter is cheap to paint.
    let s = ''
    for (let i = 1; i <= n; i++) {
      s += i === n ? String(i) : `${i}\n`
    }
    return s
  }, [lineCount])

  const reportActiveLine = useCallback(() => {
    const ta = textareaRef.current
    if (!ta || !onActiveLineChange) return
    const line = lineNumberFromOffset(ta.value, ta.selectionStart ?? 0)
    if (line !== lastLineRef.current) {
      lastLineRef.current = line
      onActiveLineChange(line)
    }
  }, [onActiveLineChange])

  // Keep gutter scroll locked to the textarea.
  const syncGutterScroll = useCallback(() => {
    const ta = textareaRef.current
    const gutter = gutterRef.current
    if (!ta || !gutter) return
    gutter.scrollTop = ta.scrollTop
  }, [])

  useEffect(() => {
    reportActiveLine()
  }, [value, reportActiveLine])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value)
    // selection may not have updated yet; report on next frame
    requestAnimationFrame(reportActiveLine)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return
    e.preventDefault()
    const ta = e.currentTarget
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const insert = '\t'
    const next = value.slice(0, start) + insert + value.slice(end)
    onChange(next)
    // Restore caret after React re-render.
    requestAnimationFrame(() => {
      if (!textareaRef.current) return
      const pos = start + insert.length
      textareaRef.current.selectionStart = pos
      textareaRef.current.selectionEnd = pos
      reportActiveLine()
    })
  }

  const lineHeight = Math.round(fontSize * 1.7)
  const gutterWidth = Math.max(2.5, String(lineCount).length + 1.25)

  return (
    <div
      className={['plan-source-editor', className].filter(Boolean).join(' ')}
      style={
        {
          '--plan-editor-font-size': `${fontSize}px`,
          '--plan-editor-font-family': monoFontFamily,
          '--plan-editor-line-height': `${lineHeight}px`,
          '--plan-editor-tab-size': String(defaultTabSize),
          '--plan-editor-gutter-ch': `${gutterWidth}ch`,
        } as React.CSSProperties
      }
    >
      {showLineNumbers && (
        <div
          ref={gutterRef}
          className="plan-source-editor-gutter"
          aria-hidden="true"
        >
          <pre className="plan-source-editor-gutter-text">{lineNumbers}</pre>
        </div>
      )}
      <textarea
        ref={textareaRef}
        className={`plan-source-editor-textarea ${lineWrap ? 'is-wrap' : 'is-scroll'}`}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={reportActiveLine}
        onClick={reportActiveLine}
        onSelect={reportActiveLine}
        onScroll={syncGutterScroll}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label={ariaLabel}
        wrap={lineWrap ? 'soft' : 'off'}
      />
    </div>
  )
}
