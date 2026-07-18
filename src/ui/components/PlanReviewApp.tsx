import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { preloadHighlighter } from '@pierre/diffs'
import { useWorkerPool } from '@pierre/diffs/react'
import { ArrowLeft, Palette, ClipboardList, Settings, Code2, FileText, Menu } from 'lucide-react'
import { useSettings, resolveMonoFont } from '../hooks/useSettings'
import { useApplyFonts } from '../hooks/useApplyFonts'
import { usePlans } from '../hooks/usePlans'
import { useRoutePath, navigate } from '../router'
import { SHIKI_THEME_MAP } from '../utils'
import { HapticsProvider, playSound, fireFeedback } from '../hooks/useHaptics'
import { getUiStateItem, setUiStateItem } from "../utils/uiState"
import { PlanReview, type PlanViewMode } from './PlanReview'
import { PlanList } from './PlanList'
import { ThemeModal } from './ThemeModal'
import { AgentActivityToast } from './AgentActivityToast'
import { BrandMark } from './BrandMark'
import { Popover } from '../primitives/Popover'
import { Select } from '../primitives/Select'
import { SubmitPlanReviewPopover } from './SubmitPlanReviewPopover'
import { VimStatusBar } from './VimStatusBar'
import { ShortcutsHelpModal } from './ShortcutsHelpModal'

const FONT_SIZE_OPTS = [11, 12, 13, 14, 15, 16].map((n) => ({ value: String(n), label: `${n}px` }))
const TAB_SIZE_OPTS = [2, 4, 8].map((n) => ({ value: String(n), label: String(n) }))
const HOVER_OPTS = [
  { value: 'both', label: 'Both' },
  { value: 'line', label: 'Line only' },
  { value: 'number', label: 'Number only' },
  { value: 'disabled', label: 'Disabled' },
]

/**
 * Top-level surface for the `/plan` route. The plan-review twin of {@link App}:
 * lists submitted plans, renders the active one for line/section commenting and
 * an approve/reject/request-changes verdict, and shares the theme + worker pool
 * machinery so highlighting matches the diff view.
 */
export function PlanReviewApp() {
  const poolManager = useWorkerPool()
  const { settings, loaded, updateSettings } = useSettings()
  useApplyFonts(loaded, settings.uiFont, settings.monoFont)
  const { plans, getPlan, removePlan, agentActivity, clearAgentActivity, submitDecision, submitting, agentWaiting, isLoading } = usePlans()
  const path = useRoutePath()
  const [themeModalOpen, setThemeModalOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === ',' || e.code === 'Comma')) {
        e.preventDefault()
        setSettingsOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Persisted viewMode: source | rendered | split
  const [viewMode, setViewMode] = useState<PlanViewMode>(() => {
    try {
      const stored = getUiStateItem('diffing-plan-view-mode')
      if (stored === 'rendered' || stored === 'split' || stored === 'source') return stored
    } catch {}
    return 'source'
  })

  const handleViewModeChange = useCallback((mode: PlanViewMode) => {
    setViewMode(mode)
    try {
      setUiStateItem('diffing-plan-view-mode', mode)
    } catch {}
  }, [])

  const routeId = useMemo(() => {
    const m = /^\/plan\/([^/]+)/.exec(path)
    return m ? decodeURIComponent(m[1]) : null
  }, [path])

  // Without an explicit id, default to the most recent plan still awaiting a
  // verdict, falling back to the newest plan overall.
  const activePlan = useMemo(() => {
    if (routeId) return getPlan(routeId)
    if (plans.length === 0) return null
    const pending = [...plans].reverse().find((p) => p.decision === 'pending')
    return pending ?? plans[plans.length - 1]
  }, [routeId, plans, getPlan])

  const shikiConfig = useMemo(() => {
    const activeTheme = settings.theme || 'nord'
    return SHIKI_THEME_MAP[activeTheme] || SHIKI_THEME_MAP.nord
  }, [settings.theme])

  useEffect(() => {
    const activeTheme = settings.theme || 'nord'
    const root = document.documentElement
    root.classList.add('theme-switching')
    root.setAttribute('data-theme', activeTheme)
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => root.classList.remove('theme-switching'))
    })
    return () => cancelAnimationFrame(id)
  }, [settings.theme])

  useEffect(() => {
    if (!poolManager) return
    poolManager
      .setRenderOptions({
        theme: {
          dark: shikiConfig.type === 'dark' ? shikiConfig.themeName : 'nord',
          light: shikiConfig.type === 'light' ? shikiConfig.themeName : 'github-light',
        },
      })
      .catch((err) => console.error('Failed to set worker pool render options:', err))
  }, [poolManager, shikiConfig])

  useEffect(() => {
    const dark = shikiConfig.type === 'dark' ? shikiConfig.themeName : 'nord'
    const light = shikiConfig.type === 'light' ? shikiConfig.themeName : 'github-light'
    preloadHighlighter({ themes: Array.from(new Set([dark, light])), langs: [] }).catch(() => {})
  }, [shikiConfig])

  // Collapsible plans sidebar states matching App.tsx
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const stored = getUiStateItem("diffing-sidebar-collapsed")
      if (stored != null) return stored === "true"
    } catch {}
    return typeof window !== 'undefined' && window.innerWidth <= 768
  })
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const stored = getUiStateItem("diffing-sidebar-width")
      return stored ? Number(stored) : 320
    } catch {
      return 320
    }
  })

  useEffect(() => {
    try {
      setUiStateItem("diffing-sidebar-collapsed", String(sidebarCollapsed))
    } catch {}
  }, [sidebarCollapsed])

  const sidebarWidthRef = useRef(sidebarWidth)
  sidebarWidthRef.current = sidebarWidth
  const appRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const sidebarGuideRef = useRef<HTMLDivElement>(null)

  const SIDEBAR_MIN_WIDTH = 240
  const SIDEBAR_MAX_WIDTH = 640

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidthRef.current
    const sidebarEl = sidebarRef.current
    const guideEl = sidebarGuideRef.current
    const sidebarLeft = sidebarEl ? sidebarEl.getBoundingClientRect().left : 0
    let latestWidth = startWidth
    let rafId = 0

    const flush = () => {
      rafId = 0
      if (guideEl) guideEl.style.transform = `translateX(${sidebarLeft + latestWidth}px)`
    }

    if (guideEl) {
      guideEl.style.transform = `translateX(${sidebarLeft + startWidth}px)`
      guideEl.classList.add("sidebar-resize-guide-active")
    }

    const handleMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      latestWidth = Math.max(
        SIDEBAR_MIN_WIDTH,
        Math.min(SIDEBAR_MAX_WIDTH, startWidth + delta),
      )
      if (!rafId) rafId = requestAnimationFrame(flush)
    }

    const handleUp = () => {
      if (rafId) cancelAnimationFrame(rafId)
      if (guideEl) guideEl.classList.remove("sidebar-resize-guide-active")
      setSidebarWidth(latestWidth)
      try {
        setUiStateItem("diffing-sidebar-width", String(latestWidth))
      } catch {}
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  // Vim keyboard shortcuts
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(c => !c)
  }, [])

  const toggleLineWrap = useCallback(() => {
    updateSettings({ lineWrap: !settings.lineWrap })
  }, [settings.lineWrap, updateSettings])

  const toggleLineNumbers = useCallback(() => {
    updateSettings({ showLineNumbers: !settings.showLineNumbers })
  }, [settings.showLineNumbers, updateSettings])

  const toggleViewMode = useCallback(() => {
    // Cycle source → rendered → split → source
    const order: PlanViewMode[] = ['source', 'rendered', 'split']
    const next = order[(order.indexOf(viewMode) + 1) % order.length]
    handleViewModeChange(next)
  }, [viewMode, handleViewModeChange])

  const cycleTabSize = useCallback(() => {
    const sizes = [2, 4, 8]
    const current = settings.defaultTabSize || 4
    const nextIndex = (sizes.indexOf(current) + 1) % sizes.length
    updateSettings({ defaultTabSize: sizes[nextIndex] })
  }, [settings.defaultTabSize, updateSettings])

  const navigatePlan = useCallback((direction: 'next' | 'prev') => {
    if (plans.length === 0) return
    const sorted = [...plans].sort((a, b) => b.createdAt - a.createdAt)
    let nextIndex = 0
    if (activePlan) {
      const currentIndex = sorted.findIndex(p => p.id === activePlan.id)
      if (currentIndex !== -1) {
        if (direction === 'next') {
          nextIndex = Math.min(currentIndex + 1, sorted.length - 1)
        } else {
          nextIndex = Math.max(currentIndex - 1, 0)
        }
      }
    }
    const nextPlan = sorted[nextIndex]
    navigate(`/plan/${nextPlan.id}`)
  }, [plans, activePlan])

  useEffect(() => {
    let keyBuffer = ''
    let bufferTimeout: NodeJS.Timeout
    let lastNavSound = 0

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement
      if (active) {
        const tag = active.tagName.toLowerCase()
        if (
          tag === 'input' ||
          tag === 'textarea' ||
          active.hasAttribute('contenteditable')
        ) {
          return
        }
      }

      clearTimeout(bufferTimeout)
      const key = e.key

      if (e.ctrlKey) {
        if (key === 'd') {
          e.preventDefault()
          window.scrollBy({ top: window.innerHeight / 2, behavior: 'auto' })
          fireFeedback('selection', 'navigate')
          keyBuffer = ''
        } else if (key === 'u') {
          e.preventDefault()
          window.scrollBy({ top: -window.innerHeight / 2, behavior: 'auto' })
          fireFeedback('selection', 'navigate')
          keyBuffer = ''
        }
        return
      }

      if (key.length > 1 && key !== 'Escape' && key !== 'Enter') return

      keyBuffer += key
      bufferTimeout = setTimeout(() => {
        keyBuffer = ''
      }, 800)

      if (keyBuffer === 'j') {
        e.preventDefault()
        window.scrollBy({ top: 100, behavior: 'auto' })
        const now = Date.now()
        if (now - lastNavSound > 80) { playSound('navigate'); lastNavSound = now; }
        keyBuffer = ''
      } else if (keyBuffer === 'k') {
        e.preventDefault()
        window.scrollBy({ top: -100, behavior: 'auto' })
        const now = Date.now()
        if (now - lastNavSound > 80) { playSound('navigate'); lastNavSound = now; }
        keyBuffer = ''
      } else if (keyBuffer === 'gg') {
        e.preventDefault()
        window.scrollTo({ top: 0, behavior: 'auto' })
        fireFeedback('selection', 'navigate')
        keyBuffer = ''
      } else if (keyBuffer === 'G') {
        e.preventDefault()
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: 'auto',
        })
        fireFeedback('selection', 'navigate')
        keyBuffer = ''
      } else if (keyBuffer === 'J') {
        e.preventDefault()
        navigatePlan('next')
        fireFeedback('selection', 'navigate')
        keyBuffer = ''
      } else if (keyBuffer === 'K') {
        e.preventDefault()
        navigatePlan('prev')
        fireFeedback('selection', 'navigate')
        keyBuffer = ''
      } else if (keyBuffer === 'm') {
        e.preventDefault()
        toggleViewMode()
        fireFeedback('selection', 'toggle')
        keyBuffer = ''
      } else if (keyBuffer === 't') {
        e.preventDefault()
        cycleTabSize()
        fireFeedback('selection', 'toggle')
        keyBuffer = ''
      } else if (keyBuffer === 'b') {
        e.preventDefault()
        toggleSidebar()
        fireFeedback('selection', 'toggle')
        keyBuffer = ''
      } else if (keyBuffer === 'w') {
        e.preventDefault()
        toggleLineWrap()
        fireFeedback('selection', 'toggle')
        keyBuffer = ''
      } else if (keyBuffer === 'n') {
        e.preventDefault()
        toggleLineNumbers()
        fireFeedback('selection', 'toggle')
        keyBuffer = ''
      } else if (keyBuffer === 'gt') {
        e.preventDefault()
        setThemeModalOpen(true)
        fireFeedback('medium', 'open')
        keyBuffer = ''
      } else if (keyBuffer === '?') {
        e.preventDefault()
        setShortcutsHelpOpen(true)
        fireFeedback('medium', 'open')
        keyBuffer = ''
      } else if (keyBuffer.length >= 2) {
        keyBuffer = ''
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown)
    }
  }, [toggleSidebar, toggleLineWrap, toggleLineNumbers, toggleViewMode, cycleTabSize, navigatePlan])

  const openCommentCount = useMemo(() => {
    if (!activePlan) return 0
    return (activePlan.comments ?? []).filter((c) => c.status === 'open').length
  }, [activePlan])

  if (isLoading || !loaded) {
    return (
      <div
        className="app plan-app skeleton-app"
        style={
          {
            "--sidebar-width": `${sidebarWidth}px`,
          } as React.CSSProperties
        }
      >
        <header className="skeleton-toolbar">
          <div className="skeleton-item skeleton-logo" style={{ width: '140px' }}></div>
          <div className="skeleton-item skeleton-stats" style={{ width: '80px', marginLeft: '20px' }}></div>
          <div className="skeleton-item skeleton-actions" style={{ width: '220px' }}></div>
        </header>

        <div className="app-body">
          <aside
            className={`sidebar plan-sidebar skeleton-sidebar ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
          >
            {!sidebarCollapsed && (
              <>
                <div className="skeleton-search" style={{ height: '32px', margin: '0 16px 16px 16px' }}></div>
                <div className="skeleton-tree-nodes">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      className="skeleton-tree-node"
                      style={{ paddingLeft: '16px', height: '40px', borderBottom: '1px solid var(--border-weak)' }}
                    >
                      <div className="skeleton-node-icon" style={{ width: '20px', height: '20px', borderRadius: '50%' }}></div>
                      <div className="skeleton-node-text" style={{ width: `${80 + ((i * 30) % 90)}px`, height: '14px' }}></div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </aside>
          {!sidebarCollapsed && (
            <div className="sidebar-resize-handle" style={{ cursor: 'default' }} />
          )}

          <main className="main plan-main skeleton-main">
            <div className="file-diff-card skeleton-card" style={{ border: '1px solid var(--border-color)', borderRadius: '8px' }}>
              <div className="skeleton-card-header" style={{ padding: '16px 20px' }}>
                <div className="skeleton-card-title" style={{ width: '250px', height: '20px' }}></div>
                <div className="skeleton-card-badge" style={{ width: '100px', height: '24px' }}></div>
              </div>
              <div className="skeleton-card-body" style={{ padding: '24px', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="skeleton-code-line" style={{ width: '90%', height: '16px' }}></div>
                <div className="skeleton-code-line" style={{ width: '75%', height: '16px' }}></div>
                <div className="skeleton-code-line" style={{ width: '85%', height: '16px' }}></div>
                <div className="skeleton-code-line" style={{ width: '40%', height: '16px' }}></div>
                <div className="skeleton-code-line" style={{ width: '60%', height: '16px' }}></div>
                <div className="skeleton-code-line" style={{ width: '80%', height: '16px' }}></div>
              </div>
            </div>
          </main>
        </div>
      </div>
    )
  }

  return (
    <HapticsProvider enabled={settings.haptics ?? true} soundsEnabled={settings.sounds ?? true}>
      <div
        className="app plan-app"
        ref={appRef}
        style={
          {
            "--sidebar-width": `${sidebarWidth}px`,
          } as React.CSSProperties
        }
      >
        <div
          className="sidebar-resize-guide"
          ref={sidebarGuideRef}
          aria-hidden="true"
        />

        <div className="toolbar plan-app-toolbar">
          <div className="toolbar-left">
            <button
              className="toolbar-mobile-toggle"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              aria-label="Toggle sidebar"
              title={sidebarCollapsed ? 'Open sidebar' : 'Close sidebar'}
            >
              <Menu size={18} />
            </button>
            <button className="btn btn-sm" onClick={() => navigate('/')} title="Back to the diff review">
              <ArrowLeft size={14} style={{ marginRight: '6px' }} />
              <span className="btn-label">Diff</span>
            </button>
            <h1 className="toolbar-title plan-app-title">
              <BrandMark size={18} className="plan-app-brand" />
              Plan review
            </h1>
            <span className="toolbar-stat">
              {plans.length} plan{plans.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="toolbar-right">
            {/* Settings Popover for Plans page */}
            <Popover
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              ariaLabel="Settings"
              className="settings-popover"
              trigger={
                <button className={`btn btn-sm settings-btn ${settingsOpen ? 'btn-active' : ''}`} title="Settings">
                  <Settings size={14} /> <span className="btn-label">Settings</span>
                </button>
              }
            >
              <div className="popover-scroll settings-panel">
                <div className="settings-section-label">Review Options</div>
                <div className="settings-item settings-item-spaced">
                  <span>View mode</span>
                  <Select
                    value={viewMode}
                    onValueChange={(v) => handleViewModeChange(v as PlanViewMode)}
                    options={[
                      { value: 'source', label: 'Source (commentable)' },
                      { value: 'rendered', label: 'Rendered (markdown)' },
                      { value: 'split', label: 'Split (source + rendered)' },
                    ]}
                    ariaLabel="Plan view mode"
                  />
                </div>
                <div className="settings-item settings-item-spaced">
                  <span>Theme</span>
                  <button
                    className="btn btn-sm settings-btn"
                    onClick={() => {
                      setSettingsOpen(false)
                      setThemeModalOpen(true)
                    }}
                    style={{ display: 'inline-flex', alignItems: 'center' }}
                  >
                    <Palette size={14} style={{ marginRight: '4px' }} />
                    <span>Switch Theme...</span>
                  </button>
                </div>

                <div className="settings-section-label">Display</div>
                <label className="settings-item">
                  <input
                    type="checkbox"
                    checked={settings.lineWrap}
                    onChange={(e) => updateSettings({ lineWrap: e.target.checked })}
                  />
                  Wrap long lines
                </label>
                <label className="settings-item">
                  <input
                    type="checkbox"
                    checked={settings.showLineNumbers}
                    onChange={(e) => updateSettings({ showLineNumbers: e.target.checked })}
                  />
                  Show line numbers
                </label>
                <label className="settings-item">
                  <input
                    type="checkbox"
                    checked={settings.showStatusBar ?? true}
                    onChange={(e) => updateSettings({ showStatusBar: e.target.checked })}
                  />
                  Show status bar
                </label>
                <div className="settings-item settings-item-spaced">
                  <span>Hover highlight</span>
                  <Select
                    value={settings.lineHoverHighlight}
                    onValueChange={(v) => updateSettings({ lineHoverHighlight: v as any })}
                    options={HOVER_OPTS}
                    ariaLabel="Hover highlight"
                  />
                </div>
                <div className="settings-item settings-item-spaced">
                  <span>Font size</span>
                  <Select
                    value={String(settings.fontSize)}
                    onValueChange={(v) => updateSettings({ fontSize: Number(v) })}
                    options={FONT_SIZE_OPTS}
                    ariaLabel="Font size"
                  />
                </div>
                <div className="settings-item settings-item-spaced">
                  <span>Default tab size</span>
                  <Select
                    value={String(settings.defaultTabSize)}
                    onValueChange={(v) => updateSettings({ defaultTabSize: Number(v) })}
                    options={TAB_SIZE_OPTS}
                    ariaLabel="Default tab size"
                  />
                </div>
              </div>
            </Popover>

            {activePlan && (
              <SubmitPlanReviewPopover
                openCommentCount={openCommentCount}
                onSubmit={(verdict, comment) => submitDecision(activePlan.id, verdict, comment)}
                submitting={submitting}
                agentWaiting={agentWaiting}
                currentDecision={activePlan.decision}
              />
            )}
          </div>
        </div>

        {!sidebarCollapsed && (
          <div
            className="sidebar-mobile-backdrop"
            onClick={() => setSidebarCollapsed(true)}
            aria-hidden="true"
          />
        )}

        <div className="app-body">
          <aside
            ref={sidebarRef}
            className={`sidebar plan-sidebar ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
          >
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <PlanList
                plans={plans}
                activeId={activePlan?.id ?? null}
                onSelect={(id) => navigate(`/plan/${id}`)}
                onDelete={(id) => {
                  removePlan(id)
                  if (activePlan?.id === id) navigate('/plan')
                }}
                collapsed={sidebarCollapsed}
                onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
              />
            </div>
          </aside>
          {!sidebarCollapsed && (
            <div
              className="sidebar-resize-handle"
              onMouseDown={handleSidebarResizeStart}
              role="separator"
              aria-label="Resize sidebar"
              aria-orientation="vertical"
              tabIndex={0}
            />
          )}

          <main className="main plan-main">
            {activePlan ? (
              <PlanReview
                key={activePlan.id}
                plan={activePlan}
                theme={settings.theme || 'nord'}
                fontSize={settings.fontSize}
                monoFontFamily={resolveMonoFont(settings.monoFont)}
                defaultTabSize={settings.defaultTabSize}
                lineWrap={settings.lineWrap}
                showLineNumbers={settings.showLineNumbers}
                lineHoverHighlight={settings.lineHoverHighlight}
                viewMode={viewMode}
                editorIDE={settings.editorIDE}
              />
            ) : (
              <PlanEmptyState hasPlans={plans.length > 0} notFound={!!routeId} />
            )}
          </main>
        </div>

        <ThemeModal
          open={themeModalOpen}
          activeTheme={settings.theme || 'nord'}
          onThemeChange={(theme) => updateSettings({ theme })}
          onClose={() => setThemeModalOpen(false)}
        />
        <AgentActivityToast
          activity={
            agentActivity
              ? {
                  at: agentActivity.at,
                  commentId: agentActivity.commentId,
                  filePath: `plan · ${agentActivity.planId.slice(0, 8)}`,
                  model: agentActivity.model,
                  body: agentActivity.body,
                }
              : null
          }
          onDismiss={clearAgentActivity}
          onJump={() => {
            if (!agentActivity) return
            navigate(`/plan/${agentActivity.planId}`)
            // After navigation, scroll to the thread on next frame.
            requestAnimationFrame(() => {
              document
                .getElementById(`plan-comment-${agentActivity.commentId}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            })
          }}
        />
        <VimStatusBar
          activeFile={activePlan ? activePlan.title : null}
          onShowHelp={() => setShortcutsHelpOpen(true)}
          placeholder="No active plan (J/K to jump)"
          visible={settings.showStatusBar ?? true}
        />
        <ShortcutsHelpModal
          isOpen={shortcutsHelpOpen}
          onClose={() => setShortcutsHelpOpen(false)}
          mode="plan"
        />
      </div>
    </HapticsProvider>
  )
}

function PlanEmptyState({ hasPlans, notFound }: { hasPlans: boolean; notFound: boolean }) {
  return (
    <div className="plan-empty-state">
      <ClipboardList size={40} style={{ opacity: 0.4 }} />
      {notFound ? (
        <p>That plan no longer exists. Pick one from the list, or submit a new plan.</p>
      ) : hasPlans ? (
        <p>Select a plan from the list to review it.</p>
      ) : (
        <>
          <p>No plans have been submitted for review yet.</p>
          <p className="plan-empty-hint">
            An agent can submit one with{' '}
            <code>diffing plan submit PLAN.md</code> (or the <code>submit_plan</code> MCP tool), then block on{' '}
            <code>diffing plan await</code> until you approve, reject, or request changes here.
          </p>
        </>
      )}
    </div>
  )
}
