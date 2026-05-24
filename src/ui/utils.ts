import { marked } from 'marked'
import hljs from 'highlight.js'

// Unescape helper to pass raw code blocks to highlight.js
function unescapeHtml(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
}

// Configure custom renderer globally for marked
const renderer = new marked.Renderer()
renderer.code = function ({ text, lang }: { text: string; lang?: string }): string {
  const language = lang || ''
  const validLanguage = hljs.getLanguage(language) ? language : 'plaintext'
  const rawCode = unescapeHtml(text)
  const highlighted = hljs.highlight(rawCode, { language: validLanguage }).value
  return `<pre><code class="hljs language-${validLanguage}">${highlighted}</code></pre>`
}

marked.use({ renderer })

export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function truncate(text: string, maxLen: number): string {
  const firstLine = text.split('\n')[0]
  if (firstLine.length <= maxLen) return firstLine
  return firstLine.slice(0, maxLen) + '…'
}

export function fileName(filePath: string): string {
  const parts = filePath.split('/')
  return parts[parts.length - 1]
}

export const SHIKI_THEME_MAP: Record<string, { themeName: string; type: 'dark' | 'light' }> = {
  nord: { themeName: 'nord', type: 'dark' },
  'github-dark': { themeName: 'github-dark', type: 'dark' },
  'github-light': { themeName: 'github-light', type: 'light' },
  dracula: { themeName: 'dracula', type: 'dark' },
  'one-dark': { themeName: 'one-dark-pro', type: 'dark' },
  'synthwave-84': { themeName: 'synthwave-84', type: 'dark' },
  'tokyo-night': { themeName: 'tokyo-night', type: 'dark' },
}

export function parseMarkdown(text: string): string {
  if (!text) return ''

  // Escape HTML to prevent XSS
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

  try {
    return marked.parse(escaped, { gfm: true, breaks: true }) as string
  } catch (err) {
    console.error('Failed to parse markdown:', err)
    return escaped
  }
}

