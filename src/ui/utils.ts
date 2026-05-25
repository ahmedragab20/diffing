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
  const classLanguage = lang ? lang : validLanguage
  return `<pre><code class="hljs language-${classLanguage}">${highlighted}</code></pre>`
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
  'catppuccin-mocha': { themeName: 'catppuccin-mocha', type: 'dark' },
  'catppuccin-latte': { themeName: 'catppuccin-latte', type: 'light' },
  'solarized-dark': { themeName: 'solarized-dark', type: 'dark' },
  'solarized-light': { themeName: 'solarized-light', type: 'light' },
  monokai: { themeName: 'monokai', type: 'dark' },
  'ayu-dark': { themeName: 'ayu-dark', type: 'dark' },
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

function findElementInElOrShadow(root: Element | ShadowRoot, selector: string): HTMLElement[] {
  const elements: HTMLElement[] = []
  
  // Query all in the current root
  const found = root.querySelectorAll(selector)
  found.forEach(el => elements.push(el as HTMLElement))
  
  // Search recursively in shadow roots of all descendants
  const allDescendants = root.querySelectorAll('*')
  allDescendants.forEach(desc => {
    if (desc.shadowRoot) {
      elements.push(...findElementInElOrShadow(desc.shadowRoot, selector))
    }
  })
  
  return elements
}

export function scrollToLine(filePath: string, lineNumber: number, side: 'additions' | 'deletions' | 'addition' | 'deletion', highlightText?: string) {
  const fileEl = document.getElementById(`file-${filePath}`)
  if (!fileEl) return

  // 1. If the file card is currently marked as "Viewed", it only renders the viewed header.
  // We must programmatically unview/expand it to mount and display the diff body!
  const checkbox = fileEl.querySelector('input[type="checkbox"]') as HTMLInputElement | null
  if (checkbox && checkbox.checked) {
    checkbox.click()
  }

  // 2. Scroll the container card into view instantly so that the IntersectionObserver triggers
  // and mounts the actual file contents in the DOM!
  fileEl.scrollIntoView({ block: 'start', behavior: 'auto' })

  // Normalize side to addition/deletion
  const expectedType = (side === 'additions' || side === 'addition') ? 'addition' : 'deletion'

  // 3. Poll for the specific line to mount in the DOM/Shadow DOM
  const tryScroll = (attemptsRemaining: number) => {
    // Query all data-lines in the card, including shadow roots
    const allLineEls = findElementInElOrShadow(fileEl, '[data-line]')
    let found: HTMLElement | null = null

    // First try to find matching line number AND side
    for (const el of allLineEls) {
      const elLine = el.getAttribute('data-line')
      const elType = el.getAttribute('data-line-type')
      if (elLine && parseInt(elLine, 10) === lineNumber && elType === expectedType) {
        found = el
        break
      }
    }

    // Fall back to just matching line number
    if (!found) {
      for (const el of allLineEls) {
        const elLine = el.getAttribute('data-line')
        if (elLine && parseInt(elLine, 10) === lineNumber) {
          found = el
          break
        }
      }
    }

    if (found) {
      // Scroll it into the center of the viewport instantly and cleanly
      found.scrollIntoView({ block: 'center', behavior: 'auto' })
      
      // Determine what specific element to highlight (symbol span vs whole line)
      let highlightTarget: HTMLElement = found
      if (highlightText && highlightText.trim()) {
        const textToFind = highlightText.trim()
        const children = found.querySelectorAll('span, code, pre')
        
        // Try exact match first
        for (const child of children) {
          if (child.textContent?.trim() === textToFind) {
            highlightTarget = child as HTMLElement
            break
          }
        }
        
        // Try substring match as fallback
        if (highlightTarget === found) {
          for (const child of children) {
            if (child.textContent?.trim().includes(textToFind)) {
              highlightTarget = child as HTMLElement
              break
            }
          }
        }
      }

      // Apply a gorgeous, theme-harmonious temporary inline style transition highlight (bypasses shadow DOM encapsulation)
      const originalBg = highlightTarget.style.backgroundColor
      const originalTransition = highlightTarget.style.transition
      const originalBorderRadius = highlightTarget.style.borderRadius
      const originalPadding = highlightTarget.style.padding
      
      highlightTarget.style.transition = 'none'
      highlightTarget.style.backgroundColor = 'rgba(235, 186, 0, 0.45)'
      highlightTarget.style.borderRadius = '4px'
      if (highlightTarget !== found) {
        highlightTarget.style.padding = '1px 5px'
      }
      
      // Force DOM reflow to trigger transition
      highlightTarget.offsetHeight
      
      highlightTarget.style.transition = 'background-color 1.5s ease-out'
      highlightTarget.style.backgroundColor = originalBg || ''
      
      setTimeout(() => {
        highlightTarget.style.transition = originalTransition
        if (!originalBg) highlightTarget.style.removeProperty('background-color')
        if (!originalBorderRadius) highlightTarget.style.removeProperty('border-radius')
        if (!originalPadding) highlightTarget.style.removeProperty('padding')
      }, 1500)
    } else if (attemptsRemaining > 0) {
      // If the line is not found yet (card is still rendering), retry in 50ms
      setTimeout(() => tryScroll(attemptsRemaining - 1), 50)
    }
  }

  // Start polling attempts (up to 12 attempts * 50ms = 600ms buffer)
  tryScroll(12)

  // Also flash the file card header to draw attention
  const headerEl = fileEl.querySelector('.file-diff-card-header, .file-diff-placeholder-header')
  if (headerEl) {
    headerEl.classList.add('symbol-flash')
    setTimeout(() => headerEl.classList.remove('symbol-flash'), 1200)
  }
}


