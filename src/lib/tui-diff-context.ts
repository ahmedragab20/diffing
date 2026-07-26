import type { DiffOptions } from './diff-options.js'

export type TuiDiffContextKind =
  | 'working-tree'
  | 'staged-only'
  | 'range'
  | 'commit'

export interface TuiDiffContext {
  kind: TuiDiffContextKind
  headline: string
  detail?: string
}

/**
 * Build the compact "what is this diff?" label consumed by the native TUI.
 *
 * This deliberately uses the options the CLI already parsed instead of
 * executing the diff a second time just to reproduce the web overview.
 * File and line counts are added by the TUI from its live sparse index.
 */
export function buildTuiDiffContext(
  opts: DiffOptions,
  branch: string,
): TuiDiffContext {
  const onBranch = branch ? ` on ${branch}` : ''
  const detail = pathspecDetail(opts.pathspecs)

  if (opts.showMode) {
    const label = opts.showRevspecs.join(' ')
    return {
      kind: 'commit',
      headline: label ? `Showing ${label}` : 'Commit changes',
      ...(detail ? { detail } : {}),
    }
  }

  if (opts.revisions.length > 0) {
    const current = branch ? ` (current: ${branch})` : ''
    return {
      kind: 'range',
      headline: `Comparing ${opts.revisions.join(' ')}${current}`,
      ...(detail ? { detail } : {}),
    }
  }

  if (opts.staged) {
    return {
      kind: 'staged-only',
      headline: `Staged changes${onBranch}`,
      ...(detail ? { detail } : {}),
    }
  }

  return {
    kind: 'working-tree',
    headline: `Working-tree changes${onBranch}`,
    ...(detail ? { detail } : {}),
  }
}

function pathspecDetail(pathspecs: string[]): string | undefined {
  if (pathspecs.length === 0) return undefined
  if (pathspecs.length === 1) return `Path: ${pathspecs[0]}`
  return `${pathspecs.length} path filters`
}
