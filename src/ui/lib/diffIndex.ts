/**
 * Pure helpers that bridge the current git diff and fff search results.
 *
 * The search engine works against the *working tree* and reports working-tree
 * line numbers. The diff view, however, renders a specific comparison (unstaged,
 * staged, or a custom revision range). These helpers let the palette decide,
 * for any search hit, whether it can be reliably navigated *inside the diff view*
 * or whether it should open in the standalone preview pane.
 *
 * Kept side-effect free and free of React so the navigation rules
 * (LOCKED DECISION 5) can be unit-tested in isolation.
 */
import type { FileDiffMetadata } from '@pierre/diffs'
import type { DiffLineEntry } from '../hooks/useDiffSearch'
import { classifySymbolLine } from '../../lib/symbols'
import type { SymbolHit } from './searchTypes'

/** Set of every file path that appears in the current diff. */
export function buildDiffFileSet(files: FileDiffMetadata[]): Set<string> {
  return new Set(files.map((f) => f.name))
}

/**
 * `${path}:${line}` keys for every *added* (new-side) changed line. Only the
 * additions side is used: fff greps the working tree, whose line numbers align
 * with the diff's new/addition side. Deletion-side lines don't exist in the
 * working tree, so they can never be a grep hit.
 */
export function buildChangedLineKeys(entries: DiffLineEntry[]): Set<string> {
  const keys = new Set<string>()
  for (const e of entries) {
    if (e.side === 'additions') keys.add(`${e.filePath}:${e.lineNumber}`)
  }
  return keys
}

export type NavInput =
  | { kind: 'file'; path: string }
  | { kind: 'line'; path: string; line: number; match?: string }

export type NavAction =
  | { type: 'scrollFile'; path: string }
  | { type: 'scrollLine'; path: string; line: number; side: 'additions'; match?: string }
  | { type: 'preview'; path: string; line?: number; match?: string }

export interface NavContext {
  diffFileSet: Set<string>
  changedKeys: Set<string>
  /** Custom revision range — working-tree line numbers may not map to the diff. */
  customMode: boolean
  /** Staged diff — the rendered "new" side is the index, not the working tree. */
  staged: boolean
}

/**
 * Decide how to act on a selected search result.
 *
 *  - A file in the diff jumps to its file card; otherwise it opens in preview.
 *  - A content/symbol hit jumps to the real diff line ONLY when it is a changed
 *    line of a diff file AND the diff is a plain working-tree comparison
 *    (not staged / custom) — otherwise working-tree line numbers aren't
 *    guaranteed to match what's rendered, so we open the (always-correct)
 *    working-tree preview at that line instead.
 */
export function classifyNavigation(input: NavInput, ctx: NavContext): NavAction {
  if (input.kind === 'file') {
    return ctx.diffFileSet.has(input.path)
      ? { type: 'scrollFile', path: input.path }
      : { type: 'preview', path: input.path }
  }

  const inDiffFile = ctx.diffFileSet.has(input.path)
  const canScrollMainDiff = inDiffFile

  if (canScrollMainDiff) {
    return { type: 'scrollLine', path: input.path, line: input.line, side: 'additions', match: input.match }
  }
  return { type: 'preview', path: input.path, line: input.line, match: input.match }
}

/**
 * Decode fff's BYTE-offset match ranges into safe JS-string (UTF-16) character
 * ranges for highlighting. For pure-ASCII content (the overwhelming majority of
 * source lines) byte offsets equal char offsets. For multi-byte content we walk
 * the UTF-8 byte length of each character; if a range boundary falls in the
 * middle of a multi-byte character we drop that range rather than corrupt the
 * string. Returns `null` when nothing usable is decoded, so callers can fall
 * back to a literal substring highlight.
 */
export function decodeByteRanges(content: string, byteRanges: MatchRangeLike[]): [number, number][] | null {
  if (!byteRanges || byteRanges.length === 0) return null

  // Fast path: if the string is pure ASCII, bytes === chars.
  let ascii = true
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) > 127) {
      ascii = false
      break
    }
  }

  const byteLen = ascii ? content.length : utf8Len(content)
  let charByByte: number[] | null = null
  if (!ascii) {
    // byteOffset -> charIndex map (entries only at character starts).
    charByByte = new Array(byteLen + 1).fill(-1)
    let b = 0
    for (let ci = 0; ci < content.length; ) {
      charByByte[b] = ci
      const cp = content.codePointAt(ci)!
      ci += cp > 0xffff ? 2 : 1
      b += utf8CharLen(cp)
    }
    charByByte[byteLen] = content.length
  }

  const out: [number, number][] = []
  for (const r of byteRanges) {
    const [bs, be] = r
    if (bs == null || be == null || be <= bs || bs < 0 || be > byteLen) continue
    if (ascii) {
      out.push([bs, be])
    } else {
      const cs = charByByte![bs]
      const ce = charByByte![be]
      if (cs >= 0 && ce >= 0) out.push([cs, ce])
      // else: range split a multi-byte char — skip it.
    }
  }
  return out.length ? out : null
}

type MatchRangeLike = [number, number]

function utf8CharLen(cp: number): number {
  if (cp <= 0x7f) return 1
  if (cp <= 0x7ff) return 2
  if (cp <= 0xffff) return 3
  return 4
}

function utf8Len(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i)!
    n += utf8CharLen(cp)
    i += cp > 0xffff ? 2 : 1
  }
  return n
}

/**
 * Build highlight char-ranges for a line: prefer the engine's (byte) ranges,
 * else fall back to case-insensitive occurrences of `query`. Always returns
 * in-bounds, ascending, non-overlapping ranges.
 */
export function highlightRanges(
  content: string,
  byteRanges: MatchRangeLike[] | undefined,
  query: string,
): [number, number][] {
  const decoded = byteRanges ? decodeByteRanges(content, byteRanges) : null
  const ranges = decoded ?? literalRanges(content, query)
  // Clamp + sort + merge so rendering is always safe.
  const clamped = ranges
    .map(([s, e]) => [Math.max(0, s), Math.min(content.length, e)] as [number, number])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [s, e] of clamped) {
    const last = merged[merged.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else merged.push([s, e])
  }
  return merged
}

function literalRanges(content: string, query: string): [number, number][] {
  const q = query.trim()
  if (!q) return []
  const out: [number, number][] = []
  const hay = content.toLowerCase()
  const needle = q.toLowerCase()
  let from = 0
  while (out.length < 50) {
    const idx = hay.indexOf(needle, from)
    if (idx === -1) break
    out.push([idx, idx + needle.length])
    from = idx + needle.length
  }
  return out
}

/**
 * Minimal subsequence fuzzy match used ONLY as a degraded fallback for the
 * Files scope when the native search engine is unavailable. Returns a score
 * (higher = better) or null if `query` is not a subsequence of `text`.
 */
export function fallbackFuzzyScore(text: string, query: string): number | null {
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  if (!q) return 0
  let qi = 0
  let score = 0
  let prev = -1
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += prev >= 0 && ti - prev === 1 ? 5 : 1
      prev = ti
      qi++
    }
  }
  return qi === q.length ? score - text.length * 0.01 : null
}

export function extractSymbolsFromDiff(
  changedEntries: DiffLineEntry[],
): SymbolHit[] {
  const hits: SymbolHit[] = []
  const seen = new Set<string>()
  for (const entry of changedEntries) {
    if (entry.side !== 'additions') continue
    const sym = classifySymbolLine(entry.content)
    if (sym) {
      const key = `${entry.filePath}:${entry.lineNumber}:${sym.name}`
      if (seen.has(key)) continue
      seen.add(key)

      const nameIdx = entry.content.indexOf(sym.name)
      const matchRanges: [number, number][] =
        nameIdx >= 0 ? [[nameIdx, nameIdx + sym.name.length]] : []

      hits.push({
        name: sym.name,
        kind: sym.kind,
        path: entry.filePath,
        fileName: entry.filePath.split('/').pop() || '',
        line: entry.lineNumber,
        content: entry.content,
        matchRanges,
        gitStatus: '',
      })
    }
  }
  return hits
}

