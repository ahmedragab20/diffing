import { useState, useRef, useEffect } from 'react'
import { parseMarkdown } from '../utils'

interface CommentFormProps {
  initialBody?: string
  lineContent?: string
  onSubmit: (body: string) => void
  onCancel: () => void
}

export function CommentForm({ initialBody, lineContent, onSubmit, onCancel }: CommentFormProps) {
  const [body, setBody] = useState(initialBody || '')
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (activeTab === 'write') {
      textareaRef.current?.focus()
    }
  }, [activeTab])

  const handleSubmit = () => {
    const trimmed = body.trim()
    if (trimmed) {
      onSubmit(trimmed)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
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

    if (imageFile) {
      e.preventDefault()

      const textarea = textareaRef.current
      if (!textarea) return

      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const placeholder = '![Uploading image...]()'
      const val = textarea.value

      const nextValue = val.slice(0, start) + placeholder + val.slice(end)
      setBody(nextValue)

      const formData = new FormData()
      formData.append('file', imageFile)

      try {
        const res = await fetch('/api/attachments', {
          method: 'POST',
          body: formData,
        })
        const data = await res.json()
        if (data.url) {
          const markdownImage = `![Pasted Image](${data.url})`
          setBody((prev) => prev.replace(placeholder, markdownImage))
        } else {
          setBody(val.slice(0, start) + val.slice(end))
        }
      } catch {
        setBody(val.slice(0, start) + val.slice(end))
      }
    }
  }

  return (
    <div className="comment-form" style={{ padding: '16px' }}>
      {/* Tab Buttons */}
      <div 
        className="comment-form-tabs" 
        style={{ 
          display: 'flex', 
          gap: '8px', 
          borderBottom: '1px solid var(--border-color)', 
          marginBottom: '12px',
          paddingBottom: '4px'
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('write')}
          style={{
            background: 'none',
            border: 'none',
            padding: '6px 12px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            color: activeTab === 'write' ? 'var(--text-primary)' : 'var(--text-muted)',
            borderBottom: activeTab === 'write' ? '2px solid var(--primary)' : '2px solid transparent',
            marginBottom: '-6px',
            transition: 'color 0.15s ease'
          }}
        >
          Write
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('preview')}
          style={{
            background: 'none',
            border: 'none',
            padding: '6px 12px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            color: activeTab === 'preview' ? 'var(--text-primary)' : 'var(--text-muted)',
            borderBottom: activeTab === 'preview' ? '2px solid var(--primary)' : '2px solid transparent',
            marginBottom: '-6px',
            transition: 'color 0.15s ease'
          }}
        >
          Preview
        </button>
      </div>

      {activeTab === 'write' ? (
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Leave a review comment (supports Markdown and Pasting Clipboard Images)..."
          rows={4}
          style={{
            width: '100%',
            padding: '10px 14px',
            fontFamily: 'var(--font-sans)',
            fontSize: '14px',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            resize: 'vertical',
            outline: 'none',
            minHeight: '100px'
          }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
                  padding: '10px 14px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  background: 'var(--bg-primary)',
                  fontSize: '14px',
                  lineHeight: 1.6,
                  color: 'var(--text-primary)',
                  overflowY: 'auto'
                }}
                dangerouslySetInnerHTML={{ 
                  __html: body.trim() ? parseMarkdown(body) : '<span style="color: var(--text-muted); font-style: italic;">Nothing to preview</span>' 
                }}
              />
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
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  background: 'var(--bg-primary)'
                }}
              >
                <div 
                  className="suggestion-header" 
                  style={{
                    padding: '8px 12px',
                    background: 'var(--bg-tertiary)',
                    borderBottom: '1px solid var(--border-color)',
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
                        background: 'rgba(191, 97, 106, 0.08)', 
                        borderBottom: '1px dashed var(--border-color)',
                        color: 'var(--danger)',
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
                      background: 'rgba(163, 190, 140, 0.08)',
                      color: 'var(--success)',
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
