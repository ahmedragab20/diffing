/**
 * Deep-link helpers for file / line / comment anchors.
 *
 * URL shape (search params on the current path):
 *   ?file=src/a.ts&line=42&side=additions&comment=<uuid>
 */

export interface PermalinkTarget {
  file?: string
  line?: number
  side?: 'additions' | 'deletions'
  comment?: string
}

export function parsePermalink(search: string): PermalinkTarget {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const file = params.get('file') || undefined
  const lineRaw = params.get('line')
  const line = lineRaw != null && lineRaw !== '' ? Number(lineRaw) : undefined
  const sideRaw = params.get('side')
  const side =
    sideRaw === 'additions' || sideRaw === 'deletions' ? sideRaw : undefined
  const comment = params.get('comment') || undefined
  return {
    file,
    line: line != null && Number.isFinite(line) ? line : undefined,
    side,
    comment,
  }
}

export function buildPermalink(target: PermalinkTarget, basePath = '/'): string {
  const params = new URLSearchParams()
  if (target.file) params.set('file', target.file)
  if (target.line != null) params.set('line', String(target.line))
  if (target.side) params.set('side', target.side)
  if (target.comment) params.set('comment', target.comment)
  const qs = params.toString()
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${basePath}${qs ? `?${qs}` : ''}`
}
