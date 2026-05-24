import { useState, useRef, useEffect } from 'react'
import { parseMarkdown } from '../utils'

interface CommentFormProps {
  onSubmit: (body: string) => void
  onCancel: () => void
}

export function CommentForm({ onSubmit, onCancel }: CommentFormProps) {
  const [body, setBody] = useState('')
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
          placeholder="Leave a review comment (supports Markdown)..."
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
      )}

      <div className="comment-form-actions">
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={!body.trim()}>
          Comment
        </button>
      </div>
    </div>
  )
}
