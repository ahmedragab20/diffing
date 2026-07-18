import { useEffect, useState } from 'react'
import { App } from './App'
import { BrandMark } from './components/BrandMark'
import { PlanReviewApp } from './components/PlanReviewApp'
import { PrReviewApp } from './components/PrReviewApp'
import { navigate, useRoutePath } from './router'
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
  // When the server is in PR mode but the user landed on `/` (bookmark, stale
  // tab, or an older CLI that opened the root URL), redirect to `/gh/pr` so
  // <PrReviewApp> mounts instead of the local review surface.
  const [prRedirectChecked, setPrRedirectChecked] = useState(
    () => path === '/gh/pr' || path.startsWith('/gh/pr/') || path.startsWith('/plan'),
  )

  useEffect(() => {
    initUiState().then(() => {
      setLoaded(true)
    })
  }, [])

  useEffect(() => {
    if (path === '/gh/pr' || path.startsWith('/gh/pr/') || path.startsWith('/plan')) {
      setPrRedirectChecked(true)
      return
    }
    if (path !== '/') {
      setPrRedirectChecked(true)
      return
    }
    let cancelled = false
    fetch('/api/gh/session')
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) return
        const body = (await res.json().catch(() => null)) as { prMode?: boolean } | null
        // Only redirect when the server is actually in PR mode (200 + prMode:true).
        if (body?.prMode === true) {
          navigate('/gh/pr', { replace: true })
        }
      })
      .catch(() => {
        // Network blip — stay on local review.
      })
      .finally(() => {
        if (!cancelled) setPrRedirectChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  if (!loaded || !prRedirectChecked) {
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
