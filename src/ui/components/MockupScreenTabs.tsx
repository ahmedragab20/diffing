import type { MockupScreen } from '../../lib/mockup-types'

export interface MockupScreenTabsProps {
  screens: MockupScreen[]
  activeScreenId: string | null
  /** Open counts scoped to the current version + viewport, keyed by screen id. */
  openCounts: Record<string, number>
  onSelect: (screenId: string) => void
}

/** Screen tabs with open counts scoped to the current version + viewport. */
export function MockupScreenTabs({
  screens,
  activeScreenId,
  openCounts,
  onSelect,
}: MockupScreenTabsProps) {
  return (
    <div
      className="plan-view-toggle mockup-screen-tabs"
      role="tablist"
      aria-label="Screens"
    >
      {screens.map((s) => {
        const n = openCounts[s.id] ?? 0
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={s.id === activeScreenId}
            className={`plan-view-toggle-btn ${s.id === activeScreenId ? 'is-active' : ''}`}
            onClick={() => onSelect(s.id)}
            title={`${s.label} — ${n} open in this view`}
          >
            <span>{s.label}</span>
            {n > 0 && (
              <span
                className="mockup-screen-tab-count"
                aria-label={`${n} open`}
              >
                {n}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
