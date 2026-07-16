import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react'
import {
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import type { FileDiffMetadata } from '@pierre/diffs'
import { FileTree as PierreFileTree, useFileTree } from '@pierre/trees/react'
import type { FileTreeRowDecorationRenderer, GitStatusEntry, GitStatus } from '@pierre/trees'
import { Tooltip } from '../primitives/Tooltip'
import {
  sanitizePaths,
  buildExpandedPaths,
} from '../lib/treePathSanitize'
import { FileTreeErrorBoundary } from './FileTreeErrorBoundary'

interface FileTreeProps {
  files: FileDiffMetadata[]
  activeFile: string | null
  commentCounts: Record<string, number>
  viewedFiles: Set<string>
  untrackedFiles: Set<string>
  onFileClick: (filePath: string) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export const FileTree = memo(function FileTree({
  files,
  activeFile,
  commentCounts,
  viewedFiles,
  untrackedFiles,
  onFileClick,
  collapsed,
  onToggleCollapse,
}: FileTreeProps) {
  const [filter, setFilter] = useState('')

  // Map files to paths required by @pierre/trees, deduping and resolving
  // file↔directory collisions so the underlying tree model never sees a
  // colliding path (which would throw "Path collides with an existing entry").
  const { paths, dropped } = useMemo(
    () => sanitizePaths(files.map((f) => f.name)),
    [files],
  )

  const pathsSet = useMemo(() => new Set(paths), [paths])

  const expandedPaths = useMemo(() => buildExpandedPaths(paths), [paths])

  // Map file change type to GitStatusEntry
  const gitStatus = useMemo<GitStatusEntry[]>(() => {
    return files
      .filter((file) => pathsSet.has(file.name))
      .map((file) => {
      let status: GitStatus = 'modified'
      if (untrackedFiles.has(file.name)) {
        status = 'untracked'
      } else if (file.prevName) {
        status = 'renamed'
      } else {
        const prev = file.prevObjectId
        const next = file.newObjectId
        if (prev === '0000000' || prev === '0000000000000000000000000000000000000000') {
          status = 'added'
        } else if (next === '0000000' || next === '0000000000000000000000000000000000000000') {
          status = 'deleted'
        }
      }
      return { path: file.name, status }
    })
  }, [files, untrackedFiles, pathsSet])

  // Keep a ref of viewedFiles and commentCounts to avoid recreating renderRowDecoration
  // and maintain absolute freshness on virtualized list updates.
  const decorationStateRef = useRef({ commentCounts, viewedFiles })
  decorationStateRef.current = { commentCounts, viewedFiles }

  const renderRowDecoration = useCallback<FileTreeRowDecorationRenderer>((context) => {
    const path = context.item.path
    const { commentCounts: latestComments, viewedFiles: latestViewed } = decorationStateRef.current
    const isViewed = latestViewed.has(path)
    const count = latestComments[path] ?? 0

    if (isViewed && count > 0) {
      return {
        text: `✓ 💬 ${count}`,
        title: `Viewed, ${count} comment${count > 1 ? 's' : ''}`,
      }
    } else if (isViewed) {
      return {
        text: `✓`,
        title: `Viewed`,
      }
    } else if (count > 0) {
      return {
        text: `💬 ${count}`,
        title: `${count} comment${count > 1 ? 's' : ''}`,
      }
    }
    return null
  }, [])

  // Initialize @pierre/trees model
  const { model } = useFileTree({
    paths,
    fileTreeSearchMode: 'hide-non-matches',
    gitStatus,
    renderRowDecoration,
    initialSelectedPaths:
      activeFile && pathsSet.has(activeFile) ? [activeFile] : [],
    initialExpandedPaths: expandedPaths,
    onSelectionChange: (selectedPaths) => {
      if (selectedPaths.length > 0 && selectedPaths[0] !== activeFile) {
        onFileClick(selectedPaths[0])
      }
    },
  })

  // Synchronize paths update on model
  useEffect(() => {
    model.resetPaths(paths, { initialExpandedPaths: expandedPaths })
  }, [paths, expandedPaths, model])

  // Synchronize git status and force redraw of decorations when comments/viewed states change
  useEffect(() => {
    model.setGitStatus(gitStatus)
  }, [gitStatus, commentCounts, viewedFiles, model])

  // Synchronize activeFile selection and viewport scroll
  useEffect(() => {
    if (!activeFile || !pathsSet.has(activeFile)) return
    try {
      model.focusPath(activeFile)
      model.scrollToPath(activeFile, { focus: true, offset: 'nearest' })
    } catch (err) {
      console.error('Failed to scroll to active file:', err)
    }
  }, [activeFile, model, pathsSet])

  // Synchronize custom filter search input with @pierre/trees search engine
  useEffect(() => {
    model.setSearch(filter || null)
  }, [filter, model])

  if (collapsed) {
    return (
      <div className="ft">
        <div className="ft-search">
          {onToggleCollapse && (
            <Tooltip content="Expand sidebar" side="right">
              <button
                className="sidebar-toggle"
                onClick={onToggleCollapse}
                aria-label="Expand sidebar"
              >
                <PanelLeftOpen size={16} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="ft" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ft-search">
        {onToggleCollapse && (
          <Tooltip content="Collapse sidebar" side="right">
            <button
              className="sidebar-toggle"
              onClick={onToggleCollapse}
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose size={16} />
            </button>
          </Tooltip>
        )}
        <div className="ft-search-wrapper">
          <Search size={14} className="ft-search-icon" />
          <input
            type="text"
            placeholder="Filter files..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="ft-search-input"
          />
        </div>
      </div>
      {dropped.length > 0 && (
        <div
          className="ft-collision-warning"
          title={dropped.join('\n')}
          style={{
            fontSize: '0.75rem',
            padding: '4px 8px',
            background: 'var(--bg-warning, #fff3cd)',
            color: 'var(--text-warning, #856404)',
          }}
        >
          ⚠ {dropped.length} file(s) hidden due to path collision (hover for details)
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <FileTreeErrorBoundary>
          <PierreFileTree model={model} className="ft-pierre-tree" />
        </FileTreeErrorBoundary>
      </div>
    </div>
  )
})
