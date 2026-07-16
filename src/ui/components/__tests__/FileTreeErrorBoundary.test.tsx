// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FileTreeErrorBoundary } from '../FileTreeErrorBoundary'

function ThrowingChild(): never {
  throw new Error('boom')
}

describe('FileTreeErrorBoundary', () => {
  beforeEach(() => {
    // Suppress React's noisy uncaught-error log during boundary tests
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders children normally when no error is thrown', () => {
    render(
      <FileTreeErrorBoundary>
        <span data-testid="safe-child">hello</span>
      </FileTreeErrorBoundary>,
    )
    expect(screen.getByTestId('safe-child')).toBeInTheDocument()
    expect(
      screen.queryByText(/File tree failed to render\./),
    ).not.toBeInTheDocument()
  })

  it('renders the fallback UI when a child throws', () => {
    render(
      <FileTreeErrorBoundary>
        <ThrowingChild />
      </FileTreeErrorBoundary>,
    )
    expect(
      screen.getByText(/File tree failed to render\./),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('safe-child')).not.toBeInTheDocument()
  })

  it('logs the crash via console.error when an error is caught', () => {
    render(
      <FileTreeErrorBoundary>
        <ThrowingChild />
      </FileTreeErrorBoundary>,
    )
    // The boundary calls `console.error('FileTree crashed:', error, info.componentStack)`
    // — three args. Assert that AT LEAST ONE call starts with the expected prefix.
    const errorSpy = console.error as unknown as ReturnType<typeof vi.fn>
    const matchingCall = errorSpy.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].startsWith('FileTree crashed:'),
    )
    expect(matchingCall).toBeDefined()
    // The error argument should be the Error instance thrown by the child.
    expect(matchingCall?.[1]).toBeInstanceOf(Error)
    // The third argument is the component stack (a string).
    expect(typeof matchingCall?.[2]).toBe('string')
  })
})
