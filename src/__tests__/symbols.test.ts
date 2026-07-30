import { describe, expect, it } from 'vitest'
import { mergeSearchResponses, type ContentHit, type FileHit, type SymbolHit } from '../lib/search.js'
import { classifySymbolLine } from '../lib/symbols.js'

describe('classifySymbolLine', () => {
  it.each([
    ['export const loadData = async id => fetch(id)', 'loadData', 'function'],
    ['public async loadUser(id: string): Promise<User> {', 'loadUser', 'method'],
    ['export default class SearchPalette {', 'SearchPalette', 'class'],
    ['async def fetch_user(user_id):', 'fetch_user', 'function'],
    ['pub(crate) async fn render_search() {', 'render_search', 'function'],
    ['impl<T> Service<T> {', 'Service', 'impl'],
    ['func (s *Server) Start() error {', 'Start', 'method'],
    ['type SearchResult struct {', 'SearchResult', 'type'],
  ])('recognizes %s', (line, name, kind) => {
    expect(classifySymbolLine(line)).toEqual({ name, kind })
  })

  it.each([
    ['function helpers($x) {', 'helpers', 'function'],
    ['public function handle(): void {', 'handle', 'function'],
    ['private static function boot(): void', 'boot', 'function'],
    ['abstract class BaseController', 'BaseController', 'class'],
    ['final readonly class Dto', 'Dto', 'class'],
    ['interface RepositoryInterface', 'RepositoryInterface', 'interface'],
    ['trait HasFactory', 'HasFactory', 'trait'],
    ['enum Status: string', 'Status', 'enum'],
    ['namespace App\\Http\\Controllers;', 'App\\Http\\Controllers', 'namespace'],
  ])('recognizes PHP %s', (line, name, kind) => {
    expect(classifySymbolLine(line)).toEqual({ name, kind })
  })

  it.each([
    'if (ready) {',
    'render_search()',
    '// function notARealSymbol() {}',
    'return value',
    'if ($ready) {',
    'new class {',
    'use App\\Models\\User;',
    'fn () => 1',
  ])('rejects non-definitions: %s', (line) => {
    expect(classifySymbolLine(line)).toBeNull()
  })
})

describe('mergeSearchResponses', () => {
  const file: FileHit = {
    path: 'src/search.ts',
    fileName: 'search.ts',
    gitStatus: 'modified',
    matchType: 'fuzzy',
    exact: false,
  }
  const definitionText: ContentHit = {
    path: 'src/search.ts',
    fileName: 'search.ts',
    line: 42,
    col: 4,
    content: 'export function searchSymbols() {',
    matchRanges: [[16, 29]],
    gitStatus: 'modified',
  }
  const otherText: ContentHit = {
    ...definitionText,
    line: 84,
    content: 'return searchSymbols(query)',
  }
  const symbol: SymbolHit = {
    name: 'searchSymbols',
    kind: 'function',
    path: definitionText.path,
    fileName: definitionText.fileName,
    line: definitionText.line,
    content: definitionText.content,
    matchRanges: definitionText.matchRanges,
    gitStatus: definitionText.gitStatus,
  }

  it('keeps the richer symbol row and removes its duplicate text row', () => {
    const response = mergeSearchResponses(
      { scope: 'files', items: [file], total: 1, indexing: false },
      {
        scope: 'text',
        items: [definitionText, otherText],
        total: 2,
        indexing: false,
        regexError: 'fallback warning',
      },
      { scope: 'symbols', items: [symbol], total: 1, indexing: false },
      10,
    )

    expect(response.items.map((item) => item.kind)).toEqual(['file', 'symbol', 'text'])
    expect(response.total).toBe(3)
    expect(response.regexError).toBe('fallback warning')
  })

  it('honors the requested result limit after merging scopes', () => {
    const response = mergeSearchResponses(
      { scope: 'files', items: [file], total: 1, indexing: false },
      { scope: 'text', items: [otherText], total: 1, indexing: false },
      { scope: 'symbols', items: [symbol], total: 1, indexing: false },
      2,
    )
    expect(response.items).toHaveLength(2)
  })
})
