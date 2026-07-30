# Gridline Web design system

Gridline is diffing's shared terminal-native visual language. The Rust TUI
defines the original semantic contract in `crates/diffing-tui/src/ui/gridline.rs`;
the browser adapter lives in `src/ui/styles/gridline.css`.

## Product character

The browser should feel like a terminal workspace with richer input and
navigation, not a dashboard decorated with terminal fonts. Hierarchy comes
from monospaced type, alignment, density, and one-pixel rules. Persistent
surfaces stay flat. Color communicates state instead of ornament.

## Invariants

- Persistent chrome uses solid surfaces and one-pixel separators. No glass,
  blur, glow, gradient, or hover elevation.
- Surface corners are square or shallow. Portalled overlays may use a 4px
  radius and one shadow to separate them from the document.
- Accent rails are functional: active navigation and keyboard focus only.
  Context banners and notices never receive decorative side stripes.
- Pills are reserved for compact status/count data. Buttons, filters, tabs,
  and paths use rectangular geometry.
- UI and code remain mono-first. Weight and tone establish hierarchy before
  size changes do.
- Static visual styling belongs in Gridline or the owning component stylesheet.
  Inline styles are only for runtime coordinates, measurements, and CSS custom
  properties.
- Every theme must preserve readable primary text and a visible focus color.

## Semantic roles

Gridline Web exposes `--gl-*` roles for canvas, surface, raised, element,
hover, active, selection, selection-hover, text, code, gutter, rules, focus,
accent, feedback, and diff surfaces. Hover never substitutes for selection or
focus: it is a quiet surface change, selection carries accent, and keyboard
focus keeps its own outline. Components consume these roles; themes continue
to provide the palette through the existing `--bg-*`, `--text-*`, and feedback
variables. Raised and element surfaces are derived from each theme's canvas
pair instead of trusting a theme's tertiary token to be a readable surface.
Subtle and muted text are likewise derived and must retain AA contrast on all
persistent Gridline surfaces.

Geometry is based on a 4px unit, a 44px application bar, 28px controls, 24px
compact controls, 2px component corners, and 4px overlay corners.

## Component decisions

- Toolbar: solid 44px status strip with quiet rectangular controls.
- Sidebar: flat pane divided from content by one rule.
- Context summary: flat two-row terminal record; no accent stripe or card lift.
- Diff file: edge-defined pane with a 32px header and no hover elevation.
- Comments: status dots carry lifecycle state; the card border stays neutral,
  long content wraps, and both open and collapsed cards are viewport-capped.
- Modal/popover/select: shared raised surface, rule, radius, and overlay shadow.
  Blocking decisions and short text-entry flows use the shared Base UI modal
  primitives; browser-native alert, confirm, and prompt dialogs are forbidden.
  Destructive decisions focus Cancel first, expose busy/error states, and keep
  their semantic action color through hover and focus in every theme.
- Vim status: viewport-edge status line rather than a floating glass pill.
- Loading: skeletons use the same bar, pane, and file-card geometry as the
  final UI so hydration does not cause a layout jump.
- Viewport: full-height panes use dynamic viewport units and bottom chrome
  accounts for safe-area insets.

## Change checklist

Before adding or changing UI, verify:

1. Does an existing Gridline semantic role express the intent?
2. Is color communicating a real state?
3. Is a border structural or interactive rather than decorative?
4. Is a rounded shape truly status data?
5. Does focus remain visible without relying on hover?
6. Does the surface work in Rosé Pine, GitHub Light, and a high-contrast theme?
7. Are compact density and narrow layouts still usable?

Run `pnpm test:ts` and `pnpm build:ts` after design-system changes.
