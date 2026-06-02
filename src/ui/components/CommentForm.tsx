import { useState, useRef, useEffect } from 'react'
import { Markdown } from './Markdown'
import { getDraft, setDraft, clearDraft } from '../drafts'
import { useFeedback } from '../hooks/useHaptics'

interface CommentFormProps {
  initialBody?: string
  lineContent?: string
  draftKey?: string
  onSubmit: (body: string) => void
  onCancel: () => void
}

export function CommentForm({ initialBody, lineContent, draftKey, onSubmit, onCancel }: CommentFormProps) {
  const { haptic, sound } = useFeedback()
  const [body, setBody] = useState(() => {
    if (draftKey) {
      const draft = getDraft(draftKey)
      if (draft) return draft
    }
    return initialBody || ''
  })
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (activeTab === 'write') {
      textareaRef.current?.focus()
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
      onSubmit(trimmed)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
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

  return (
    <div className="comment-form" style={{ padding: '16px' }} role="form" aria-label="Comment form">
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
        <textarea
          id="comment-write-panel"
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Leave a review comment (supports Markdown and Pasting Clipboard Images)..."
          rows={4}
          aria-label="Comment body"
          style={{ minHeight: '100px' }}
        />
      ) : (
        <div id="comment-preview-panel" role="tabpanel" aria-label="Preview" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
                  <Markdown content={body} />
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

      <div className="comment-form-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={!body.trim()}>
          {initialBody ? 'Save' : 'Comment'}
        </button>
      </div>
    </div>
  )
}
