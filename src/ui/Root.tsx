import { App } from './App'
import { PlanReviewApp } from './components/PlanReviewApp'
import { useRoutePath } from './router'

/**
 * Top-level view switch. diffing has two surfaces — the diff review (`/`) and
 * the plan review (`/plan`, `/plan/:id`) — and only one mounts at a time, so the
 * inactive surface's hooks (and its data fetching) never run.
 */
export function Root() {
  const path = useRoutePath()
  if (path === '/plan' || path.startsWith('/plan/')) {
    return <PlanReviewApp />
  }
  return <App />
}
