import { memo, useMemo } from 'react'
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
  expandContextByDefault: boolean
  collapsedContextThreshold: number
  expansionLineCount: number
  onViewedChange: (filePath: string, viewed: boolean) => void
  fileAnnotationsMap: Map<string, DiffLineAnnotation<ReviewComment>[]>
  onAddComment: (filePath: string, side: AnnotationSide, lineNumber: number, lineContent: string, body: string, startLineNumber?: number) => void
  onDeleteComment: (id: string) => void
}

const emptyAnnotations: DiffLineAnnotation<ReviewComment>[] = []

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
  expandContextByDefault,
  collapsedContextThreshold,
  expansionLineCount,
  onViewedChange,
  fileAnnotationsMap,
  onAddComment,
  onDeleteComment,
}: DiffViewerProps) {
  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
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
    })
  }, [files])

  if (sortedFiles.length === 0) {
    return (
      <div className="empty-state">
        <p>No changes found.</p>
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
            expandContextByDefault={expandContextByDefault}
            collapsedContextThreshold={collapsedContextThreshold}
            expansionLineCount={expansionLineCount}
            onViewedChange={onViewedChange}
            onAddComment={onAddComment}
            onDeleteComment={onDeleteComment}
          />
        )
      })}
    </div>
  )
})
