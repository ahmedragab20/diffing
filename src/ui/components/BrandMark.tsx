import { memo } from 'react'

interface BrandMarkProps {
  /** Square size in pixels. */
  size?: number
  /** Optional className for spacing/sizing overrides. */
  className?: string
  /** Decorative only when true (the default); set false when the icon
   *  carries unique information conveyed elsewhere on the page. */
  decorative?: boolean
}

/**
 * The diffing brand mark — the same adorable gradient SVG used as the
 * browser favicon, the toolbar logo in the diff and plan surfaces, and the
 * boot loader. Reused wherever the app shows a recognizable face so users
 * always know they're inside diffing.
 */
export const BrandMark = memo(function BrandMark({
  size = 22,
  className,
  decorative = true,
}: BrandMarkProps) {
  return (
    <img
      className={className ?? 'brand-mark'}
      src="/favicon.svg"
      alt={decorative ? '' : 'diffing'}
      width={size}
      height={size}
      draggable={false}
    />
  )
})
