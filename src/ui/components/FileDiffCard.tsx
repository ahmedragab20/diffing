import { useState, memo, useRef, useEffect, useMemo } from 'react'
import { FileDiff, MultiFileDiff } from '@pierre/diffs/react'
import type { DiffLineAnnotation, FileDiffMetadata, AnnotationSide, SelectedLineRange } from '@pierre/diffs'
import { ChevronDown, ChevronRight, Edit3, MessageSquare, Maximize2, Loader2, Undo2, AlertCircle } from 'lucide-react'
import { useFileContents } from '../hooks/useFileContents'
import type { ReviewComment } from '../../lib/types'
import type {
  LineDiffType,
  DiffIndicators,
  HunkSeparatorStyle,
  LineHoverHighlight,
} from '../hooks/useSettings'
import { CommentForm } from './CommentForm'
import { CommentBubble } from './CommentBubble'
import { SHIKI_THEME_MAP } from '../utils'

interface PendingComment {
  side: AnnotationSide
  lineNumber: number
  startLineNumber?: number
}

interface FileDiffCardProps {
  id?: string
  fileDiff: FileDiffMetadata
  filePath: string
  annotations: DiffLineAnnotation<ReviewComment>[]
  diffStyle: 'split' | 'unified'
  tabSize: number
  viewed: boolean
  theme: string
  editorIDE?: string
  lineDiffType: LineDiffType
  lineWrap: boolean
  diffIndicators: DiffIndicators
  showLineNumbers: boolean
  hunkSeparators: HunkSeparatorStyle
  lineHoverHighlight: LineHoverHighlight
  fontSize: number
  expandContextByDefault: boolean
  collapsedContextThreshold: number
  expansionLineCount: number
  onViewedChange: (filePath: string, viewed: boolean) => void
  onAddComment: (filePath: string, side: AnnotationSide, lineNumber: number, lineContent: string, body: string, startLineNumber?: number) => void
  onDeleteComment: (id: string) => void
}

export const FileDiffCard = memo(function FileDiffCard({
  id,
  fileDiff,
  filePath,
  annotations,
  diffStyle,
  tabSize,
  viewed,
  theme,
  editorIDE,
  lineDiffType,
  lineWrap,
  diffIndicators,
  showLineNumbers,
  hunkSeparators,
  lineHoverHighlight,
  fontSize,
  expandContextByDefault,
  collapsedContextThreshold,
  expansionLineCount,
  onViewedChange,
  onAddComment,
  onDeleteComment,
}: FileDiffCardProps) {
  const [pending, setPending] = useState<PendingComment | null>(null)
  const [selectedRange, setSelectedRange] = useState<SelectedLineRange | null>(null)
  const [liveSelectionCount, setLiveSelectionCount] = useState(0)
  const [permalinkFlash, setPermalinkFlash] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(viewed)
  const [opening, setOpening] = useState(false)
  const [showFileCommentForm, setShowFileCommentForm] = useState(false)
  const [contextExpanded, setContextExpanded] = useState(expandContextByDefault)
  const [revertingHunk, setRevertingHunk] = useState<number | null>(null)
  const [revertError, setRevertError] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const handleRevertHunk = async (hunkIndex: number) => {
    if (revertingHunk !== null) return
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `Revert hunk #${hunkIndex + 1} in ${filePath}? This rewrites the file via "git apply --reverse".`,
      )
    )
      return
    setRevertingHunk(hunkIndex)
    setRevertError(null)
    try {
      const res = await fetch('/api/revert-hunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, hunkIndex }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      // SSE will refresh the diff automatically.
    } catch (err: any) {
      setRevertError(err.message)
    } finally {
      setRevertingHunk(null)
    }
  }

  const isChangedFile = fileDiff.type === 'change' || fileDiff.type === 'rename-changed'
  const canExpandContext = !collapsed && isChangedFile
  const { loading: contentsLoading, oldContent, newContent } = useFileContents(
    filePath,
    contextExpanded && canExpandContext,
  )
  const contentsReady =
    contextExpanded && oldContent !== null && newContent !== null
  const oldFilePath = fileDiff.prevName ?? filePath

  // Synchronize collapse with viewed state changes from parent
  useEffect(() => {
    setCollapsed(viewed)
  }, [viewed])



  const shikiConfig = SHIKI_THEME_MAP[theme] || SHIKI_THEME_MAP.nord

  // Stable across re-renders triggered by unrelated prop changes (e.g. toggling
  // split/unified) so the diff renderer isn't handed a brand-new CSS string
  // every time. Only tabSize/fontSize actually affect it.
  const unsafeCSS = useMemo(() => buildUnsafeCSS(tabSize, fontSize), [tabSize, fontSize])

  const getLineContent = (side: AnnotationSide, lineNumber: number, startLineNumber?: number): string => {
    const startNum = startLineNumber && startLineNumber !== lineNumber ? startLineNumber : lineNumber
    const endNum = lineNumber
    const resultLines: string[] = []

    for (let line = startNum; line <= endNum; line++) {
      const lines = side === 'additions' ? fileDiff.additionLines : fileDiff.deletionLines
      const startKey = side === 'additions' ? 'additionStart' : 'deletionStart'
      const countKey = side === 'additions' ? 'additionCount' : 'deletionCount'
      const indexKey = side === 'additions' ? 'additionLineIndex' : 'deletionLineIndex'
      let found = false
      for (const hunk of fileDiff.hunks) {
        const start = hunk[startKey]
        const count = hunk[countKey]
        if (line >= start && line < start + count) {
          const index = hunk[indexKey] + (line - start)
          resultLines.push(lines[index] ?? '')
          found = true
          break
        }
      }
      if (!found) {
        resultLines.push('')
      }
    }
    return resultLines.join('\n')
  }

  const handleOpenEditor = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (fileDiff.type === 'deleted') return
    setOpening(true)
    try {
      await fetch('/api/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, editor: editorIDE }),
      })
    } catch (err) {
      console.error('Failed to open file in IDE editor:', err)
    } finally {
      setOpening(false)
    }
  }

  const getStatusBadge = () => {
    switch (fileDiff.type) {
      case 'new':
        return <span className="diff-status-badge diff-status-new">Added</span>
      case 'deleted':
        return <span className="diff-status-badge diff-status-deleted">Deleted</span>
      case 'rename-pure':
      case 'rename-changed':
        return <span className="diff-status-badge diff-status-renamed">Renamed</span>
      default:
        return <span className="diff-status-badge diff-status-modified">Modified</span>
    }
  }

  const fileLevelAnnotations = annotations.filter((a) => a.lineNumber === 0)
  const lineAnnotations = annotations.filter((a) => a.lineNumber > 0)

  const renderAnnotationFn = (
    annotation: DiffLineAnnotation<ReviewComment | { _pending: true }>,
  ) => {
    if ('_pending' in annotation.metadata) {
      const draftKey = `new:${filePath}:${pending!.side}:${pending!.startLineNumber || pending!.lineNumber}:${pending!.lineNumber}`
      return (
        <CommentForm
          draftKey={draftKey}
          lineContent={getLineContent(
            pending!.side,
            pending!.lineNumber,
            pending!.startLineNumber,
          )}
          onSubmit={(body) => {
            const lineContent = getLineContent(
              pending!.side,
              pending!.lineNumber,
              pending!.startLineNumber,
            )
            onAddComment(
              filePath,
              pending!.side,
              pending!.lineNumber,
              lineContent,
              body,
              pending!.startLineNumber,
            )
            setPending(null)
            setSelectedRange(null)
          }}
          onCancel={() => {
            setPending(null)
            setSelectedRange(null)
          }}
        />
      )
    }
    return (
      <CommentBubble
        comment={annotation.metadata as ReviewComment}
        onDelete={onDeleteComment}
      />
    )
  }

  const renderGutter = (
    getHoveredLine: () => { lineNumber: number; side: AnnotationSide } | undefined,
  ) => (
    <button
      className="gutter-add-btn"
      onClick={() => {
        const line = getHoveredLine()
        if (line) {
          setPending({ side: line.side, lineNumber: line.lineNumber })
        }
      }}
    >
      +
    </button>
  )

  const allAnnotations: DiffLineAnnotation<ReviewComment | { _pending: true }>[] = [
    ...lineAnnotations,
    ...(pending
      ? [
          {
            side: pending.side,
            lineNumber: pending.lineNumber,
            metadata: { _pending: true as const },
          },
        ]
      : []),
  ]

  return (
    <div
      ref={cardRef}
      className={`file-diff-card ${viewed ? 'file-diff-viewed' : ''} ${collapsed ? 'file-diff-collapsed' : ''}`}
      id={id}
    >
      <div 
        className="file-diff-card-header"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="file-diff-header-left">
          <span className="file-diff-collapse-indicator">
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </span>
          <span className="file-diff-name" title={filePath}>
            {filePath}
          </span>
          {getStatusBadge()}
          {lineAnnotations.length > 0 && (
            <span
              className="file-diff-comment-badge"
              title={`${lineAnnotations.length} inline comment${lineAnnotations.length === 1 ? '' : 's'}`}
            >
              <MessageSquare size={10} />
              {lineAnnotations.length}
            </span>
          )}
          {liveSelectionCount > 0 && (
            <span className="file-diff-selection-badge" aria-live="polite">
              {liveSelectionCount} line{liveSelectionCount === 1 ? '' : 's'} selected
            </span>
          )}
          {permalinkFlash && (
            <span className="file-diff-permalink-flash" role="status">
              Copied {permalinkFlash}
            </span>
          )}
        </div>

        <div className="file-diff-header-right" onClick={(e) => e.stopPropagation()}>
          {canExpandContext && (
            <button
              className={`file-diff-edit-btn ${contextExpanded ? 'btn-active' : ''}`}
              onClick={() => setContextExpanded((v) => !v)}
              disabled={contentsLoading}
              title={
                contextExpanded
                  ? 'Hide unchanged context (use original patch render)'
                  : 'Load full file so unchanged context becomes expandable'
              }
            >
              {contentsLoading ? <Loader2 size={11} className="spin" /> : <Maximize2 size={11} />}
              <span>
                {contentsLoading
                  ? 'Loading…'
                  : contextExpanded
                    ? 'Hide Context'
                    : 'Expand Context'}
              </span>
            </button>
          )}
          {fileDiff.type !== 'deleted' && (
            <button
              className="file-diff-edit-btn"
              onClick={handleOpenEditor}
              disabled={opening}
              title="Open and edit full file locally"
            >
              <Edit3 size={11} />
              <span>{opening ? 'Opening...' : 'Edit File'}</span>
            </button>
          )}
          <button
            className="file-diff-edit-btn"
            onClick={() => {
              setCollapsed(false)
              setShowFileCommentForm(true)
            }}
            title="Comment on this entire file"
          >
            <MessageSquare size={11} />
            <span>Add Comment</span>
          </button>
          <label className={`viewed-label ${viewed ? 'viewed-checked' : ''}`}>
            <input
              type="checkbox"
              checked={viewed}
              onChange={(e) => onViewedChange(filePath, e.target.checked)}
            />
            Viewed
          </label>
        </div>
      </div>

      {!collapsed && fileDiff.hunks.length > 0 && (
        <div className="file-diff-hunk-actions" onClick={(e) => e.stopPropagation()}>
          <span className="file-diff-hunk-actions-label">
            Hunks · {fileDiff.hunks.length}
          </span>
          <div className="file-diff-hunk-actions-buttons">
            {fileDiff.hunks.map((h, i) => (
              <button
                key={i}
                type="button"
                className="file-diff-hunk-revert-btn"
                onClick={() => handleRevertHunk(i)}
                disabled={revertingHunk !== null}
                title={`Revert hunk #${i + 1} (lines @${h.additionStart}+${h.additionLines}) via git apply --reverse`}
              >
                {revertingHunk === i ? (
                  <Loader2 size={10} className="spin" />
                ) : (
                  <Undo2 size={10} />
                )}
                <span>#{i + 1}</span>
              </button>
            ))}
          </div>
          {revertError && (
            <span className="file-diff-hunk-error" role="alert">
              <AlertCircle size={11} />
              {revertError}
            </span>
          )}
        </div>
      )}
      {!collapsed && (
        <div className="file-diff-card-body">
          {/* File-level comments section */}
          {(fileLevelAnnotations.length > 0 || showFileCommentForm) && (
            <div 
              className="file-level-comments-section"
              style={{
                margin: '16px 20px',
                padding: '12px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                <MessageSquare size={14} />
                <span>File-Level Comments ({fileLevelAnnotations.length})</span>
              </div>
              
              {fileLevelAnnotations.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {fileLevelAnnotations.map((anno) => (
                    <CommentBubble
                      key={anno.metadata.id}
                      comment={anno.metadata}
                      onDelete={onDeleteComment}
                    />
                  ))}
                </div>
              )}

              {showFileCommentForm && (
                <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                  <CommentForm
                    draftKey={`file-comment:${filePath}`}
                    lineContent=""
                    onSubmit={(body) => {
                      onAddComment(filePath, 'additions', 0, '', body)
                      setShowFileCommentForm(false)
                    }}
                    onCancel={() => setShowFileCommentForm(false)}
                  />
                </div>
              )}
            </div>
          )}

          {/* Render switch: when the user opts in to "Expand Context",
              we use MultiFileDiff (computes the diff from full file
              contents, so unchanged hunks are expandable). Otherwise
              the cheaper FileDiff render is used against the parsed
              partial patch. */}
          {contentsReady ? (
            <MultiFileDiff<ReviewComment | { _pending: true }>
              oldFile={{ name: oldFilePath, contents: oldContent ?? '' }}
              newFile={{ name: filePath, contents: newContent ?? '' }}
              options={{
                diffStyle,
                enableGutterUtility: true,
                enableLineSelection: true,
                disableFileHeader: true,
                lineDiffType,
                overflow: lineWrap ? 'wrap' : 'scroll',
                diffIndicators,
                disableLineNumbers: !showLineNumbers,
                hunkSeparators,
                lineHoverHighlight,
                expandUnchanged: false,
                collapsedContextThreshold,
                expansionLineCount,
                onLineSelectionStart: () => {
                  setSelectedRange(null)
                  setLiveSelectionCount(0)
                },
                onLineSelectionChange: (range) => {
                  if (range) {
                    setLiveSelectionCount(Math.abs(range.end - range.start) + 1)
                  } else {
                    setLiveSelectionCount(0)
                  }
                },
                onLineSelectionEnd: (range) => {
                  setLiveSelectionCount(0)
                  if (range) {
                    setSelectedRange(range)
                    setPending({
                      side: range.endSide || 'additions',
                      lineNumber: range.end,
                      startLineNumber: range.start,
                    })
                  }
                },
                onLineNumberClick: (props) => {
                  const side = props.annotationSide === 'deletions' ? '-' : '+'
                  const link = `${filePath}:${side}${props.lineNumber}`
                  navigator.clipboard?.writeText(link).then(
                    () => {
                      setPermalinkFlash(link)
                      setTimeout(() => setPermalinkFlash(null), 1600)
                    },
                    () => {},
                  )
                },
                theme: {
                  dark: shikiConfig.type === 'dark' ? shikiConfig.themeName : 'nord',
                  light: shikiConfig.type === 'light' ? shikiConfig.themeName : 'github-light',
                },
                themeType: shikiConfig.type,
                unsafeCSS,
              }}
              selectedLines={selectedRange}
              lineAnnotations={allAnnotations}
              renderHeaderMetadata={() => null}
              renderAnnotation={renderAnnotationFn}
              renderGutterUtility={renderGutter}
            />
          ) : (
          <FileDiff<ReviewComment | { _pending: true }>
            fileDiff={fileDiff}
            options={{
              diffStyle,
              enableGutterUtility: true,
              enableLineSelection: true,
              disableFileHeader: true, // Disable built-in header to use custom header
              lineDiffType,
              overflow: lineWrap ? 'wrap' : 'scroll',
              diffIndicators,
              disableLineNumbers: !showLineNumbers,
              hunkSeparators,
              lineHoverHighlight,
              onLineSelectionStart: () => {
                setSelectedRange(null)
                setLiveSelectionCount(0)
              },
              onLineSelectionChange: (range) => {
                if (range) {
                  setLiveSelectionCount(Math.abs(range.end - range.start) + 1)
                } else {
                  setLiveSelectionCount(0)
                }
              },
              onLineSelectionEnd: (range) => {
                setLiveSelectionCount(0)
                if (range) {
                  setSelectedRange(range)
                  setPending({
                    side: range.endSide || 'additions',
                    lineNumber: range.end,
                    startLineNumber: range.start,
                  })
                }
              },
              onLineNumberClick: (props) => {
                const side = props.annotationSide === 'deletions' ? '-' : '+'
                const link = `${filePath}:${side}${props.lineNumber}`
                navigator.clipboard?.writeText(link).then(
                  () => {
                    setPermalinkFlash(link)
                    setTimeout(() => setPermalinkFlash(null), 1600)
                  },
                  () => {},
                )
              },
              theme: {
                dark: shikiConfig.type === 'dark' ? shikiConfig.themeName : 'nord',
                light: shikiConfig.type === 'light' ? shikiConfig.themeName : 'github-light',
              },
              themeType: shikiConfig.type,
              unsafeCSS,
            }}
            selectedLines={selectedRange}
            lineAnnotations={allAnnotations}
            renderHeaderMetadata={() => null} // Header is disabled
            renderAnnotation={(annotation) => {
              if ('_pending' in annotation.metadata) {
                const draftKey = `new:${filePath}:${pending!.side}:${pending!.startLineNumber || pending!.lineNumber}:${pending!.lineNumber}`
                return (
                  <CommentForm
                    draftKey={draftKey}
                    lineContent={getLineContent(pending!.side, pending!.lineNumber, pending!.startLineNumber)}
                    onSubmit={(body) => {
                      const lineContent = getLineContent(pending!.side, pending!.lineNumber, pending!.startLineNumber)
                      onAddComment(filePath, pending!.side, pending!.lineNumber, lineContent, body, pending!.startLineNumber)
                      setPending(null)
                      setSelectedRange(null)
                    }}
                    onCancel={() => {
                      setPending(null)
                      setSelectedRange(null)
                    }}
                  />
                )
              }
              return (
                <CommentBubble
                  comment={annotation.metadata as ReviewComment}
                  onDelete={onDeleteComment}
                />
              )
            }}
            renderGutterUtility={(getHoveredLine) => (
              <button
                className="gutter-add-btn"
                onClick={() => {
                  const line = getHoveredLine()
                  if (line) {
                    setPending({ side: line.side, lineNumber: line.lineNumber })
                  }
                }}
              >
                +
              </button>
            )}
          />
          )}
        </div>
      )}
    </div>
  )
})

function buildUnsafeCSS(tabSize: number, fontSize: number): string {
  return `
    :host {
      --diffs-tab-size: ${tabSize} !important;
      --diffs-font-family: var(--font-mono) !important;
      --diffs-font-size: ${fontSize}px !important;
      --diffs-border: var(--border-normal) !important;
      --diffs-bg: var(--bg-secondary) !important;
      --diffs-line-height: ${Math.round(fontSize * 1.7)}px !important;
    }
    [data-column-number], [data-line] {
      font-family: var(--font-mono) !important;
      font-size: ${fontSize}px !important;
      font-variant-ligatures: common-ligatures !important;
      font-feature-settings: "liga" on, "calt" on !important;
    }
    [data-column-number] {
      color: var(--text-muted) !important;
      opacity: 0.65 !important;
      user-select: none !important;
      padding-right: 12px !important;
      cursor: pointer !important;
    }
    [data-line]:hover [data-column-number] {
      opacity: 1 !important;
      color: var(--primary) !important;
    }
    [data-line][data-line-type="addition"] {
      background-color: var(--feedback-success-bg) !important;
      border-left: 3px solid var(--feedback-success-border) !important;
    }
    [data-line][data-line-type="deletion"] {
      background-color: var(--feedback-danger-bg) !important;
      border-left: 3px solid var(--feedback-danger-border) !important;
    }
    [data-line].selected-line {
      background-color: var(--accent-subtle) !important;
    }
  `
}
