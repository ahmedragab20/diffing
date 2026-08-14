/**
 * Soft guidance for mockup authors. Diffing's hard rule is "one state per
 * screen": every distinct state/variant/case must be its own screen, never
 * in-page tabs, accordions, toggles, modals, or dropdowns that swap content.
 *
 * These detectors flag the common in-page state UI patterns so an agent gets
 * an actionable hint at submit time instead of a reviewer catching it later.
 * Detection is intentionally heuristic and non-blocking — a form checkbox is
 * not flagged (it is an input, not an alternate-case toggle).
 */

export interface MockupStateHint {
 /** Screen id that contains the pattern. */
 screenId: string;
 /** Human-readable, deduped list of the state patterns found. */
 patterns: string[];
 /** Actionable guidance for the author. */
 message: string;
}

interface PatternRule {
 label: string;
 re: RegExp;
}

const RULES: PatternRule[] = [
 { label: "tabs", re: /role\s*=\s*["']tab(list|panel)?["']/i },
 { label: "tabs", re: /aria-selected\s*=/i },
 { label: "tabs", re: /data-(?:bs-)?toggle\s*=\s*["'](?:tab|pill)["']/i },
 { label: "tabs", re: /\bdata-tabs?\s*=/i },
 { label: "accordion", re: /<details[\s>]/i },
 { label: "accordion", re: /data-(?:bs-)?toggle\s*=\s*["']collapse["']/i },
 { label: "accordion", re: /class\s*=\s*["'][^"']*\baccordion\b/i },
 { label: "modal", re: /role\s*=\s*["'](?:alert)?dialog["']/i },
 { label: "modal", re: /data-(?:bs-)?toggle\s*=\s*["']modal["']/i },
 { label: "modal", re: /class\s*=\s*["'][^"']*\bmodal\b/i },
 { label: "dropdown", re: /role\s*=\s*["']menu(?:bar)?["']/i },
 { label: "dropdown", re: /data-(?:bs-)?toggle\s*=\s*["']dropdown["']/i },
 { label: "dropdown", re: /class\s*=\s*["'][^"']*\bdropdown\b/i },
 { label: "toggle", re: /role\s*=\s*["']switch["']/i },
 { label: "toggle", re: /class\s*=\s*["'][^"']*\b(?:toggle|switch)\b/i },
];

const ORDERED_LABELS = [
 "tabs",
 "accordion",
 "modal",
 "dropdown",
 "toggle",
] as const;

/** Find the in-page state UI patterns present in one screen's HTML. */
export function detectInPageState(html: string): string[] {
 const found = new Set<string>();
 for (const rule of RULES) {
  if (found.has(rule.label)) continue;
  if (rule.re.test(html)) found.add(rule.label);
 }
 // Stable, canonical ordering for readable output.
 return ORDERED_LABELS.filter((label) => found.has(label));
}

/** Build submit-time hints for a set of screens (empty when all clean). */
export function lintMockupScreens(
 screens: Array<{ id: string; html: string }>,
): MockupStateHint[] {
 const hints: MockupStateHint[] = [];
 for (const screen of screens) {
  const patterns = detectInPageState(screen.html);
  if (patterns.length === 0) continue;
  hints.push({
   screenId: screen.id,
   patterns,
   message: `Screen "${screen.id}" contains in-page state UI (${patterns.join(
    ", ",
   )}). Split each state into its own screen instead.`,
  });
 }
 return hints;
}
