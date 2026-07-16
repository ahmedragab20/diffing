import React from 'react'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
}

/**
 * Defensive error boundary for the file-tree sidebar. `@pierre/trees` throws
 * hard ("Path collides with an existing entry") if the path list contains
 * duplicates or file↔directory collisions, which would otherwise take down
 * the entire review UI. This boundary catches the throw, logs it for the
 * developer console, and renders a small inline fallback so the rest of the
 * review (diffs, comments, plan) stays usable.
 */
export class FileTreeErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('FileTree crashed:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: 16,
            textAlign: 'center',
            color: 'var(--text-muted, #888)',
          }}
        >
          <p>⚠️ File tree failed to render.</p>
          <p style={{ fontSize: '0.85em' }}>Reload the review to retry.</p>
        </div>
      )
    }
    return this.props.children
  }
}
