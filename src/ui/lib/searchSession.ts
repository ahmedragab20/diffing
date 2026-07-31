/**
 * Post-palette search navigation — mirrors TUI `repo_search_hits` + `jump_search`.
 */
import { classifyNavigation, type NavContext } from './diffIndex'
import { scrollToLine } from '../utils'
import { trackSelection } from '../hooks/useSearch'

export type SearchNavHit = {
  kind: 'file' | 'text' | 'symbol'
  path: string
  line?: number
  match?: string
}

export interface SearchSessionSnapshot {
  hits: SearchNavHit[]
  index: number
  query: string
}

export interface SearchSession extends SearchSessionSnapshot {}

/** Default `changedOnly` when opening a palette shortcut. */
export function defaultChangedOnlyForScope(_scope: string): boolean {
  return true
}

export type SearchPaletteRow =
  | { kind: 'file'; hit: { path: string } }
  | { kind: 'text'; hit: { path: string; line: number } }
  | { kind: 'symbol'; hit: { path: string; line: number; name: string } }

export function rowsToNavHits(rows: SearchPaletteRow[], query: string): SearchNavHit[] {
  const q = query.trim()
  return rows.map((row) => {
    if (row.kind === 'file') return { kind: 'file', path: row.hit.path }
    const line = row.hit.line
    const match = row.kind === 'symbol' ? row.hit.name : q
    return { kind: row.kind, path: row.hit.path, line, match }
  })
}

export type JumpResult = 'navigated' | 'preview-only'

/** Jump the main diff view to a cached hit (same rules as palette Enter). */
export function jumpToSearchHit(
  hit: SearchNavHit,
  ctx: NavContext,
  onNavigateFile: (path: string) => void,
): JumpResult {
  if (hit.kind === 'file') {
    const action = classifyNavigation({ kind: 'file', path: hit.path }, ctx)
    if (action.type === 'scrollFile') {
      onNavigateFile(hit.path)
      return 'navigated'
    }
    return 'preview-only'
  }

  const line = hit.line
  if (line == null) return 'preview-only'

  const action = classifyNavigation(
    { kind: 'line', path: hit.path, line, match: hit.match },
    ctx,
  )
  if (action.type === 'scrollLine') {
    scrollToLine(action.path, action.line, action.side, action.match)
    return 'navigated'
  }
  return 'preview-only'
}

export function cycleSearchIndex(index: number, delta: number, length: number): number {
  if (length <= 0) return 0
  return (index + delta + length * 16) % length
}

export function activateSearchSessionHit(
  session: SearchSession,
  index: number,
  ctx: NavContext,
  onNavigateFile: (path: string) => void,
): JumpResult {
  const hit = session.hits[index]
  if (!hit) return 'preview-only'
  if (session.query) trackSelection(session.query, hit.path)
  return jumpToSearchHit(hit, ctx, onNavigateFile)
}
