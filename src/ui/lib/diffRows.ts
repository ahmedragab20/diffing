import type { AnnotationSide } from "@pierre/diffs";

export function findElementInElOrShadow(root: Element | ShadowRoot, selector: string): HTMLElement[] {
  const elements = Array.from(root.querySelectorAll<HTMLElement>(selector));
  for (const descendant of root.querySelectorAll("*")) {
    if (descendant.shadowRoot) elements.push(...findElementInElOrShadow(descendant.shadowRoot, selector));
  }
  return elements;
}

/** Changed rows identify their side; split context rows identify it on the column. */
export function rowMatchesSide(row: HTMLElement, side: AnnotationSide): boolean {
  const type = row.getAttribute("data-line-type");
  if (type === "addition" || type === "change-addition") return side === "additions";
  if (type === "deletion" || type === "change-deletion") return side === "deletions";
  if (type && type !== "context" && type !== "context-expanded") return false;
  const column = row.closest("[data-additions], [data-deletions]");
  return column ? column.hasAttribute(`data-${side}`) : true;
}

export function findDiffLine(root: Element, line: number, side: AnnotationSide): HTMLElement | undefined {
  return findElementInElOrShadow(root, `[data-line="${line}"]`).find(row => rowMatchesSide(row, side));
}

/** A very tall wrapped line only needs its beginning visible. */
export function isLineVisible(row: HTMLElement): boolean {
  const rect = row.getBoundingClientRect();
  let host: Element = row;
  while (host.getRootNode() instanceof ShadowRoot) {
    host = (host.getRootNode() as ShadowRoot).host;
  }
  const header = host.closest(".file-diff-card")?.querySelector(".file-diff-card-header");
  const visibleTop = Math.max(0, header?.getBoundingClientRect().bottom ?? 0);
  return rect.height > 0 && rect.top >= visibleTop && rect.top < window.innerHeight &&
    Math.min(rect.bottom, rect.top + 24) <= window.innerHeight;
}
