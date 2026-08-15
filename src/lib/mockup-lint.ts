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

export type MockupHintKind = "state" | "style";

export interface MockupStateHint {
 /** Screen id that contains the pattern. */
 screenId: string;
 /** `state` = in-page UI that should be split; `style` = generic/off-brand chrome. */
 kind?: MockupHintKind;
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

const STYLE_RULES: PatternRule[] = [
 { label: "tailwind-cdn", re: /cdn\.tailwindcss\.com/i },
 {
  label: "tailwind-cdn",
  re: /(?:unpkg\.com|cdn\.jsdelivr\.net|esm\.sh)\/(?:npm\/)?tailwindcss/i,
 },
 { label: "google-fonts", re: /fonts\.googleapis\.com/i },
 { label: "google-fonts", re: /fonts\.gstatic\.com/i },
];

const GENERIC_FONT_RE = /font-family\s*:\s*[^;{]*\bInter\b/i;
const GENERIC_INDIGO_RE =
 /#(?:4f46e5|4338ca|6366f1|818cf8|7c3aed|8b5cf6|a78bfa)\b|\b(?:indigo|violet)-(?:[4-9]00|950)\b/i;

/** Off-brand / generic-AI styling that should not ship as the product look. */
export function detectGenericStyle(html: string): string[] {
 const found = new Set<string>();
 for (const rule of STYLE_RULES) {
  if (found.has(rule.label)) continue;
  if (rule.re.test(html)) found.add(rule.label);
 }
 if (GENERIC_FONT_RE.test(html) && GENERIC_INDIGO_RE.test(html)) {
  found.add("generic-palette");
 }
 return ["tailwind-cdn", "google-fonts", "generic-palette"].filter((label) =>
  found.has(label),
 );
}

/** Build submit-time hints for a set of screens (empty when all clean). */
export function lintMockupScreens(
 screens: Array<{ id: string; html: string }>,
): MockupStateHint[] {
 const hints: MockupStateHint[] = [];
 for (const screen of screens) {
  const state = detectInPageState(screen.html);
  if (state.length > 0) {
   hints.push({
    screenId: screen.id,
    kind: "state",
    patterns: state,
    message: `Screen "${screen.id}" contains in-page state UI (${state.join(
     ", ",
    )}). Split each state into its own screen instead.`,
   });
  }
  const style = detectGenericStyle(screen.html);
  if (style.length > 0) {
   hints.push({
    screenId: screen.id,
    kind: "style",
    patterns: style,
    message: `Screen "${screen.id}" looks generic (${style.join(
     ", ",
    )}). Drop CDN Tailwind / Google Fonts and do not invent Inter + indigo — match the product.`,
   });
  }
 }
 return hints;
}

/** Compact submit/revise warning for CLI and MCP. */
export function formatSubmitHints(hints: MockupStateHint[]): string {
 if (hints.length === 0) return "";
 const state = hints.filter((h) => h.kind !== "style");
 const style = hints.filter((h) => h.kind === "style");
 const lines: string[] = [];
 if (state.length > 0) {
  lines.push(
   "⚠️ In-page state UI detected — split each state into its own screen:",
  );
  for (const hint of state) {
   lines.push(`  • ${hint.screenId}: ${hint.patterns.join(", ")}`);
  }
 }
 if (style.length > 0) {
  lines.push(
   "⚠️ Generic styling — match the product (no CDN Tailwind, Google Fonts, or Inter+indigo):",
  );
  for (const hint of style) {
   lines.push(`  • ${hint.screenId}: ${hint.patterns.join(", ")}`);
  }
 }
 return `\n${lines.join("\n")}`;
}
