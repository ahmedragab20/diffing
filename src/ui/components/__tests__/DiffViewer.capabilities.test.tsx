// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../FileDiffCard', () => ({
  FileDiffCard: ({ allowLocalActions, existingComments }: { allowLocalActions?: boolean; existingComments?: unknown[] }) => (
    <div>
      {allowLocalActions ? 'local actions enabled' : 'local actions disabled'}
      <span>published threads: {existingComments?.length ?? 0}</span>
    </div>
  ),
}))
vi.mock('../BinaryFileDiff', () => ({ BinaryFileDiff: () => null }))

import { DiffViewer } from '../DiffViewer'

const file = {
  name: 'src/example.ts',
  type: 'change',
  hunks: [],
  splitLineCount: 0,
  unifiedLineCount: 0,
  isPartial: true,
  deletionLines: [],
  additionLines: [],
} as any

function renderViewer(allowLocalActions?: boolean, existingCommentsMap?: Map<string, any[]>) {
  return render(
    <DiffViewer
      files={[file]}
      diffStyle="unified"
      tabSizeMap={{}}
      defaultTabSize={4}
      viewedFiles={new Set()}
      binaryFiles={new Map()}
      theme="rose-pine"
      lineDiffType="word"
      lineWrap={false}
      diffIndicators="classic"
      showLineNumbers
      hunkSeparators="line-info"
      lineHoverHighlight="both"
      fontSize={13}
      monoFontFamily="monospace"
      expandContextByDefault={false}
      collapsedContextThreshold={10}
      expansionLineCount={20}
      autoCollapseLineThreshold={400}
      onViewedChange={vi.fn()}
      fileAnnotationsMap={new Map()}
      existingCommentsMap={existingCommentsMap}
      onAddComment={vi.fn()}
      onDeleteComment={vi.fn()}
      allowLocalActions={allowLocalActions}
    />,
  )
}

describe('DiffViewer review-surface capabilities', () => {
  it('keeps local actions on by default for the local review', () => {
    renderViewer()
    expect(screen.getByText('local actions enabled')).toBeInTheDocument()
  })

  it('lets PR review explicitly disable local mutations', () => {
    renderViewer(false)
    expect(screen.getByText('local actions disabled')).toBeInTheDocument()
  })

  it('passes published GitHub threads into the file diff for inline anchoring', () => {
    renderViewer(false, new Map([['src/example.ts', [{ id: 101 }]]]))
    expect(screen.getByText('published threads: 1')).toBeInTheDocument()
  })
})
