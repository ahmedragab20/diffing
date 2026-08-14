import type {
  MockupAnchorKind,
  MockupComment,
  MockupViewport,
} from '../../lib/mockup-types'
import { commentViewport } from '../../lib/mockup-types'

const KIND_LABEL: Record<MockupAnchorKind, string> = {
  section: 'section',
  block: 'block',
  point: 'pin',
}

function chip(key: string, className: string, children: string, title: string) {
  return (
    <span
      key={key}
      className={`plan-comment-line-chip ${className}`}
      title={title}
    >
      {children}
    </span>
  )
}

/**
 * Compact scope chips for a mockup comment: anchor kind + target/selector,
 * version and viewport. Mirrors the plan thread's location chips so the two
 * review surfaces read identically.
 */
export function MockupLocationChips({
  comment,
  compact,
}: {
  comment: Pick<
    MockupComment,
    | 'kind'
    | 'target'
    | 'selector'
    | 'createdAtMockupVersion'
    | 'viewport'
    | 'x'
    | 'y'
  >
  /** Hide the kind+target pair (rail already labels the row). */
  compact?: boolean
}) {
  const viewport: MockupViewport = commentViewport(comment as MockupComment)
  const chips: React.ReactNode[] = []
  if (!compact) {
    const loc =
      comment.kind === 'section'
        ? comment.target ?? 'region'
        : comment.kind === 'point'
          ? `${comment.x ?? 0}%, ${comment.y ?? 0}%`
          : comment.selector ?? 'element'
    chips.push(
      chip(
        'kind',
        'mockup-loc-chip-kind',
        `${KIND_LABEL[comment.kind]} · ${loc}`,
        `Anchor: ${KIND_LABEL[comment.kind]} · ${loc}`,
      ),
    )
  }
  chips.push(
    chip(
      'version',
      'mockup-loc-chip-version',
      `v${comment.createdAtMockupVersion}`,
      `Mockup version ${comment.createdAtMockupVersion}`,
    ),
  )
  chips.push(
    chip(
      'viewport',
      'mockup-loc-chip-viewport',
      viewport,
      `Anchored at ${viewport} width`,
    ),
  )
  return <span className="mockup-loc-chips">{chips}</span>
}
