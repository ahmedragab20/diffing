import { memo, useEffect, useRef, useState } from 'react'
import { UnresolvedFile } from '@pierre/diffs/react'
import type {
  FileContents,
  MergeConflictResolution,
} from '@pierre/diffs'
import { GitMerge, Save, Loader2, CheckCircle2, AlertCircle, Check, X, Plus } from 'lucide-react'
import { SHIKI_THEME_MAP } from '../utils'

interface MergeConflictResolverProps {
  filePath: string
  theme: string
  fontSize: number
  tabSize: number
  /** Refetch the diff once the user saves a resolution. */
  onSaved: () => void
}

interface FetchState {
  loading: boolean
  error: string | null
  file: FileContents | null
}

const RESOLUTION_LABELS: Record<
  MergeConflictResolution,
  { label: string; icon: typeof Check; title: string }
> = {
  current: { label: 'Current', icon: Check, title: 'Keep the current/HEAD side' },
  incoming: { label: 'Incoming', icon: X, title: 'Keep the incoming side' },
  both: { label: 'Both', icon: Plus, title: 'Keep both sides (current then incoming)' },
}

export const MergeConflictResolver = memo(function MergeConflictResolver({
  filePath,
  theme,
  fontSize,
  tabSize,
  onSaved,
}: MergeConflictResolverProps) {
  const shikiConfig = SHIKI_THEME_MAP[theme] || SHIKI_THEME_MAP.nord
  const [state, setState] = useState<FetchState>({
    loading: true,
    error: null,
    file: null,
  })
  // Resolved file contents accumulate as the user resolves each conflict.
  const [resolvedFile, setResolvedFile] = useState<FileContents | null>(null)
  const [resolvedCount, setResolvedCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // The instance is captured via renderMergeConflictUtility's getInstance().
  // We keep a ref to it so we can call resolveConflict imperatively from
  // our React buttons.
  const instanceRef = useRef<any>(null)

  useEffect(() => {
    let cancelled = false
    setState({ loading: true, error: null, file: null })
    setResolvedFile(null)
    setResolvedCount(0)
    setSaved(false)
    setSaveErr(null)
    fetch(`/api/file-text?path=${encodeURIComponent(filePath)}&version=new`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return
        if (json.error) {
          setState({ loading: false, error: json.error, file: null })
          return
        }
        setState({
          loading: false,
          error: null,
          file: { name: filePath, contents: json.content ?? '' },
        })
      })
      .catch((err: Error) => {
        if (cancelled) return
        setState({ loading: false, error: err.message, file: null })
      })
    return () => {
      cancelled = true
    }
  }, [filePath])

  const handleResolveClick = (
    conflictIndex: number,
    resolution: MergeConflictResolution,
  ) => {
    const instance = instanceRef.current
    if (!instance) return
    const result = instance.resolveConflict(conflictIndex, resolution)
    if (result && result.file) {
      setResolvedFile(result.file)
      setResolvedCount((n) => n + 1)
    }
  }

  const handleSave = async () => {
    const file = resolvedFile ?? state.file
    if (!file) return
    setSaving(true)
    setSaveErr(null)
    try {
      const res = await fetch('/api/save-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath,
          content: file.contents,
          gitAdd: true,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setSaved(true)
      onSaved()
    } catch (err: any) {
      setSaveErr(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (state.loading) {
    return (
      <div className="merge-conflict-card merge-conflict-card-loading">
        <Loader2 size={14} className="spin" />
        <span>Loading {filePath}…</span>
      </div>
    )
  }
  if (state.error || !state.file) {
    return (
      <div className="merge-conflict-card merge-conflict-card-error">
        <AlertCircle size={14} />
        <span>Could not load {filePath}: {state.error ?? 'unknown error'}</span>
      </div>
    )
  }

  return (
    <div className="merge-conflict-card">
      <div className="merge-conflict-header">
        <div className="merge-conflict-title">
          <GitMerge size={14} />
          <span className="merge-conflict-name" title={filePath}>{filePath}</span>
        </div>
        <div className="merge-conflict-actions">
          {resolvedCount > 0 && (
            <span className="merge-conflict-status">
              {resolvedCount} resolution{resolvedCount === 1 ? '' : 's'} pending
            </span>
          )}
          <button
            className="file-diff-edit-btn"
            onClick={handleSave}
            disabled={saving || saved}
            title="Write the resolved file to disk and `git add` it"
          >
            {saving ? (
              <Loader2 size={11} className="spin" />
            ) : saved ? (
              <CheckCircle2 size={11} />
            ) : (
              <Save size={11} />
            )}
            <span>
              {saving ? 'Saving…' : saved ? 'Saved + staged' : 'Save & stage'}
            </span>
          </button>
        </div>
      </div>
      {saveErr && (
        <div className="merge-conflict-card-error" role="alert">
          <AlertCircle size={14} />
          <span>{saveErr}</span>
        </div>
      )}
      <UnresolvedFile
        file={resolvedFile ?? state.file}
        options={{
          disableFileHeader: true,
          enableGutterUtility: false,
          mergeConflictActionsType: 'custom',
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
              --diffs-line-height: ${Math.round(fontSize * 1.7)}px !important;
            }
          `,
        }}
        renderMergeConflictUtility={(action, getInstance) => {
          // Capture the imperative instance so our buttons can call
          // resolveConflict on it.
          const inst = getInstance()
          if (inst) instanceRef.current = inst
          return (
            <div className="merge-conflict-buttons">
              {(['current', 'incoming', 'both'] as MergeConflictResolution[]).map(
                (resolution) => {
                  const { label, icon: Icon, title } = RESOLUTION_LABELS[resolution]
                  return (
                    <button
                      key={resolution}
                      type="button"
                      className={`merge-conflict-btn merge-conflict-btn-${resolution}`}
                      title={title}
                      onClick={() => handleResolveClick(action.conflictIndex, resolution)}
                    >
                      <Icon size={11} />
                      <span>{label}</span>
                    </button>
                  )
                },
              )}
            </div>
          )
        }}
      />
    </div>
  )
})
