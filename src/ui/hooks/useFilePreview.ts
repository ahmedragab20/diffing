import { useQuery } from '@tanstack/react-query'

export interface FilePreviewState {
  content: string | null
  /** The file has no working-tree version (e.g. deleted). */
  missing: boolean
  /** The file is binary and cannot be previewed as text. */
  binary: boolean
}

/**
 * Lazily fetch the working-tree text of a file for the palette's preview pane.
 * Reuses the existing `/api/file-text` endpoint (path-traversal guarded server
 * side). Cached by path so re-opening a preview is instant; content is treated
 * as stable for the review session.
 */
export function useFilePreview(path: string | null) {
  return useQuery<FilePreviewState>({
    queryKey: ['file-text', path],
    enabled: !!path,
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ signal }): Promise<FilePreviewState> => {
      const res = await fetch(`/api/file-text?path=${encodeURIComponent(path!)}&version=new`, { signal })
      // The endpoint replies 415 for binary files.
      if (res.status === 415) return { content: null, missing: false, binary: true }
      if (!res.ok) throw new Error(`Failed to load file (${res.status})`)
      const json = (await res.json()) as { content?: string; missing?: boolean; error?: string }
      if (json.error) {
        if (/binary/i.test(json.error)) return { content: null, missing: false, binary: true }
        throw new Error(json.error)
      }
      if (json.missing) return { content: null, missing: true, binary: false }
      return { content: json.content ?? '', missing: false, binary: false }
    },
  })
}
