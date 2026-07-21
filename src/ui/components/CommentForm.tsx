import { useState, useRef, useEffect, type ReactNode } from 'react'
import { Select as BaseSelect } from '@base-ui-components/react/select'
import {
  AlertOctagon,
  Check,
  ChevronsUpDown,
  CircleDot,
  HelpCircle,
  Minus,
  Sparkles,
} from 'lucide-react'
import { Markdown } from './Markdown'
import { getDraft, setDraft, clearDraft } from '../drafts'
import { useFeedback } from '../hooks/useHaptics'
import { useFileMention } from '../hooks/useFileMention'
import { FileMentionDropdown } from './FileMentionDropdown'
import { useSettings, type SavedReply } from '../hooks/useSettings'
import type { CommentSeverity } from '../../lib/types'

function preprocessMentions(content: string): string {
  return content.replace(/@([^\s@]+)/g, (_, path: string) => {
    const name = path.split('/').pop() || path
    return `[${name}](file-mention://${path})`
  })
}

const SEVERITY_OPTIONS: {
  value: CommentSeverity
  label: string
  hint: string
  icon: ReactNode
}[] = [
  { value: 'none', label: 'None', hint: 'Untriaged', icon: <Minus size={13} /> },
  {
    value: 'blocking',
    label: 'Blocking',
    hint: 'Must fix before merge',
    icon: <AlertOctagon size={13} />,
  },
  { value: 'nit', label: 'Nit', hint: 'Optional polish', icon: <CircleDot size={13} /> },
  {
    value: 'question',
    label: 'Question',
    hint: 'Needs an answer',
    icon: <HelpCircle size={13} />,
  },
  {
    value: 'praise',
    label: 'Praise',
    hint: 'No change required',
    icon: <Sparkles size={13} />,
  },
]

function SeveritySelect({
  value,
  onChange,
}: {
  value: CommentSeverity
  onChange: (v: CommentSeverity) => void
}) {
  const current = SEVERITY_OPTIONS.find((o) => o.value === value) ?? SEVERITY_OPTIONS[0]!
  return (
    <BaseSelect.Root
      value={value}
      onValueChange={(v) => onChange(v as CommentSeverity)}
      modal={false}
    >
      <BaseSelect.Trigger
        className={`ui-select-trigger comment-severity-trigger comment-severity-trigger-${value}`}
        aria-label="Comment severity"
        data-severity={value}
      >
        <span className="comment-severity-trigger-inner">
          <span className="comment-severity-icon" data-severity={value} aria-hidden="true">
            {current.icon}
          </span>
          <BaseSelect.Value>
            {(val: string) =>
              SEVERITY_OPTIONS.find((o) => o.value === val)?.label ?? val
            }
          </BaseSelect.Value>
        </span>
        <BaseSelect.Icon className="ui-select-icon">
          <ChevronsUpDown size={12} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          className="ui-select-positioner comment-severity-positioner"
          sideOffset={4}
          align="start"
          side="top"
          alignItemWithTrigger={false}
        >
          <BaseSelect.Popup className="ui-select-popup comment-severity-popup" aria-label="Severity">
            {SEVERITY_OPTIONS.map((o) => (
              <BaseSelect.Item
                key={o.value}
                value={o.value}
                className={`ui-select-item comment-severity-item comment-severity-item-${o.value}`}
              >
                <span className="comment-severity-item-main">
                  <span className="comment-severity-icon" data-severity={o.value} aria-hidden="true">
                    {o.icon}
                  </span>
                  <span className="comment-severity-item-text">
                    <BaseSelect.ItemText className="comment-severity-item-label">
                      {o.label}
                    </BaseSelect.ItemText>
                    <span className="comment-severity-item-hint">{o.hint}</span>
                  </span>
                </span>
                <BaseSelect.ItemIndicator className="ui-select-indicator">
                  <Check size={13} />
                </BaseSelect.ItemIndicator>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}

/** Editable inclusive line range for a new inline comment draft. */
export interface CommentFormRange {
  /** Top of range (inclusive). */
  start: number
  /** Bottom of range (inclusive) — annotation slot. */
  end: number
  /** "new" | "old" or similar side label. */
  sideLabel: string
  /** Whether the start edge can move up (−1) or down (+1). */
  canAdjustStart?: (delta: -1 | 1) => boolean
  /** Whether the end edge can move up (−1) or down (+1). */
  canAdjustEnd?: (delta: -1 | 1) => boolean
}

interface CommentFormProps {
  initialBody?: string
  lineContent?: string
  /** Optional static range label shown above the form, e.g. "L12–L15 · new". */
  lineLabel?: string
  /**
   * Interactive range chrome (bidirectional start/end steppers). When provided
   * with `onAdjustStart` / `onAdjustEnd`, replaces the static `lineLabel` chip.
   */
  range?: CommentFormRange
  /** Move the top of the range (−1 expand up, +1 shrink toward end). */
  onAdjustStart?: (delta: -1 | 1) => void
  /** Move the bottom of the range (−1 shrink toward start, +1 expand down). */
  onAdjustEnd?: (delta: -1 | 1) => void
  draftKey?: string
  /** Called with body + optional severity (omit / none = no severity). */
  onSubmit: (body: string, severity?: CommentSeverity) => void
  onCancel: () => void
  /** Hide severity control (e.g. reply-only contexts). Default true for new comments. */
  showSeverity?: boolean
}

export function CommentForm({
  initialBody,
  lineContent,
  lineLabel,
  range,
  onAdjustStart,
  onAdjustEnd,
  draftKey,
  onSubmit,
  onCancel,
  showSeverity = true,
}: CommentFormProps) {
  const { haptic, sound } = useFeedback()
  const { settings, updateSettings } = useSettings()
  const savedReplies: SavedReply[] = settings.savedReplies ?? []
  const [body, setBody] = useState(() => {
    if (draftKey) {
      const draft = getDraft(draftKey)
      if (draft) return draft
    }
    return initialBody || ''
  })
  const [severity, setSeverity] = useState<CommentSeverity>('none')
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write')
  const [showSavedReplies, setShowSavedReplies] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  const mention = useFileMention(body, setBody)

  const insertSavedReply = (reply: SavedReply) => {
    setBody((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${reply.body}` : reply.body))
    setShowSavedReplies(false)
    setActiveTab('write')
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const saveCurrentAsReply = () => {
    const trimmed = body.trim()
    if (!trimmed) return
    const title = window.prompt('Template title', trimmed.slice(0, 40))?.trim()
    if (!title) return
    const next: SavedReply[] = [
      ...savedReplies,
      { id: crypto.randomUUID(), title, body: trimmed },
    ]
    updateSettings({ savedReplies: next })
  }

  useEffect(() => {
    if (activeTab === 'write') {
      textareaRef.current?.focus()
    } else {
      previewRef.current?.focus()
    }
  }, [activeTab])

  useEffect(() => {
    if (draftKey) {
      setDraft(body, draftKey)
    }
  }, [body, draftKey])

  const handleSubmit = () => {
    const trimmed = body.trim()
    if (trimmed) {
      if (draftKey) clearDraft(draftKey)
      haptic('success')
      sound('success')
      onSubmit(trimmed, severity === 'none' ? undefined : severity)
    }
  }

  /** Pre-fill a GitHub-style ```suggestion fence from the selected line content. */
  const insertSuggestion = () => {
    if (!lineContent) return
    // Strip leading +/- markers from the reviewed line snapshot.
    const code = lineContent
      .split('\n')
      .map((l) => l.replace(/^[+\- ]/, ''))
      .join('\n')
    const fence = `\`\`\`suggestion\n${code}\n\`\`\`\n`
    setBody((prev) => {
      if (!prev.trim()) return fence
      if (prev.includes('```suggestion')) return prev
      return `${prev.trimEnd()}\n\n${fence}`
    })
    setActiveTab('write')
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mention.handleKeyDown(e)) return
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'p' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault()
      setActiveTab((t) => (t === 'write' ? 'preview' : 'write'))
    }
    if (e.key === 'Escape') {
      if (body.includes('\n')) return
      onCancel()
    }
  }

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items
    let imageFile: File | null = null

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        imageFile = item.getAsFile()
        break
      }
    }

    if (!imageFile) return
    e.preventDefault()

    const textarea = textareaRef.current
    if (!textarea) return

    // Upload the image to the server and reference it by URL rather than
    // inlining a huge base64 data URL into the comment body. A unique token in
    // the placeholder lets multiple concurrent pastes resolve independently.
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const token = Math.random().toString(36).slice(2, 8)
    const placeholder = `![Uploading image… ${token}]()`
    const val = textarea.value
    setBody(val.slice(0, start) + placeholder + val.slice(end))

    try {
      const form = new FormData()
      form.append('file', imageFile, imageFile.name || `pasted-${token}.png`)
      const res = await fetch('/api/attachments', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { url?: string; error?: string }
      if (!data.url) throw new Error(data.error || 'Upload failed')
      const markdownImage = `![pasted image](${data.url})`
      setBody((prev) => prev.replace(placeholder, markdownImage))
    } catch (err) {
      console.error('Image upload failed:', err)
      setBody((prev) => prev.replace(placeholder, '![upload failed]()'))
    }
  }

  const rangeEditable = !!(range && onAdjustStart && onAdjustEnd)
  const lineCount = range ? Math.abs(range.end - range.start) + 1 : 0
  const canStartUp = rangeEditable && (range!.canAdjustStart?.(-1) ?? true)
  const canStartDown = rangeEditable && (range!.canAdjustStart?.(1) ?? true)
  const canEndUp = rangeEditable && (range!.canAdjustEnd?.(-1) ?? true)
  const canEndDown = rangeEditable && (range!.canAdjustEnd?.(1) ?? true)

  /** Keep focus in the textarea when using range steppers. */
  const preventFocusSteal = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  return (
    <div className="comment-form" style={{ padding: '16px' }} role="form" aria-label="Comment form">
      {rangeEditable && range ? (
        <div className="comment-form-range" aria-live="polite">
          <span className="comment-form-range-prefix">Commenting on</span>
          <div className="comment-form-range-controls" role="group" aria-label="Comment line range">
            <div className="comment-form-range-edge" aria-label="Range start">
              <button
                type="button"
                className="comment-form-range-btn"
                aria-label="Expand range upward"
                title="Expand range upward"
                disabled={!canStartUp}
                onMouseDown={preventFocusSteal}
                onClick={() => onAdjustStart!(-1)}
              >
                −
              </button>
              <span className="comment-form-range-num" aria-label={`Start line ${range.start}`}>
                L{range.start}
              </span>
              <button
                type="button"
                className="comment-form-range-btn"
                aria-label="Shrink range from top"
                title="Shrink range from top"
                disabled={!canStartDown}
                onMouseDown={preventFocusSteal}
                onClick={() => onAdjustStart!(1)}
              >
                +
              </button>
            </div>
            <span className="comment-form-range-sep" aria-hidden="true">
              –
            </span>
            <div className="comment-form-range-edge" aria-label="Range end">
              <button
                type="button"
                className="comment-form-range-btn"
                aria-label="Shrink range from bottom"
                title="Shrink range from bottom"
                disabled={!canEndUp}
                onMouseDown={preventFocusSteal}
                onClick={() => onAdjustEnd!(-1)}
              >
                −
              </button>
              <span className="comment-form-range-num" aria-label={`End line ${range.end}`}>
                L{range.end}
              </span>
              <button
                type="button"
                className="comment-form-range-btn"
                aria-label="Expand range downward"
                title="Expand range downward"
                disabled={!canEndDown}
                onMouseDown={preventFocusSteal}
                onClick={() => onAdjustEnd!(1)}
              >
                +
              </button>
            </div>
          </div>
          <span className="comment-form-range-meta">
            <span className="comment-form-range-side">{range.sideLabel}</span>
            <span className="comment-form-range-count">
              {lineCount} line{lineCount === 1 ? '' : 's'}
            </span>
          </span>
        </div>
      ) : lineLabel ? (
        <div className="comment-form-line-label" aria-live="polite">
          Commenting on <strong>{lineLabel}</strong>
        </div>
      ) : null}
      <div
        className="comment-form-tabs"
        role="tablist"
        aria-label="Comment form mode"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'write'}
          aria-controls="comment-write-panel"
          onClick={() => setActiveTab('write')}
          onKeyDown={(e) => { if (e.key === 'ArrowRight') { e.preventDefault(); setActiveTab('preview') } }}
          className={`comment-form-tab-btn ${activeTab === 'write' ? 'comment-form-tab-btn-active' : 'comment-form-tab-btn-inactive'}`}
        >
          Write
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'preview'}
          aria-controls="comment-preview-panel"
          onClick={() => setActiveTab('preview')}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); setActiveTab('write') } }}
          className={`comment-form-tab-btn ${activeTab === 'preview' ? 'comment-form-tab-btn-active' : 'comment-form-tab-btn-inactive'}`}
        >
          Preview
        </button>
      </div>

      {activeTab === 'write' ? (
        <div>
          <div className="comment-form-suggest-row">
            {savedReplies.length > 0 && (
              <div className="comment-form-saved-replies">
                <button
                  type="button"
                  className="btn btn-sm comment-form-suggest-btn"
                  onClick={() => setShowSavedReplies((v) => !v)}
                  aria-expanded={showSavedReplies}
                  title="Insert a saved reply template"
                >
                  Saved replies
                </button>
                {showSavedReplies && (
                  <ul className="comment-form-saved-list" role="listbox">
                    {savedReplies.map((r) => (
                      <li key={r.id}>
                        <button type="button" onClick={() => insertSavedReply(r)} role="option">
                          {r.title}
                        </button>
                        <button
                          type="button"
                          className="comment-form-saved-delete"
                          aria-label={`Delete template ${r.title}`}
                          onClick={() =>
                            updateSettings({
                              savedReplies: savedReplies.filter((x) => x.id !== r.id),
                            })
                          }
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {body.trim() && (
              <button
                type="button"
                className="btn btn-sm comment-form-suggest-btn"
                onClick={saveCurrentAsReply}
                title="Save current body as a reusable template"
              >
                Save template
              </button>
            )}
            {lineContent ? (
              <button
                type="button"
                className="btn btn-sm comment-form-suggest-btn"
                onClick={insertSuggestion}
                title="Insert a ```suggestion block pre-filled with the selected line(s)"
              >
                Suggest change
              </button>
            ) : null}
          </div>
          <div style={{ position: 'relative' }}>
            <textarea
              id="comment-write-panel"
              ref={(el) => {
                (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
                mention.setTextareaRef(el)
              }}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Leave a review comment (supports Markdown and Pasting Clipboard Images)..."
              rows={4}
              aria-label="Comment body"
              style={{ minHeight: '100px' }}
            />
            {mention.isOpen && (
              <FileMentionDropdown
                results={mention.results}
                focusedIndex={mention.focusedIndex}
                query={mention.query}
                cursorTop={mention.cursorTop}
                onSelect={mention.onSelect}
                onHover={mention.setFocusedIndex}
              />
            )}
          </div>
        </div>
      ) : (
        <div
          id="comment-preview-panel"
          ref={previewRef}
          role="tabpanel"
          aria-label="Preview"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'p' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
              e.preventDefault()
              setActiveTab('write')
            }
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          {(() => {
            const suggestionMatch = body.match(/```suggestion\n([\s\S]*?)```/)
            const hasSuggestion = !!suggestionMatch
            const remainingText = body.replace(/```suggestion\n([\s\S]*?)```/g, '').trim()
            const hasOtherContent = remainingText.length > 0 || !hasSuggestion

            if (!hasOtherContent) return null

            return (
              <div 
                className="comment-preview markdown-body" 
                style={{ 
                  minHeight: '100px',
                  padding: '12px 16px',
                  border: '1px solid var(--border-normal)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-primary)',
                  fontSize: '14px',
                  lineHeight: 1.6,
                  color: 'var(--text-primary)',
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word'
                }}
              >
                {body.trim() ? (
                  <Markdown content={preprocessMentions(body)} />
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Nothing to preview</span>
                )}
              </div>
            )
          })()}
          {(() => {
            const suggestionMatch = body.match(/```suggestion\n([\s\S]*?)```/)
            const hasSuggestion = !!suggestionMatch
            const suggestionCode = suggestionMatch ? suggestionMatch[1].trimEnd() : ''
            if (!hasSuggestion) return null

            return (
              <div 
                className="suggestion-card" 
                style={{
                  border: '1px solid var(--border-normal)',
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  background: 'var(--bg-primary)',
                  boxShadow: 'var(--shadow-sm)'
                }}
              >
                <div 
                  className="suggestion-header" 
                  style={{
                    padding: '8px 12px',
                    background: 'var(--bg-secondary)',
                    borderBottom: '1px solid var(--border-normal)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                    fontWeight: 600
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)' }}>Suggested Change Preview</span>
                </div>
                 <div className="suggestion-diff" style={{ display: 'flex', flexDirection: 'column', fontSize: '12px', fontFamily: 'var(--font-mono)', overflowX: 'auto' }}>
                  {lineContent && (
                    <div 
                      style={{ 
                        display: 'flex', 
                        padding: '8px 12px', 
                        background: 'var(--feedback-danger-bg)', 
                        borderBottom: '1px dashed var(--border-color)',
                        color: 'var(--feedback-danger-text)',
                        minWidth: 'max-content'
                      }}
                    >
                      <span style={{ width: '20px', userSelect: 'none', opacity: 0.5 }}>-</span>
                      <span style={{ whiteSpace: 'pre' }}>{lineContent}</span>
                    </div>
                  )}
                  <div 
                    style={{ 
                      display: 'flex', 
                      padding: '8px 12px', 
                      background: 'var(--feedback-success-bg)',
                      color: 'var(--feedback-success-text)',
                      minWidth: 'max-content'
                    }}
                  >
                    <span style={{ width: '20px', userSelect: 'none', opacity: 0.5 }}>+</span>
                    <span style={{ whiteSpace: 'pre' }}>{suggestionCode}</span>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
      )}

      <div className="comment-form-actions">
        {showSeverity && (
          <div className="comment-form-severity" data-severity={severity}>
            <span className="comment-form-severity-label">Severity</span>
            <SeveritySelect value={severity} onChange={setSeverity} />
          </div>
        )}
        <div className="comment-form-actions-right">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSubmit}
            disabled={!body.trim()}
          >
            {initialBody ? 'Save' : 'Comment'}
          </button>
        </div>
      </div>
    </div>
  )
}
