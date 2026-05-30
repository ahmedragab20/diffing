import { memo } from 'react'
import { X, FileText, Loader2 } from 'lucide-react'
import { Modal } from '../primitives/Modal'
import { useFilePreview } from '../hooks/useFilePreview'

interface FilePreviewModalProps {
  isOpen: boolean
  filePath: string | null
  onClose: () => void
}

export const FilePreviewModal = memo(function FilePreviewModal({
  isOpen,
  filePath,
  onClose,
}: FilePreviewModalProps) {
  const { data, isLoading, error } = useFilePreview(filePath)

  const fileName = filePath ? filePath.split('/').pop() : ''

  return (
    <Modal open={isOpen} onClose={onClose} className="shortcuts-modal file-preview-modal" ariaLabel="File preview">
      <div className="shortcuts-header">
        <div className="shortcuts-header-title">
          <FileText size={18} className="shortcuts-icon" />
          <h2>Preview: {fileName}</h2>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>{filePath}</span>
        </div>
        <button className="shortcuts-close-btn" onClick={onClose} aria-label="Close dialog">
          <X size={16} />
        </button>
      </div>

      <div className="shortcuts-body" style={{ maxHeight: '60vh', display: 'flex', flexDirection: 'column' }}>
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', gap: '8px', color: 'var(--text-muted)' }}>
            <Loader2 size={16} className="spin" />
            <span>Loading file content...</span>
          </div>
        )}
        {error && (
          <div style={{ padding: '20px', color: 'var(--danger)', background: 'var(--feedback-danger-bg)', borderRadius: '6px' }}>
            Failed to load file: {error.message || String(error)}
          </div>
        )}
        {data && (
          <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-normal)' }}>
            {data.binary ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                Binary file cannot be previewed.
              </div>
            ) : data.missing ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                File does not exist or has been deleted.
              </div>
            ) : (
              <pre style={{ margin: 0, padding: '16px', fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: '1.6', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                <code>{data.content}</code>
              </pre>
            )}
          </div>
        )}
      </div>

      <div className="shortcuts-footer" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-sm btn-primary" onClick={onClose}>
          Close Preview
        </button>
      </div>
    </Modal>
  )
})
