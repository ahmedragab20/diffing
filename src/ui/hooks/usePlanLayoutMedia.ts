import { useEffect, useState } from 'react'

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** ≤960px — Split view auto-downgrades to the last single-pane mode. */
export function usePlanNarrowSplit() {
  return useMedia('(max-width: 960px)')
}

/** ≤1024px — comments map renders as a sheet instead of a side rail. */
export function usePlanCommentsSheet() {
  return useMedia('(max-width: 1024px)')
}
