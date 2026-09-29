import { useCallback, useEffect, useState } from 'react'

export interface FileContentsState {
  loading: boolean
  loaded: boolean
  error: string | null
  oldContent: string | null
  newContent: string | null
}

type Version = 'old' | 'new'

interface FetchResult {
  content?: string
  missing?: boolean
  error?: string
}

async function fetchVersion(path: string, version: Version, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(`/api/file-text?path=${encodeURIComponent(path)}&version=${version}`, { signal })
  if (!res.ok) {
    if (res.status === 404) return null
    throw new Error(`HTTP ${res.status} fetching ${version} ${path}`)
  }
  const json = (await res.json()) as FetchResult
  if (json.missing) return null
  if (json.error) throw new Error(json.error)
  return json.content ?? ''
}

/**
 * Lazy-loads the old and new versions of a file's text. Used to upgrade a
 * partial patch render to a MultiFileDiff render so hunk context becomes
 * expandable. Pass `enabled=false` until the user opts in.
 */
export function useFileContents(filePath: string, enabled: boolean, oldFilePath = filePath) {
  const [state, setState] = useState<FileContentsState>({
    loading: false,
    loaded: false,
    error: null,
    oldContent: null,
    newContent: null,
  })
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!enabled || !filePath) return

    let cancelled = false
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))

    Promise.all([fetchVersion(oldFilePath, 'old', controller.signal), fetchVersion(filePath, 'new', controller.signal)])
      .then(([oldContent, newContent]) => {
        if (cancelled) return
        setState({ loading: false, loaded: true, error: null, oldContent, newContent })
      })
      .catch((err: Error) => {
        if (cancelled) return
        controller.abort()
        setState({
          loading: false,
          loaded: true,
          error: err.message,
          oldContent: null,
          newContent: null,
        })
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [filePath, oldFilePath, enabled, refreshKey])

  /**
   * Re-fetch both versions. Used when the working tree changed under an
   * expanded/editing card (e.g. an edit session save or a reverted hunk) so
   * the full-context render never shows content from before the mutation.
   */
  const refetch = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  return { ...state, refetch }
}
