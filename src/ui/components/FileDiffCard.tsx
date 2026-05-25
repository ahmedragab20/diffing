import { useState, memo, useRef, useEffect } from 'react'
import { FileDiff } from '@pierre/diffs/react'
import type { DiffLineAnnotation, FileDiffMetadata, AnnotationSide, SelectedLineRange } from '@pierre/diffs'
import { ChevronDown, ChevronRight, Edit3, MessageSquare } from 'lucide-react'
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
  const cardRef = useRef<HTMLDivElement>(null)

  // Synchronize collapse with viewed state changes from parent
  useEffect(() => {
    setCollapsed(viewed)
  }, [viewed])



  const shikiConfig = SHIKI_THEME_MAP[theme] || SHIKI_THEME_MAP.nord

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
              unsafeCSS: `
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
                /* Premium High-Contrast accessible Gutter Line Numbers */
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
                /* Premium Translucent Vercel-style Highlights */
                [data-line][data-line-type="addition"] {
                  background-color: var(--feedback-success-bg) !important;
                  border-left: 3px solid var(--feedback-success-border) !important;
                }
                [data-line][data-line-type="deletion"] {
                  background-color: var(--feedback-danger-bg) !important;
                  border-left: 3px solid var(--feedback-danger-border) !important;
                }
                /* Selection high-contrast visual */
                [data-line].selected-line {
                  background-color: var(--accent-subtle) !important;
                }
              `,
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
        </div>
      )}
    </div>
  )
})
