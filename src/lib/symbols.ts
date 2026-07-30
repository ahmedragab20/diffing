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
  // JavaScript / TypeScript
  { pattern: /^\s*(?:(?:export|declare)\s+)*(?:default\s+)?(?:async\s+)?function\s+(\w[\w$]*)\s*[<(]/i, kind: 'function', nameGroup: 1 },
  { pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+(\w[\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w[\w$]*)\s*=>/i, kind: 'function', nameGroup: 1 },
  { pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+(\w[\w$]*)\s*=\s*(?:async\s+)?function/i, kind: 'function', nameGroup: 1 },
  { pattern: /^\s*(?:(?:export|declare)\s+)*(?:default\s+)?(?:abstract\s+)?class\s+(\w[\w$]*)/i, kind: 'class', nameGroup: 1 },
  { pattern: /^\s*(?:(?:export|declare)\s+)*interface\s+(\w[\w$]*)/i, kind: 'interface', nameGroup: 1 },
  { pattern: /^\s*(?:(?:export|declare)\s+)*type\s+(\w[\w$]*)\s*=/i, kind: 'type', nameGroup: 1 },
  { pattern: /^\s*(?:(?:export|declare)\s+)*(?:const\s+)?enum\s+(\w[\w$]*)/i, kind: 'enum', nameGroup: 1 },
  { pattern: /^\s*namespace\s+((?:\w[\w$]*(?:\\\w[\w$]*)*)+)\s*;/i, kind: 'namespace', nameGroup: 1 },
  { pattern: /^\s*(?:(?:export|declare)\s+)*namespace\s+(\w[\w$]*)/i, kind: 'namespace', nameGroup: 1 },
  { pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+(\w[\w$]*)\s*=/i, kind: 'variable', nameGroup: 1 },
  // PHP before JS method — visibility + `function` must not capture `function` as the name
  { pattern: /^\s*(?:(?:public|private|protected|static|abstract|final)\s+)+function\s+(\w[\w$]*)\s*\(/i, kind: 'function', nameGroup: 1 },
  { pattern: /^\s*(?:(?:abstract|final|readonly)\s+)+class\s+(\w[\w$]*)/i, kind: 'class', nameGroup: 1 },
  { pattern: /^\s*(?!(?:if|for|while|switch|catch)\b)(?:(?:public|private|protected|static|async|abstract|readonly|override|get|set)\s+)*(\w[\w$]*)\s*(?:<[^>]+>)?\s*\([^)]*\)\s*(?:\{|:[^={]+[;{])/i, kind: 'method', nameGroup: 1 },

  // Python
  { pattern: /^\s*(?:async\s+)?def\s+(\w[\w$]*)\s*\(/i, kind: 'function', nameGroup: 1 },
  { pattern: /^\s*class\s+(\w[\w$]*)\s*(?:\(|:)/i, kind: 'class', nameGroup: 1 },

  // Rust
  { pattern: /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:(?:async|const|unsafe)\s+|extern(?:\s+"[^"]+")?\s+)*fn\s+(\w[\w$]*)\s*[<(]/i, kind: 'function', nameGroup: 1 },
  { pattern: /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?struct\s+(\w[\w$]*)/i, kind: 'struct', nameGroup: 1 },
  { pattern: /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?enum\s+(\w[\w$]*)/i, kind: 'enum', nameGroup: 1 },
  { pattern: /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?trait\s+(\w[\w$]*)/i, kind: 'trait', nameGroup: 1 },
  { pattern: /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:type|mod)\s+(\w[\w$]*)/i, kind: 'type', nameGroup: 1 },
  { pattern: /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?impl(?:<[^>]+>)?\s+[^\s]+\s+for\s+(\w[\w$]*)/i, kind: 'impl', nameGroup: 1 },
  { pattern: /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?impl(?:<[^>]+>)?\s+(\w[\w$]*)/i, kind: 'impl', nameGroup: 1 },
  { pattern: /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:const|static)\s+(\w[\w$]*)\s*[:=]/i, kind: 'variable', nameGroup: 1 },

  // Go
  { pattern: /^\s*func\s+\([^)]*\)\s+(\w[\w$]*)\s*\(/i, kind: 'method', nameGroup: 1 },
  { pattern: /^\s*func\s+(\w[\w$]*)\s*\(/i, kind: 'function', nameGroup: 1 },
  { pattern: /^\s*type\s+(\w[\w$]*)\s+(?:struct|interface|=)/i, kind: 'type', nameGroup: 1 },
  { pattern: /^\s*(?:var|const)\s+(\w[\w$]*)\b/i, kind: 'variable', nameGroup: 1 },
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
