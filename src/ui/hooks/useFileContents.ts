import { useEffect, useState } from 'react'

export interface FileContentsState {
  loading: boolean
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

async function fetchVersion(path: string, version: Version): Promise<string | null> {
  const res = await fetch(`/api/file-text?path=${encodeURIComponent(path)}&version=${version}`)
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
    error: null,
    oldContent: null,
    newContent: null,
  })

  useEffect(() => {
    if (!enabled || !filePath) return

    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))

    Promise.all([fetchVersion(oldFilePath, 'old'), fetchVersion(filePath, 'new')])
      .then(([oldContent, newContent]) => {
        if (cancelled) return
        setState({ loading: false, error: null, oldContent, newContent })
      })
      .catch((err: Error) => {
        if (cancelled) return
        setState({
          loading: false,
          error: err.message,
          oldContent: null,
          newContent: null,
        })
      })

    return () => {
      cancelled = true
    }
  }, [filePath, oldFilePath, enabled])

  return state
}
