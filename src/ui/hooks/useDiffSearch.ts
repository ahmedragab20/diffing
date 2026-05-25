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
        const additionOffset = hunk.additionLineIndex
        const additionCount = hunk.additionCount
        if (additionCount > 0) {
          const additionSlice = file.additionLines.slice(additionOffset, additionOffset + additionCount)
          for (let i = 0; i < additionSlice.length; i++) {
            const line = additionSlice[i]
            if (line.trim()) {
              entries.push({
                filePath: file.name,
                lineNumber: hunk.additionStart + i,
                side: 'additions',
                content: line,
              })
            }
          }
        }

        const deletionOffset = hunk.deletionLineIndex
        const deletionCount = hunk.deletionCount
        if (deletionCount > 0) {
          const deletionSlice = file.deletionLines.slice(deletionOffset, deletionOffset + deletionCount)
          for (let i = 0; i < deletionSlice.length; i++) {
            const line = deletionSlice[i]
            if (line.trim()) {
              entries.push({
                filePath: file.name,
                lineNumber: hunk.deletionStart + i,
                side: 'deletions',
                content: line,
              })
            }
          }
        }
      }
    }

    return entries
  }, [files])
}
