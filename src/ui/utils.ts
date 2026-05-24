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

  // 1. Escape HTML to prevent XSS
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

  // 2. Parse code blocks: ```lang\ncode\n```
  const codeBlocks: string[] = []
  html = html.replace(/```([\s\S]*?)```/g, (_, codeContent) => {
    const isSuggestion = codeContent.trim().startsWith('suggestion')
    const cleaned = isSuggestion 
      ? codeContent.slice(codeContent.indexOf('\n') + 1) 
      : codeContent

    const index = codeBlocks.length
    codeBlocks.push(
      `<pre class="markdown-code-block ${isSuggestion ? 'code-suggestion-block' : ''}"><code>${cleaned.trim()}</code></pre>`
    )
    return `__CODE_BLOCK_PLACEHOLDER_${index}__`
  })

  // 3. Parse inline code: `code`
  html = html.replace(/`([^`]+)`/g, '<code class="markdown-inline-code">$1</code>')

  // 4. Parse bold: **text** or __text__
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>')

  // 5. Parse italic: *text* or _text_
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>')

  // 6. Parse headers: # Header
  html = html.split('\n').map(line => {
    if (line.startsWith('# ')) return `<h1 class="markdown-h1">${line.slice(2)}</h1>`
    if (line.startsWith('## ')) return `<h2 class="markdown-h2">${line.slice(3)}</h2>`
    if (line.startsWith('### ')) return `<h3 class="markdown-h3">${line.slice(4)}</h3>`
    return line
  }).join('\n')

  // 7. Parse lists & blockquotes
  let inList = false
  const lines = html.split('\n')
  const processedLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]

    // Blockquote: > text
    if (line.startsWith('&gt; ')) {
      line = `<blockquote class="markdown-blockquote">${line.slice(5)}</blockquote>`
    }

    // Task lists: - [ ] or - [x]
    const isTaskUnchecked = line.startsWith('- [ ] ') || line.startsWith('* [ ] ')
    const isTaskChecked = line.startsWith('- [x] ') || line.startsWith('* [x] ')
    if (isTaskUnchecked) {
      line = `<li class="markdown-li task-list-item"><input type="checkbox" disabled style="margin-right: 6px;" /> ${line.slice(6)}</li>`
    } else if (isTaskChecked) {
      line = `<li class="markdown-li task-list-item"><input type="checkbox" checked disabled style="margin-right: 6px;" /> ${line.slice(6)}</li>`
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      line = `<li class="markdown-li">${line.slice(2)}</li>`
    }

    // Process lists wrapper
    const isLi = line.startsWith('<li')
    if (isLi && !inList) {
      processedLines.push('<ul class="markdown-ul">')
      inList = true
    } else if (!isLi && inList) {
      processedLines.push('</ul>')
      inList = false
    }

    processedLines.push(line)
  }
  if (inList) {
    processedLines.push('</ul>')
  }

  html = processedLines.join('\n')

  // 8. Restore code blocks
  html = html.replace(/__CODE_BLOCK_PLACEHOLDER_(\d+)__/g, (_, idx) => {
    return codeBlocks[parseInt(idx)]
  })

  // 9. Convert double newlines to paragraphs or single to <br/>
  html = html
    .split('\n\n')
    .map(p => {
      const trimmed = p.trim()
      if (!trimmed) return ''
      if (
        trimmed.startsWith('<pre') || 
        trimmed.startsWith('<ul') || 
        trimmed.startsWith('<blockquote') || 
        trimmed.startsWith('<h')
      ) {
        return trimmed
      }
      return `<p class="markdown-p">${trimmed.replace(/\n/g, '<br/>')}</p>`
    })
    .join('')

  return html
}

