import { memo, useMemo } from 'react'
import { GitCompare } from 'lucide-react'
import type { FileDiffMetadata, DiffLineAnnotation, AnnotationSide } from '@pierre/diffs'
import type { ReviewComment } from '../../lib/types'
import type { BinaryFileInfo } from '../hooks/useDiff'
import type {
  LineDiffType,
  DiffIndicators,
  HunkSeparatorStyle,
  LineHoverHighlight,
} from '../hooks/useSettings'
import { FileDiffCard } from './FileDiffCard'
import { BinaryFileDiff } from './BinaryFileDiff'

interface DiffViewerProps {
  files: FileDiffMetadata[]
  diffStyle: 'split' | 'unified'
  tabSizeMap: Record<string, number>
  defaultTabSize: number
  viewedFiles: Set<string>
  binaryFiles: Map<string, BinaryFileInfo>
  theme: string
  editorIDE?: string
  lineDiffType: LineDiffType
  lineWrap: boolean
  diffIndicators: DiffIndicators
  showLineNumbers: boolean
  hunkSeparators: HunkSeparatorStyle
  lineHoverHighlight: LineHoverHighlight
  fontSize: number
  monoFontFamily: string
  expandContextByDefault: boolean
  collapsedContextThreshold: number
  expansionLineCount: number
  autoCollapseLineThreshold: number
  onViewedChange: (filePath: string, viewed: boolean) => void
  fileAnnotationsMap: Map<string, DiffLineAnnotation<ReviewComment>[]>
  onAddComment: (filePath: string, side: AnnotationSide, lineNumber: number, lineContent: string, body: string, startLineNumber?: number) => void
  onDeleteComment: (id: string) => void
  /**
   * Fired by `<FileDiffCard>` right after the user toggles the card's
   * collapsed state by clicking the header. The viewer does not care
   * about the value — it just passes it through. App.tsx uses this to
   * drive the auto-advance-to-next-file scroll.
   */
  onCardToggleCollapse?: (filePath: string, willCollapse: boolean) => void
}

const emptyAnnotations: DiffLineAnnotation<ReviewComment>[] = []

/**
 * Shared file-name comparator used by `<DiffViewer>` and by App.tsx when
 * it pre-sorts the file list for `useScrollToNextFile`. Exposed so the
 * "scroll to next file" hook and the rendered card list always walk the
 * same order — a divergence here would let the hook pick a different
 * "next" than what the user can see on screen.
 *
 * Sort rules (unchanged from the previous inline implementation):
 *   - Compare path components left-to-right.
 *   - Directory prefixes come before their descendants.
 *   - Within the same depth, `localeCompare` decides.
 *   - Shorter paths come before longer ones at the same prefix.
 */
export function sortFilesByName(a: FileDiffMetadata, b: FileDiffMetadata): number {
  const partsA = a.name.split('/')
  const partsB = b.name.split('/')
  const len = Math.min(partsA.length, partsB.length)
  for (let i = 0; i < len; i++) {
    const aIsDir = i < partsA.length - 1
    const bIsDir = i < partsB.length - 1
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
    const cmp = partsA[i].localeCompare(partsB[i])
    if (cmp !== 0) return cmp
  }
  return partsA.length - partsB.length
}

export const DiffViewer = memo(function DiffViewer({
  files,
  diffStyle,
  tabSizeMap,
  defaultTabSize,
  viewedFiles,
  binaryFiles,
  theme,
  editorIDE,
  lineDiffType,
  lineWrap,
  diffIndicators,
  showLineNumbers,
  hunkSeparators,
  lineHoverHighlight,
  fontSize,
  monoFontFamily,
  expandContextByDefault,
  collapsedContextThreshold,
  expansionLineCount,
  autoCollapseLineThreshold,
  onViewedChange,
  fileAnnotationsMap,
  onAddComment,
  onDeleteComment,
  onCardToggleCollapse,
}: DiffViewerProps) {
  const sortedFiles = useMemo(() => {
    return [...files].sort(sortFilesByName)
  }, [files])

  if (sortedFiles.length === 0) {
    return (
      <div className="empty-state" role="status">
        <div className="empty-state-icon" aria-hidden="true">
          <GitCompare size={24} strokeWidth={1.75} />
        </div>
        <p className="empty-state-title">All clean</p>
        <p className="empty-state-hint">
          No changes found. Stage, edit, or pick a different range to review.
        </p>
      </div>
    )
  }

  return (
    <div className="diff-viewer">
      {sortedFiles.map((file, index) => {
        const filePath = file.name
        const binaryInfo = binaryFiles.get(filePath)
        if (binaryInfo) {
          return (
            <BinaryFileDiff
              key={`${filePath}-${index}`}
              filePath={filePath}
              info={binaryInfo}
              viewed={viewedFiles.has(filePath)}
              onViewedChange={onViewedChange}
            />
          )
        }
        return (
          <FileDiffCard
            key={`${filePath}-${index}`}
            id={`file-${filePath}`}
            fileDiff={file}
            filePath={filePath}
            annotations={fileAnnotationsMap.get(filePath) ?? emptyAnnotations}
            diffStyle={diffStyle}
            tabSize={tabSizeMap[filePath] ?? defaultTabSize}
            viewed={viewedFiles.has(filePath)}
            theme={theme}
            editorIDE={editorIDE}
            lineDiffType={lineDiffType}
            lineWrap={lineWrap}
            diffIndicators={diffIndicators}
            showLineNumbers={showLineNumbers}
            hunkSeparators={hunkSeparators}
            lineHoverHighlight={lineHoverHighlight}
            fontSize={fontSize}
            monoFontFamily={monoFontFamily}
            expandContextByDefault={expandContextByDefault}
            collapsedContextThreshold={collapsedContextThreshold}
            expansionLineCount={expansionLineCount}
            autoCollapseLineThreshold={autoCollapseLineThreshold}
            onViewedChange={onViewedChange}
            onAddComment={onAddComment}
            onDeleteComment={onDeleteComment}
            onCardToggleCollapse={onCardToggleCollapse}
          />
        )
      })}
    </div>
  )
})
