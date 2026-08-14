import {
  Check,
  Clock,
  MessageSquare,
  MessageSquareWarning,
  X,
} from "lucide-react";
import type { MockupAnchorKind, MockupViewport } from "../../lib/mockup-types";
import type { MockupDecision } from "../../lib/mockup-types";

export type ViewportPx = 1280 | 768 | 390;

export const VIEWPORT_LABEL: Record<ViewportPx, MockupViewport> = {
  1280: "desktop",
  768: "tablet",
  390: "mobile",
};

/** Reverse lookup: canonical layout width for a viewport label. */
export const VIEWPORT_PX: Record<MockupViewport, ViewportPx> = {
  desktop: 1280,
  tablet: 768,
  mobile: 390,
};

export const VIEWPORT_OPTIONS: {
  value: ViewportPx;
  label: string;
  viewport: MockupViewport;
}[] = [
  { value: 1280, label: "Desktop", viewport: "desktop" },
  { value: 768, label: "Tablet", viewport: "tablet" },
  { value: 390, label: "Mobile", viewport: "mobile" },
];

export const DECISION_META: Record<
  MockupDecision,
  { icon: typeof Check; className: string; label: string }
> = {
  pending: { icon: Clock, className: "plan-badge-pending", label: "Pending" },
  approved: {
    icon: Check,
    className: "plan-badge-approved",
    label: "Approved",
  },
  "changes-requested": {
    icon: MessageSquareWarning,
    className: "plan-badge-changes",
    label: "Changes",
  },
  rejected: { icon: X, className: "plan-badge-rejected", label: "Rejected" },
  "comment-only": {
    icon: MessageSquare,
    className: "plan-badge-comment-only",
    label: "Comment only",
  },
};

export type MockupPinSource = {
  kind: MockupAnchorKind;
  x?: number;
  y?: number;
  rect?: { x: number; y: number; w: number; h: number };
};

/** Prefer the click point so several comments on one section don't stack. */
export function pinPercent(c: MockupPinSource): { x: number; y: number } {
  if (c.x !== undefined && c.y !== undefined) return { x: c.x, y: c.y };
  if (c.rect) return { x: c.rect.x + 4, y: c.rect.y + 4 };
  return { x: 4, y: 4 };
}

/** How many earlier pins share this anchor — offsets the number badge. */
export function pinStackOffset(
  comments: MockupPinSource[],
  index: number,
): number {
  const base = pinPercent(comments[index]);
  let n = 0;
  for (let i = 0; i < index; i++) {
    const p = pinPercent(comments[i]);
    if (Math.hypot(p.x - base.x, p.y - base.y) < 2.5) n += 1;
  }
  return n;
}

export function hitLabel(hit: {
  kind: MockupAnchorKind;
  target?: string;
  selector?: string;
  x?: number;
  y?: number;
}): string {
  if (hit.kind === "section") return `section · ${hit.target ?? "region"}`;
  if (hit.kind === "point") return `pin · ${hit.x ?? 0}%, ${hit.y ?? 0}%`;
  return `block · ${hit.selector ?? "element"}`;
}
