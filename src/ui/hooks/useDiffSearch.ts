import { useMemo } from 'react'
import type { FileDiffMetadata } from '@pierre/diffs'

export interface DiffLineEntry {
  filePath: string
  lineNumber: number
  side: 'additions' | 'deletions'
  content: string
}

export function useDiffSearch(files: FileDiffMetadata[]): DiffLineEntry[] {
  return useMemo(() => {
    const entries: DiffLineEntry[] = []

    for (const file of files) {
      for (const hunk of file.hunks) {
        for (const segment of hunk.hunkContent) {
          // Only compile search entries from actual change blocks (not context blocks)
          if (segment.type === 'change') {
            // Additions
            if (segment.additions > 0) {
              const startIdx = segment.additionLineIndex
              const count = segment.additions
              for (let i = 0; i < count; i++) {
                const idx = startIdx + i
                const line = file.additionLines[idx]
                if (line && line.trim()) {
                  entries.push({
                    filePath: file.name,
                    lineNumber: hunk.additionStart + (idx - hunk.additionLineIndex),
                    side: 'additions',
                    content: line,
                  })
                }
              }
            }

            // Deletions
            if (segment.deletions > 0) {
              const startIdx = segment.deletionLineIndex
              const count = segment.deletions
              for (let i = 0; i < count; i++) {
                const idx = startIdx + i
                const line = file.deletionLines[idx]
                if (line && line.trim()) {
                  entries.push({
                    filePath: file.name,
                    lineNumber: hunk.deletionStart + (idx - hunk.deletionLineIndex),
                    side: 'deletions',
                    content: line,
                  })
                }
              }
            }
          }
        }
      }
    }

    return entries
  }, [files])
}
