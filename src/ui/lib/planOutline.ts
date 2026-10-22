/**
 * Build a table-of-contents outline from plan markdown headings.
 * Used by the rendered-mode TOC and outline jump list.
 */

export interface PlanOutlineItem {
  /** 1–6 from markdown heading level */
  level: number
  text: string
  /** Stable slug used as the DOM id / hash */
  id: string
  /** 1-based line number of the heading in the source (best-effort) */
  line: number
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[`*_~[\]()#.!?,:'"]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'section'
}

/** Extract ATX headings (`# …`) from a markdown body. */
export function buildPlanOutline(body: string): PlanOutlineItem[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const items: PlanOutlineItem[] = []
  const used = new Map<string, number>()

  // `# comment` lines inside fenced code are code, not headings — treating them
  // as sections would split the fence across Read segments.
  let fence: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[i])
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (fence === null) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null
      continue
    }
    if (fence !== null) continue
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i])
    if (!m) continue
    const level = m[1].length
    const text = m[2].replace(/\s+#+\s*$/, '').trim()
    if (!text) continue
    let id = slugify(text)
    const n = used.get(id) ?? 0
    used.set(id, n + 1)
    if (n > 0) id = `${id}-${n + 1}`
    items.push({ level, text, id, line: i + 1 })
  }
  return items
}
