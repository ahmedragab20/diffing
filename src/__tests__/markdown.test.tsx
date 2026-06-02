import { render, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Markdown } from '../ui/components/Markdown'

// The real mermaid library is heavy and needs a real layout engine; mock it so
// the lazy-import path is exercised without loading it.
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, chart: string) => ({
      svg: `<svg class="mock-mermaid">${chart}</svg>`,
    })),
  },
}))

describe('Markdown', () => {
  it('renders GFM tables', () => {
    const { container } = render(<Markdown content={'| a | b |\n| - | - |\n| 1 | 2 |'} />)
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelectorAll('th')).toHaveLength(2)
    expect(container.querySelectorAll('td')).toHaveLength(2)
  })

  it('renders task lists with checkboxes', () => {
    const { container } = render(<Markdown content={'- [x] done\n- [ ] todo'} />)
    const checkboxes = container.querySelectorAll('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(2)
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true)
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false)
  })

  it('highlights fenced code blocks', () => {
    const { container } = render(<Markdown content={'```js\nconst x = 1\n```'} />)
    const code = container.querySelector('pre code.hljs')
    expect(code).not.toBeNull()
    // lowlight wraps tokens in hljs-* spans
    expect(code?.querySelector('span[class^="hljs-"]')).not.toBeNull()
  })

  it('renders nothing for suggestion fences (surfaced as cards elsewhere)', () => {
    const { container } = render(
      <Markdown content={'before\n\n```suggestion\nreplaced code\n```\n\nafter'} />,
    )
    expect(container.textContent).toContain('before')
    expect(container.textContent).toContain('after')
    expect(container.textContent).not.toContain('replaced code')
    expect(container.querySelector('code')).toBeNull()
  })

  it('lazily renders mermaid diagrams', async () => {
    const { container } = render(<Markdown content={'```mermaid\ngraph TD; A-->B;\n```'} />)
    const node = container.querySelector('.mermaid')
    expect(node).not.toBeNull()
    await waitFor(() => {
      expect(container.querySelector('.mermaid')?.innerHTML).toContain('mock-mermaid')
    })
  })

  it('neutralizes javascript: URLs', () => {
    const { container } = render(<Markdown content={'[click](javascript:alert(1))'} />)
    const a = container.querySelector('a')
    expect(a).not.toBeNull()
    expect(a?.getAttribute('href') ?? '').not.toContain('javascript:')
  })

  it('opens external links in a new tab safely', () => {
    const { container } = render(<Markdown content={'[ext](https://example.com)'} />)
    const a = container.querySelector('a')
    expect(a?.getAttribute('target')).toBe('_blank')
    expect(a?.getAttribute('rel') ?? '').toContain('noopener')
  })

  it('does not render raw HTML markup', () => {
    const { container } = render(<Markdown content={'safe <img src=x onerror=alert(1)> text'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('safe')
  })

  it('preserves file:// links (used by the plan reviewer)', () => {
    const { container } = render(<Markdown content={'[open](file:///Users/me/x.ts)'} />)
    const a = container.querySelector('a')
    expect(a?.getAttribute('href')).toBe('file:///Users/me/x.ts')
    // local links must stay in-page so PlanReview can intercept the click
    expect(a?.getAttribute('target')).toBeNull()
  })

  it('renders empty content without throwing', () => {
    const { container } = render(<Markdown content="" />)
    expect(container).toBeTruthy()
  })
})
