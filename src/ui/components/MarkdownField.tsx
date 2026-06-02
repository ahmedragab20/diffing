import { useEffect, useRef, useState } from 'react'
import { Markdown } from './Markdown'

interface MarkdownFieldProps {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  ariaLabel?: string
  /** Class applied to the textarea so a host can keep its own field styling. */
  textareaClassName?: string
  /** Fired on Cmd/Ctrl+Enter so the host can submit the surrounding form. */
  onSubmitShortcut?: () => void
}

/**
 * Compact, controlled markdown editor with the same Write/Preview tabs and
 * clipboard-image paste as {@link CommentForm}, minus the submit/cancel chrome.
 * It gives an "overall comment" field identical markdown support to inline
 * comments and replies while the host keeps ownership of its own actions.
 */
export function MarkdownField({
  id,
  value,
  onChange,
  placeholder,
  rows = 3,
  ariaLabel,
  textareaClassName,
  onSubmitShortcut,
}: MarkdownFieldProps) {
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Mirror the latest value so an async image upload can patch the placeholder
  // it inserted even after further edits, despite this being a controlled field.
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])

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

    // Upload the image and reference it by URL rather than inlining a base64
    // data URL. A unique token lets concurrent pastes resolve independently.
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const token = Math.random().toString(36).slice(2, 8)
    const placeholder = `![Uploading image… ${token}]()`
    const next = value.slice(0, start) + placeholder + value.slice(end)
    onChange(next)
    valueRef.current = next

    try {
      const form = new FormData()
      form.append('file', imageFile, imageFile.name || `pasted-${token}.png`)
      const res = await fetch('/api/attachments', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { url?: string; error?: string }
      if (!data.url) throw new Error(data.error || 'Upload failed')
      onChange(valueRef.current.replace(placeholder, `![pasted image](${data.url})`))
    } catch (err) {
      console.error('Image upload failed:', err)
      onChange(valueRef.current.replace(placeholder, '![upload failed]()'))
    }
  }

  return (
    <div className="md-field">
      <div className="comment-form-tabs" role="tablist" aria-label="Markdown editor mode">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'write'}
          onClick={() => setTab('write')}
          onKeyDown={(e) => { if (e.key === 'ArrowRight') { e.preventDefault(); setTab('preview') } }}
          className={`comment-form-tab-btn ${tab === 'write' ? 'comment-form-tab-btn-active' : 'comment-form-tab-btn-inactive'}`}
        >
          Write
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'preview'}
          onClick={() => setTab('preview')}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); setTab('write') } }}
          className={`comment-form-tab-btn ${tab === 'preview' ? 'comment-form-tab-btn-active' : 'comment-form-tab-btn-inactive'}`}
        >
          Preview
        </button>
      </div>

      {tab === 'write' ? (
        <textarea
          id={id}
          ref={textareaRef}
          className={textareaClassName}
          value={value}
          rows={rows}
          placeholder={placeholder}
          aria-label={ariaLabel}
          onChange={(e) => onChange(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              onSubmitShortcut?.()
            }
          }}
        />
      ) : (
        <div
          className="md-field-preview markdown-body"
          role="tabpanel"
          aria-label="Markdown preview"
        >
          {value.trim() ? (
            <Markdown content={value} />
          ) : (
            <span className="md-field-empty">Nothing to preview</span>
          )}
        </div>
      )}
    </div>
  )
}
