/**
 * Multi-language symbol/definition recognition.
 *
 * These patterns identify a line that *defines* a named symbol (function,
 * class, type, …) and capture the symbol's name. They are deliberately
 * lightweight (regex, not a real parser) — good enough to power a "jump to
 * definition"-style search across a handful of common languages.
 *
 * Lives in `lib/` (framework-agnostic) so it can be reused by the server-side
 * fff-powered symbol search. Previously this logic lived in the client-only
 * `useSymbols` hook and only saw changed diff lines; it now classifies grep
 * hits from anywhere in the repository.
 */

export interface SymbolMatch {
  name: string
  kind: string
}

interface SymbolPattern {
  pattern: RegExp
  kind: string
  nameGroup: number
}

export const SYMBOL_PATTERNS: SymbolPattern[] = [
  { pattern: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w[\w$]*)\s*[<(]/i, kind: 'function', nameGroup: 1 },
  { pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+(\w[\w$]*)\s*=\s*(?:async\s*)?\(/i, kind: 'function', nameGroup: 1 },
  { pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+(\w[\w$]*)\s*=\s*(?:async\s+)?function/i, kind: 'function', nameGroup: 1 },
  { pattern: /^\s*(?:export\s+)?class\s+(\w[\w$]*)/i, kind: 'class', nameGroup: 1 },
  { pattern: /^\s*(?:export\s+)?interface\s+(\w[\w$]*)/i, kind: 'interface', nameGroup: 1 },
  { pattern: /^\s*(?:export\s+)?type\s+(\w[\w$]*)\s*=/i, kind: 'type', nameGroup: 1 },
  { pattern: /^\s*(?:export\s+)?enum\s+(\w[\w$]*)/i, kind: 'enum', nameGroup: 1 },
  { pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+(\w[\w$]*)\s*=/i, kind: 'variable', nameGroup: 1 },
  { pattern: /^\s*def\s+(\w[\w$]*)\s*\(/i, kind: 'function', nameGroup: 1 },
  { pattern: /^\s*(?:pub(?:\s*\(\w+\))?\s+)?fn\s+(\w[\w$]*)\s*[<(]/i, kind: 'function', nameGroup: 1 },
  { pattern: /^\s*(?:pub(?:\s*\(\w+\))?\s+)?struct\s+(\w[\w$]*)/i, kind: 'struct', nameGroup: 1 },
  { pattern: /^\s*(?:pub(?:\s*\(\w+\))?\s+)?enum\s+(\w[\w$]*)/i, kind: 'enum', nameGroup: 1 },
  { pattern: /^\s*(?:pub(?:\s*\(\w+\))?\s+)?impl\s+(\w[\w$]*)/i, kind: 'impl', nameGroup: 1 },
  { pattern: /^\s*(?:pub(?:\s*\(\w+\))?\s+)?trait\s+(\w[\w$]*)/i, kind: 'trait', nameGroup: 1 },
  { pattern: /^\s*func\s+(\w[\w$]*)\s*\(/i, kind: 'function', nameGroup: 1 },
  { pattern: /^\s*(?:func\s+)?\((\w[\w$]*)\s+\*?\w+\)\s+(\w[\w$]*)\s*\(/i, kind: 'method', nameGroup: 2 },
]

/**
 * Returns the symbol defined on this line (name + kind), or null if the line
 * is not a recognizable definition. The first matching pattern wins.
 */
export function classifySymbolLine(line: string): SymbolMatch | null {
  for (const { pattern, kind, nameGroup } of SYMBOL_PATTERNS) {
    const match = pattern.exec(line)
    if (match) {
      const name = match[nameGroup]
      if (name) return { name, kind }
    }
  }
  return null
}
