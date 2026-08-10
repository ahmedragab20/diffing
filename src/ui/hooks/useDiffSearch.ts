import { useMemo } from 'react'
import type { FileDiffMetadata } from '@pierre/diffs'

export interface DiffLineEntry {
  filePath: string
  lineNumber: number
  side: 'additions' | 'deletions'
  content: string
}

/**
 * Search corpus for the find-in-file bar: every searchable line of one diff
 * file — additions, deletions, AND unchanged context lines within hunks.
 *
 * Context lines are emitted once, on the additions side, with their new-file
 * line number: in unified mode pierre renders them with the new-file
 * `data-line`, and `scrollToLine` falls back to line-number matching when the
 * line type isn't addition/deletion. Emitting both sides would double-count
 * the same visible line as two hits.
 */
export function buildFileSearchEntries(file: FileDiffMetadata): DiffLineEntry[] {
  const entries: DiffLineEntry[] = []
  for (const hunk of file.hunks) {
    for (const segment of hunk.hunkContent) {
      if (segment.type === 'change') {
        for (let i = 0; i < segment.additions; i++) {
          const idx = segment.additionLineIndex + i
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
        for (let i = 0; i < segment.deletions; i++) {
          const idx = segment.deletionLineIndex + i
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
      } else {
        // Unchanged context block — searchable, new-file numbering.
        for (let i = 0; i < segment.lines; i++) {
          const idx = segment.additionLineIndex + i
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
    }
  }
  return entries
}

/** Build the find-in-file corpus for a set of diff files (changed + context). */
export function buildFileSearchCorpus(files: FileDiffMetadata[]): DiffLineEntry[] {
  return files.flatMap(buildFileSearchEntries)
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
