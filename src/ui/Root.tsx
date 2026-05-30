import { useEffect, useState } from 'react'
import { App } from './App'
import { PlanReviewApp } from './components/PlanReviewApp'
import { useRoutePath } from './router'
import { initUiState } from './utils/uiState'

/**
 * Top-level view switch. diffing has two surfaces — the diff review (`/`) and
 * the plan review (`/plan`, `/plan/:id`) — and only one mounts at a time, so the
 * inactive surface's hooks (and its data fetching) never run.
 * 
 * Also hydrates UI State asynchronously on initial mount with a polished loading surface.
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
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        width: '100vw',
        background: '#0d1117',
        color: '#c9d1d9',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}>
        <div style={{
          width: '32px',
          height: '32px',
          border: '3px solid rgba(139, 148, 158, 0.15)',
          borderTop: '3px solid #58a6ff',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          marginBottom: '16px',
        }} />
        <span style={{ fontSize: '13px', fontWeight: 500, opacity: 0.75, letterSpacing: '0.3px' }}>
          Loading review session...
        </span>
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}} />
      </div>
    )
  }

  if (path === '/plan' || path.startsWith('/plan/')) {
    return <PlanReviewApp />
  }
  return <App />
}

