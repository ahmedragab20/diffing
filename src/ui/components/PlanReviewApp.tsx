import { useEffect, useMemo, useState } from 'react'
import { preloadHighlighter } from '@pierre/diffs'
import { useWorkerPool } from '@pierre/diffs/react'
import { ArrowLeft, Palette, ClipboardList } from 'lucide-react'
import { useSettings } from '../hooks/useSettings'
import { usePlans } from '../hooks/usePlans'
import { useRoutePath, navigate } from '../router'
import { SHIKI_THEME_MAP } from '../utils'
import { HapticsProvider } from '../hooks/useHaptics'
import { PlanReview } from './PlanReview'
import { PlanList } from './PlanList'
import { ThemeModal } from './ThemeModal'
import { AgentActivityToast } from './AgentActivityToast'

/**
 * Top-level surface for the `/plan` route. The plan-review twin of {@link App}:
 * lists submitted plans, renders the active one for line/section commenting and
 * an approve/reject/request-changes verdict, and shares the theme + worker pool
 * machinery so highlighting matches the diff view.
 */
export function PlanReviewApp() {
  const poolManager = useWorkerPool()
  const { settings, updateSettings } = useSettings()
  const { plans, getPlan, removePlan, agentActivity, clearAgentActivity } = usePlans()
  const path = useRoutePath()
  const [themeModalOpen, setThemeModalOpen] = useState(false)

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

  return (
    <HapticsProvider enabled={settings.haptics ?? true} soundsEnabled={settings.sounds ?? true}>
      <div className="app plan-app">
        <div className="toolbar plan-app-toolbar">
          <div className="toolbar-left">
            <button className="btn btn-sm" onClick={() => navigate('/')} title="Back to the diff review">
              <ArrowLeft size={14} style={{ marginRight: '6px' }} />
              Diff
            </button>
            <h1 className="toolbar-title plan-app-title">
              <ClipboardList size={16} style={{ marginRight: '6px' }} />
              Plan review
            </h1>
            <span className="toolbar-stat">
              {plans.length} plan{plans.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="toolbar-right">
            <button className="btn btn-sm settings-btn" title="Switch theme" onClick={() => setThemeModalOpen(true)}>
              <Palette size={14} style={{ marginRight: '6px' }} />
              <span>Theme</span>
            </button>
          </div>
        </div>

        <div className="app-body">
          <aside className="sidebar plan-sidebar">
            <PlanList
              plans={plans}
              activeId={activePlan?.id ?? null}
              onSelect={(id) => navigate(`/plan/${id}`)}
              onDelete={(id) => {
                removePlan(id)
                if (activePlan?.id === id) navigate('/plan')
              }}
            />
          </aside>
          <main className="main plan-main">
            {activePlan ? (
              <PlanReview
                key={activePlan.id}
                plan={activePlan}
                theme={settings.theme || 'nord'}
                fontSize={settings.fontSize}
                defaultTabSize={settings.defaultTabSize}
                lineWrap={settings.lineWrap}
                showLineNumbers={settings.showLineNumbers}
                lineHoverHighlight={settings.lineHoverHighlight}
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
              ? { at: agentActivity.at, commentId: agentActivity.commentId, filePath: 'plan comment', model: agentActivity.model, body: agentActivity.body }
              : null
          }
          onDismiss={clearAgentActivity}
          onJump={() => {
            if (agentActivity) navigate(`/plan/${agentActivity.planId}`)
          }}
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
