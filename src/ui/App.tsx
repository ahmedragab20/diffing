import { useState, useMemo, useCallback, useRef, useEffect, useTransition } from 'react'
import { parsePatchFiles } from '@pierre/diffs'
import type { FileDiffMetadata } from '@pierre/diffs'
import type { ReviewComment } from '../types'
import { useDiff } from './hooks/useDiff'
import { useComments } from './hooks/useComments'
import { useSettings } from './hooks/useSettings'
import { useViewed } from './hooks/useViewed'
import { Toolbar } from './components/Toolbar'
import { DiffViewer } from './components/DiffViewer'
import { FileTree } from './components/FileTree'
import { CommentTracker } from './components/CommentTracker'

export function App() {
  const { settings, loaded, updateSettings } = useSettings()
  const [, startTransition] = useTransition()
  const { patch, repoName, branch, customMode, binaryFiles, tabSizeMap, untrackedFiles, loading, error } = useDiff({
    staged: settings.staged,
    untracked: settings.untracked,
  }, loaded)
  const { comments, addComment, removeComment, copyAllComments } =
    useComments()
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('diffit-sidebar-collapsed') === 'true'
    } catch {
      return false
    }
  })
  const { viewedFiles, setViewed } = useViewed()
  const diffViewerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem('diffit-sidebar-collapsed', String(sidebarCollapsed))
    } catch {}
  }, [sidebarCollapsed])

  const untrackedSet = useMemo(() => new Set(untrackedFiles), [untrackedFiles])

  const files = useMemo(() => {
    if (!patch) return []
    try {
      const parsed = parsePatchFiles(patch)
      const parsedFiles = parsed.flatMap((p) => p.files)

      // Add synthetic entries for binary files not already in parsed output
      const existingNames = new Set(parsedFiles.map((f) => f.name))
      for (const bf of binaryFiles) {
        if (!existingNames.has(bf.path)) {
          const syntheticFile: FileDiffMetadata = {
            name: bf.path,
            type: bf.type === 'added' || bf.type === 'untracked' ? 'new' : bf.type === 'deleted' ? 'deleted' : 'change',
            hunks: [],
            splitLineCount: 0,
            unifiedLineCount: 0,
            isPartial: true,
            deletionLines: [],
            additionLines: [],
          }
          parsedFiles.push(syntheticFile)
        }
      }

      return parsedFiles
    } catch {
      return []
    }
  }, [patch, binaryFiles])

  const diffStats = useMemo(() => {
    if (!patch) return { additions: 0, deletions: 0 }
    let additions = 0
    let deletions = 0
    let index = 0
    const len = patch.length

    while (index < len) {
      let nextNewline = patch.indexOf('\n', index)
      if (nextNewline === -1) {
        nextNewline = len
      }

      const firstChar = patch.charCodeAt(index)
      if (firstChar === 43) { // '+'
        if (index + 2 < len && patch.charCodeAt(index + 1) === 43 && patch.charCodeAt(index + 2) === 43) {
          // Skip '+++'
        } else {
          additions++
        }
      } else if (firstChar === 45) { // '-'
        if (index + 2 < len && patch.charCodeAt(index + 1) === 45 && patch.charCodeAt(index + 2) === 45) {
          // Skip '---'
        } else {
          deletions++
        }
      }

      index = nextNewline + 1
    }

    return { additions, deletions }
  }, [patch])

  const binaryFileMap = useMemo(() => {
    const map = new Map<string, (typeof binaryFiles)[number]>()
    for (const bf of binaryFiles) {
      map.set(bf.path, bf)
    }
    return map
  }, [binaryFiles])

  const commentCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of comments) {
      counts[c.filePath] = (counts[c.filePath] ?? 0) + 1
    }
    return counts
  }, [comments])

  const fileAnnotationsMap = useMemo(() => {
    const map = new Map<string, { side: ReviewComment['side']; lineNumber: number; metadata: ReviewComment }[]>()
    for (const c of comments) {
      let list = map.get(c.filePath)
      if (!list) {
        list = []
        map.set(c.filePath, list)
      }
      list.push({
        side: c.side,
        lineNumber: c.lineNumber,
        metadata: c,
      })
    }
    return map
  }, [comments])

  const handleFileClick = useCallback((filePath: string) => {
    setActiveFile(filePath)
    const el = document.getElementById(`file-${filePath}`)
    if (el) {
      el.scrollIntoView({ block: 'start' })
    }
  }, [])

  const handleViewedChange = useCallback((filePath: string, viewed: boolean) => {
    setViewed(filePath, viewed)
  }, [setViewed])

  const handleDiffStyleChange = useCallback((style: 'split' | 'unified') => {
    startTransition(() => {
      updateSettings({ diffStyle: style })
    })
  }, [updateSettings])

  const handleDiffOptionsChange = useCallback((options: { staged: boolean; untracked: boolean }) => {
    startTransition(() => {
      updateSettings(options)
    })
  }, [updateSettings])

  const handleDefaultTabSizeChange = useCallback((size: number) => {
    startTransition(() => {
      updateSettings({ defaultTabSize: size })
    })
  }, [updateSettings])

  const handleBrowserChange = useCallback((browser: string) => {
    startTransition(() => {
      updateSettings({ browser })
    })
  }, [updateSettings])

  const handleThemeChange = useCallback((theme: string) => {
    startTransition(() => {
      updateSettings({ theme })
    })
  }, [updateSettings])

  const handleToggleCollapse = useCallback(() => {
    setSidebarCollapsed((c) => !c)
  }, [])

  const diffOptions = useMemo(() => ({
    staged: settings.staged,
    untracked: settings.untracked,
  }), [settings.staged, settings.untracked])

  useEffect(() => {
    const activeTheme = settings.theme || 'nord'
    document.documentElement.setAttribute('data-theme', activeTheme)
  }, [settings.theme])

  if (!loaded || loading) {
    return (
      <div className="loading">
        <p>Loading diff...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="error">
        <p>Error: {error}</p>
      </div>
    )
  }

  return (
    <div className="app">
      <Toolbar
        repoName={repoName}
        branch={branch}
        fileCount={files.length}
        additions={diffStats.additions}
        deletions={diffStats.deletions}
        commentCount={comments.length}
        diffStyle={settings.diffStyle}
        diffOptions={diffOptions}
        defaultTabSize={settings.defaultTabSize}
        browser={settings.browser}
        theme={settings.theme || 'nord'}
        customMode={customMode}
        onDiffStyleChange={handleDiffStyleChange}
        onDiffOptionsChange={handleDiffOptionsChange}
        onDefaultTabSizeChange={handleDefaultTabSizeChange}
        onBrowserChange={handleBrowserChange}
        onThemeChange={handleThemeChange}
        onCopyComments={copyAllComments}
      />
      <div className="app-body">
        <aside className={`sidebar ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
          <FileTree
            files={files}
            activeFile={activeFile}
            commentCounts={commentCounts}
            viewedFiles={viewedFiles}
            untrackedFiles={untrackedSet}
            onFileClick={handleFileClick}
            collapsed={sidebarCollapsed}
            onToggleCollapse={handleToggleCollapse}
          />
          {!sidebarCollapsed && <CommentTracker comments={comments} />}
        </aside>
        <main className="main" ref={diffViewerRef}>
          <DiffViewer
            files={files}
            diffStyle={settings.diffStyle}
            tabSizeMap={tabSizeMap}
            defaultTabSize={settings.defaultTabSize}
            viewedFiles={viewedFiles}
            binaryFiles={binaryFileMap}
            theme={settings.theme || 'nord'}
            onViewedChange={handleViewedChange}
            fileAnnotationsMap={fileAnnotationsMap}
            onAddComment={addComment}
            onDeleteComment={removeComment}
          />
        </main>
      </div>
    </div>
  )
}
