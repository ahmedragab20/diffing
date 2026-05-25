import { useMemo } from 'react'
import type { FileDiffMetadata } from '@pierre/diffs'

export interface SymbolEntry {
  name: string
  kind: string
  filePath: string
  lineNumber: number
  side: 'additions' | 'deletions'
}

const SYMBOL_PATTERNS: { pattern: RegExp; kind: string; nameGroup: number }[] = [
  { pattern: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w[\w$]*)\s*[<(]/i, kind: 'function', nameGroup: 1 },
  { pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+(\w[\w$]*)\s*=\s*(?:async\s*)?\(/i, kind: 'function', nameGroup: 1 },
  { pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+(\w[\w$]*)\s*=\s*(?:async\s+)?function/i, kind: 'function', nameGroup: 1 },
  { pattern: /^\s*(?:export\s+)?class\s+(\w[\w$]*)/i, kind: 'class', nameGroup: 1 },
  { pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+(\w[\w$]*)\s*=/i, kind: 'variable', nameGroup: 1 },
  { pattern: /^\s*(?:export\s+)?interface\s+(\w[\w$]*)/i, kind: 'interface', nameGroup: 1 },
  { pattern: /^\s*(?:export\s+)?type\s+(\w[\w$]*)\s*=/i, kind: 'type', nameGroup: 1 },
  { pattern: /^\s*(?:export\s+)?enum\s+(\w[\w$]*)/i, kind: 'enum', nameGroup: 1 },
  { pattern: /^\s*def\s+(\w[\w$]*)\s*\(/i, kind: 'function', nameGroup: 1 },
  { pattern: /^\s*(?:pub(?:\s*\(\w+\))?\s+)?fn\s+(\w[\w$]*)\s*[<(]/i, kind: 'function', nameGroup: 1 },
  { pattern: /^\s*(?:pub(?:\s*\(\w+\))?\s+)?struct\s+(\w[\w$]*)/i, kind: 'struct', nameGroup: 1 },
  { pattern: /^\s*(?:pub(?:\s*\(\w+\))?\s+)?enum\s+(\w[\w$]*)/i, kind: 'enum', nameGroup: 1 },
  { pattern: /^\s*(?:pub(?:\s*\(\w+\))?\s+)?impl\s+(\w[\w$]*)/i, kind: 'impl', nameGroup: 1 },
  { pattern: /^\s*(?:pub(?:\s*\(\w+\))?\s+)?trait\s+(\w[\w$]*)/i, kind: 'trait', nameGroup: 1 },
  { pattern: /^\s*func\s+(\w[\w$]*)\s*\(/i, kind: 'function', nameGroup: 1 },
  { pattern: /^\s*(?:func\s+)?\((\w[\w$]*)\s+\*?\w+\)\s+(\w[\w$]*)\s*\(/i, kind: 'method', nameGroup: 2 },
]

function extractSymbolsFromLines(
  lines: string[],
  lineIndex: number,
  lineStart: number,
  side: 'additions' | 'deletions',
  filePath: string,
  symbols: SymbolEntry[],
) {
  for (let i = 0; i < lines.length; i++) {
    const lineNumber = lineStart + i
    for (const { pattern, kind, nameGroup } of SYMBOL_PATTERNS) {
      const match = pattern.exec(lines[i])
      if (match) {
        const name = match[nameGroup]
        if (name) {
          symbols.push({ name, kind, filePath, lineNumber, side })
          break
        }
      }
    }
  }
}

export function useSymbols(files: FileDiffMetadata[]): SymbolEntry[] {
  return useMemo(() => {
    const symbols: SymbolEntry[] = []

    for (const file of files) {
      for (const hunk of file.hunks) {
        // Extract from addition lines
        const additionOffset = hunk.additionLineIndex
        const additionCount = hunk.additionCount
        if (additionCount > 0) {
          const additionSlice = file.additionLines.slice(additionOffset, additionOffset + additionCount)
          extractSymbolsFromLines(additionSlice, additionOffset, hunk.additionStart, 'additions', file.name, symbols)
        }

        // Extract from deletion lines
        const deletionOffset = hunk.deletionLineIndex
        const deletionCount = hunk.deletionCount
        if (deletionCount > 0) {
          const deletionSlice = file.deletionLines.slice(deletionOffset, deletionOffset + deletionCount)
          extractSymbolsFromLines(deletionSlice, deletionOffset, hunk.deletionStart, 'deletions', file.name, symbols)
        }
      }
    }

    return symbols
  }, [files])
}
