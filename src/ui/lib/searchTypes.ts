/**
 * Wire shapes for the `/api/search` endpoint, mirrored on the client.
 *
 * These intentionally duplicate the server's `src/lib/search.ts` response
 * interfaces rather than importing them: `search.ts` pulls in the native
 * `@ff-labs/fff-node` addon and Node built-ins, none of which can (or should)
 * end up in the browser bundle. Keeping a small client-side copy guarantees the
 * Vite client never reaches across that boundary.
 */

export type MatchRange = [number, number]

export interface FileHit {
  path: string
  fileName: string
  gitStatus: string
  matchType: string
  exact: boolean
}

export interface ContentHit {
  path: string
  fileName: string
  line: number
  col: number
  content: string
  matchRanges: MatchRange[]
  gitStatus: string
}

export interface SymbolHit {
  name: string
  kind: string
  path: string
  fileName: string
  line: number
  content: string
  matchRanges: MatchRange[]
  gitStatus: string
}

export type Scope = 'all' | 'files' | 'text' | 'symbols'

interface BaseResponse {
  total: number
  indexing: boolean
  error?: string
  regexError?: string
}
export interface FilesResponse extends BaseResponse {
  scope: 'files'
  items: FileHit[]
}
export interface ContentResponse extends BaseResponse {
  scope: 'text'
  items: ContentHit[]
}
export interface SymbolsResponse extends BaseResponse {
  scope: 'symbols'
  items: SymbolHit[]
}
export interface AllResponse extends BaseResponse {
  scope: 'all'
  items: (
    | { kind: 'file'; hit: FileHit }
    | { kind: 'text'; hit: ContentHit }
    | { kind: 'symbol'; hit: SymbolHit }
  )[]
}
export type SearchResponse = FilesResponse | ContentResponse | SymbolsResponse | AllResponse
