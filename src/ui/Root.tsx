import { useEffect, useState } from 'react'
import { App } from './App'
import { BrandMark } from './components/BrandMark'
import { PlanReviewApp } from './components/PlanReviewApp'
import { PrReviewApp } from './components/PrReviewApp'
import { useRoutePath } from './router'
import { initUiState } from './utils/uiState'

/**
 * Top-level view switch. diffing has three surfaces — the local diff review
 * (`/`), the plan review (`/plan`, `/plan/:id`), and the GitHub PR review
 * (`/gh/pr`) — and only one mounts at a time, so the inactive surfaces'
 * hooks (and their data fetching) never run.
 *
 * Also hydrates UI State asynchronously on initial mount with a polished
 * loading surface.
 */
export function Root() {
  const path = useRoutePath()
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    initUiState().then(() => {
      setLoaded(true)
    })
  }, [])

  if (!loaded) {
    return (
      <div className="boot-loader" role="status" aria-live="polite">
        <BrandMark size={40} className="boot-loader-mark" />
        <div className="boot-loader-spinner" aria-hidden="true" />
        <span className="boot-loader-label">Loading review session…</span>
      </div>
    )
  }

  if (path === '/plan' || path.startsWith('/plan/')) {
    return <PlanReviewApp />
  }
  if (path === '/gh/pr' || path.startsWith('/gh/pr/')) {
    return <PrReviewApp />
  }
  return <App />
}
