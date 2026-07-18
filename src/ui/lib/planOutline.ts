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

  for (let i = 0; i < lines.length; i++) {
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
