/**
 * Server-side code search powered by `@ff-labs/fff-node` — a native (Rust)
 * fuzzy file finder + live grep. Because it is a native Node addon it cannot
 * run in the browser, so the React client calls the `/api/search` endpoint and
 * this module owns the single long-lived `FileFinder` instance for the repo.
 *
 * Design notes:
 *  - The native binary is loaded lazily via dynamic import inside `init()` so a
 *    missing/incompatible platform binary degrades gracefully (search returns
 *    an error) instead of crashing the whole server at module load.
 *  - One finder per process, keyed implicitly to the repo root. Its frecency /
 *    history databases live under the project's `~/.diffing/<repo>` storage dir
 *    so we never write stray files into the user's repository.
 *  - fff runs its own file-system watcher, so the index stays fresh as the
 *    working tree changes during a review.
 *  - "Symbols" search is plain grep for the identifier, then each hit line is
 *    classified with the shared {@link classifySymbolLine} patterns — fff 0.8.x
 *    does not populate `isDefinition`, so we do the classification ourselves.
 */
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { FileFinder, GrepMatch } from '@ff-labs/fff-node'
import { getRepoRoot, getProjectStorageDir } from './git.js'
import { classifySymbolLine } from './symbols.js'

export type MatchRange = [number, number]

export interface FileHit {
  path: string
  fileName: string
  gitStatus: string
  matchType: string
  exact: boolean
}

export interface ContentHit {
  path: string
  fileName: string
  line: number
  col: number
  content: string
  matchRanges: MatchRange[]
  gitStatus: string
}

export interface SymbolHit {
  name: string
  kind: string
  path: string
  fileName: string
  line: number
  content: string
  matchRanges: MatchRange[]
  gitStatus: string
}

export interface SearchMeta {
  /** Total matches fff reports (may exceed the returned page). */
  total: number
  /** True while the initial index scan is still running. */
  indexing: boolean
  /** Engine/initialization error, if search is unavailable. */
  error?: string
  /** Set when a regex query failed to parse and was treated literally. */
  regexError?: string
}

export interface FilesResponse extends SearchMeta {
  scope: 'files'
  items: FileHit[]
}
export interface ContentResponse extends SearchMeta {
  scope: 'text'
  items: ContentHit[]
}
export interface SymbolsResponse extends SearchMeta {
  scope: 'symbols'
  items: SymbolHit[]
}
export interface AllResponse extends SearchMeta {
  scope: 'all'
  items: (
    | { kind: 'file'; hit: FileHit }
    | { kind: 'text'; hit: ContentHit }
    | { kind: 'symbol'; hit: SymbolHit }
  )[]
}

export interface SearchStatus {
  available: boolean
  indexing: boolean
  indexedFiles: number
  error?: string
}

interface SearchOpts {
  limit?: number
  /** When provided, restrict results to this exact set of repo paths. */
  paths?: string[]
}
interface ContentOpts extends SearchOpts {
  regex?: boolean
}

const DEFAULT_LIMIT = 60
const MAX_LIMIT = 200
/** Internal page size when no path filter — generous so diff-first client
 *  ranking has enough to work with. */
const SCAN_PAGE = 200
/** Larger page size when filtering to a path set, so the post-filter is
 *  effectively complete for normal-sized diffs/repos. */
const SCAN_PAGE_FILTERED = 1000

let finder: FileFinder | null = null
let initPromise: Promise<FileFinder | null> | null = null
let initError: string | null = null
let shutdownHooked = false

function clampLimit(limit?: number): number {
  if (!limit || limit < 1) return DEFAULT_LIMIT
  return Math.min(limit, MAX_LIMIT)
}

async function init(): Promise<FileFinder | null> {
  try {
    // Dynamic import: isolates a missing/broken native binary to search only.
    const { FileFinder } = await import('@ff-labs/fff-node')
    const root = getRepoRoot()
    const dbDir = join(getProjectStorageDir(root), 'fff')
    mkdirSync(dbDir, { recursive: true })

    const created = FileFinder.create({
      basePath: root,
      frecencyDbPath: join(dbDir, 'frecency.db'),
      historyDbPath: join(dbDir, 'history.db'),
      logLevel: 'error',
    })
    if (!created.ok) {
      initError = created.error
      return null
    }
    const f = created.value
    if (!shutdownHooked) {
      shutdownHooked = true
      // Best-effort: stop the native watcher when the process exits.
      process.once('exit', () => {
        try {
          f.destroy()
        } catch {
          // ignore
        }
      })
    }
    // Wait (bounded) for the initial scan; searches still work on a partial
    // index, and the watcher keeps indexing afterwards.
    await f.waitForScan(8000)
    finder = f
    return f
  } catch (err: any) {
    initError = err?.message ?? String(err)
    return null
  }
}

async function getFinder(): Promise<FileFinder | null> {
  if (finder) return finder
  if (initError) return null
  if (!initPromise) initPromise = init()
  return initPromise
}

function isIndexing(f: FileFinder): boolean {
  try {
    return f.isScanning()
  } catch {
    return false
  }
}

/** Highlight ranges for `query` inside `content` (case-insensitive). */
function rangesFor(content: string, query: string): MatchRange[] {
  if (!query) return []
  const ranges: MatchRange[] = []
  const hay = content.toLowerCase()
  const needle = query.toLowerCase()
  let from = 0
  while (from <= hay.length) {
    const idx = hay.indexOf(needle, from)
    if (idx === -1) break
    ranges.push([idx, idx + needle.length])
    from = idx + needle.length
  }
  return ranges
}

export async function searchFiles(query: string, opts: ContentOpts = {}): Promise<FilesResponse> {
  const f = await getFinder()
  if (!f) return { scope: 'files', items: [], total: 0, indexing: false, error: initError ?? 'Search unavailable' }

  const limit = clampLimit(opts.limit)
  const pathSet = opts.paths ? new Set(opts.paths) : null
  const pageSize = pathSet ? SCAN_PAGE_FILTERED : Math.max(SCAN_PAGE, limit)

  const res = f.fileSearch(query, { pageSize })
  if (!res.ok) return { scope: 'files', items: [], total: 0, indexing: isIndexing(f), error: res.error }

  const items: FileHit[] = []
  const { items: raw, scores } = res.value
  for (let i = 0; i < raw.length && items.length < limit; i++) {
    const it = raw[i]
    if (pathSet && !pathSet.has(it.relativePath)) continue
    const score = scores[i]
    items.push({
      path: it.relativePath,
      fileName: it.fileName,
      gitStatus: it.gitStatus,
      matchType: score?.matchType ?? '',
      exact: !!score?.exactMatch,
    })
  }
  return { scope: 'files', items, total: res.value.totalMatched, indexing: isIndexing(f) }
}

export async function searchContent(query: string, opts: ContentOpts = {}): Promise<ContentResponse> {
  const f = await getFinder()
  if (!f) return { scope: 'text', items: [], total: 0, indexing: false, error: initError ?? 'Search unavailable' }
  if (!query) return { scope: 'text', items: [], total: 0, indexing: isIndexing(f) }

  const limit = clampLimit(opts.limit)
  const pathSet = opts.paths ? new Set(opts.paths) : null
  const pageSize = pathSet ? SCAN_PAGE_FILTERED : Math.max(SCAN_PAGE, limit)

  const res = f.grep(query, {
    mode: opts.regex ? 'regex' : 'plain',
    smartCase: true,
    beforeContext: 0,
    afterContext: 0,
    pageSize,
  })
  if (!res.ok) return { scope: 'text', items: [], total: 0, indexing: isIndexing(f), error: res.error }

  const items: ContentHit[] = []
  for (const m of res.value.items) {
    if (items.length >= limit) break
    if (pathSet && !pathSet.has(m.relativePath)) continue
    items.push(toContentHit(m))
  }
  return {
    scope: 'text',
    items,
    total: res.value.totalMatched,
    indexing: isIndexing(f),
    regexError: res.value.regexFallbackError || undefined,
  }
}

function toContentHit(m: GrepMatch): ContentHit {
  return {
    path: m.relativePath,
    fileName: m.fileName,
    line: m.lineNumber,
    col: m.col,
    content: m.lineContent,
    matchRanges: (m.matchRanges as MatchRange[]) ?? [],
    gitStatus: m.gitStatus,
  }
}

export async function searchSymbols(query: string, opts: SearchOpts = {}): Promise<SymbolsResponse> {
  const f = await getFinder()
  if (!f) return { scope: 'symbols', items: [], total: 0, indexing: false, error: initError ?? 'Search unavailable' }
  if (!query) return { scope: 'symbols', items: [], total: 0, indexing: isIndexing(f) }

  const limit = clampLimit(opts.limit)
  const pathSet = opts.paths ? new Set(opts.paths) : null
  // Over-fetch: most grep hits won't be symbol *definitions*, so we scan wide
  // and classify down to the ones that are.
  const pageSize = pathSet ? SCAN_PAGE_FILTERED : Math.max(SCAN_PAGE_FILTERED, limit * 8)

  const res = f.grep(query, { mode: 'plain', smartCase: true, beforeContext: 0, afterContext: 0, pageSize })
  if (!res.ok) return { scope: 'symbols', items: [], total: 0, indexing: isIndexing(f), error: res.error }

  const items: SymbolHit[] = []
  const ql = query.toLowerCase()
  const seen = new Set<string>()
  for (const m of res.value.items) {
    if (items.length >= limit) break
    if (pathSet && !pathSet.has(m.relativePath)) continue
    const sym = classifySymbolLine(m.lineContent)
    if (!sym) continue
    if (!sym.name.toLowerCase().includes(ql)) continue
    const key = `${m.relativePath}:${m.lineNumber}:${sym.name}`
    if (seen.has(key)) continue
    seen.add(key)
    // Highlight the symbol name within the line rather than the raw grep range.
    const nameIdx = m.lineContent.indexOf(sym.name)
    const matchRanges: MatchRange[] =
      nameIdx >= 0 ? [[nameIdx, nameIdx + sym.name.length]] : (m.matchRanges as MatchRange[]) ?? []
    items.push({
      name: sym.name,
      kind: sym.kind,
      path: m.relativePath,
      fileName: m.fileName,
      line: m.lineNumber,
      content: m.lineContent,
      matchRanges,
      gitStatus: m.gitStatus,
    })
  }
  return { scope: 'symbols', items, total: items.length, indexing: isIndexing(f) }
}

export async function searchAll(query: string, opts: ContentOpts = {}): Promise<AllResponse> {
  const limit = clampLimit(opts.limit)
  const [filesRes, contentRes, symbolsRes] = await Promise.all([
    searchFiles(query, { ...opts, limit }),
    searchContent(query, { ...opts, limit }),
    searchSymbols(query, { ...opts, limit }),
  ])

  const items: (
    | { kind: 'file'; hit: FileHit }
    | { kind: 'text'; hit: ContentHit }
    | { kind: 'symbol'; hit: SymbolHit }
  )[] = []

  for (const hit of filesRes.items) {
    items.push({ kind: 'file', hit })
  }
  for (const hit of symbolsRes.items) {
    items.push({ kind: 'symbol', hit })
  }
  for (const hit of contentRes.items) {
    items.push({ kind: 'text', hit })
  }

  const total = (filesRes.total || 0) + (contentRes.total || 0) + (symbolsRes.total || 0)
  const indexing = filesRes.indexing || contentRes.indexing || symbolsRes.indexing
  const error = filesRes.error || contentRes.error || symbolsRes.error
  const regexError = contentRes.regexError

  return {
    scope: 'all',
    items: items.slice(0, limit),
    total,
    indexing,
    error,
    regexError,
  }
}

export async function getSearchStatus(): Promise<SearchStatus> {
  const f = await getFinder()
  if (!f) return { available: false, indexing: false, indexedFiles: 0, error: initError ?? 'Search unavailable' }
  let indexedFiles = 0
  let indexing = false
  try {
    const prog = f.getScanProgress()
    if (prog.ok) {
      indexedFiles = prog.value.scannedFilesCount
      indexing = prog.value.isScanning
    }
  } catch {
    // ignore
  }
  return { available: true, indexing, indexedFiles }
}

/** Record that the user opened `path` from a query, improving fff's frecency
 *  ranking for future searches. Best-effort, never throws. */
export async function trackSelection(query: string, path: string): Promise<void> {
  const f = await getFinder()
  if (!f) return
  try {
    f.trackQuery(query, path)
  } catch {
    // ignore
  }
}

/** Tear down the finder (used by tests / explicit shutdown). */
export function closeSearch(): void {
  if (finder) {
    try {
      finder.destroy()
    } catch {
      // ignore
    }
  }
  finder = null
  initPromise = null
  initError = null
}
