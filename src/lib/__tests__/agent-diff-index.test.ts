// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  buildAgentDiffIndex,
  indexSummary,
  indexFiles,
  indexHunks,
  indexSlice,
  indexSearch,
  resolveInspectFile,
  AgentDiffIndexCache,
} from '../agent-diff-index.js'
import { compilePathspecGlob, fileMatchesPath } from '../inspect-scope.js'

const SAMPLE = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 line one
-old two
+new two
 line three
+line four
diff --git a/src/b.ts b/src/b.ts
new file mode 100644
index 000..333
--- /dev/null
+++ b/src/b.ts
@@ -0,0 +1,2 @@
+hello
+world
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
index 444..000
--- a/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-bye
`

describe('buildAgentDiffIndex', () => {
  it('parses multi-file patches with kinds and line numbers', () => {
    const index = buildAgentDiffIndex(SAMPLE, 7)
    expect(index.generation).toBe(7)
    expect(index.complete).toBe(true)
    expect(index.files).toHaveLength(3)
    expect(index.files[0].kind).toBe('modified')
    expect(index.files[0].newPath).toBe('src/a.ts')
    expect(index.files[1].kind).toBe('added')
    expect(index.files[2].kind).toBe('deleted')
    expect(index.additions).toBeGreaterThan(0)
    expect(index.deletions).toBeGreaterThan(0)
  })

  it('handles empty patch', () => {
    const index = buildAgentDiffIndex('', 1)
    expect(index.files).toHaveLength(0)
    expect(index.totalRows).toBe(0)
  })

  it('marks binary files', () => {
    const patch = `diff --git a/img.png b/img.png
index 111..222 100644
Binary files a/img.png and b/img.png differ
`
    const index = buildAgentDiffIndex(patch, 2)
    expect(index.files).toHaveLength(1)
    expect(index.files[0].isBinary).toBe(true)
    expect(index.files[0].kind).toBe('binary')
  })

  it('parses renames and paths containing spaces', () => {
    const patch = `diff --git a/old name.ts b/new name.ts
similarity index 100%
rename from old name.ts
rename to new name.ts
`
    const index = buildAgentDiffIndex(patch, 3)
    expect(index.files).toHaveLength(1)
    expect(index.files[0]).toMatchObject({
      oldPath: 'old name.ts',
      newPath: 'new name.ts',
      kind: 'renamed',
    })
  })

  it('decodes Git C-quoted paths', () => {
    const patch = `diff --git "a/a\\tb.ts" "b/a\\tb.ts"
--- "a/a\\tb.ts"
+++ "b/a\\tb.ts"
@@ -1 +1 @@
-old
+new
`
    const index = buildAgentDiffIndex(patch, 4)
    expect(index.files[0].newPath).toBe('a\tb.ts')
  })

  it('records mode-only changes with exact modes and no hunks', () => {
    const patch = `diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755
`
    const file = buildAgentDiffIndex(patch).files[0]
    expect(file).toMatchObject({
      oldPath: 'script.sh',
      newPath: 'script.sh',
      kind: 'modified',
      hunks: [],
      rowCount: 1,
      metadata: {
        oldMode: '100644',
        newMode: '100755',
        oldBlob: null,
        newBlob: null,
        submodule: false,
      },
    })
  })

  it('records short submodule metadata and literal rows', () => {
    const patch = `diff --git a/vendor/lib b/vendor/lib
index abc..def 160000
--- a/vendor/lib
+++ b/vendor/lib
@@ -1 +1 @@
-Subproject commit abc
+Subproject commit def
`
    const file = buildAgentDiffIndex(patch).files[0]
    expect(file.metadata).toMatchObject({
      oldMode: '160000',
      newMode: '160000',
      oldBlob: 'abc',
      newBlob: 'def',
      submodule: true,
    })
    expect(Array.from(file.rows)).toEqual([
      expect.objectContaining({ type: 'fileHeader', path: 'vendor/lib' }),
      expect.objectContaining({ type: 'hunkHeader', oldStart: 1, newStart: 1 }),
      expect.objectContaining({ type: 'line', kind: 'del', content: 'Subproject commit abc' }),
      expect.objectContaining({ type: 'line', kind: 'add', content: 'Subproject commit def' }),
    ])
  })

  it('uses null paths for empty mode-only additions and deletions', () => {
    const patch = `diff --git a/new.txt b/new.txt
new file mode 100644
diff --git a/old.txt b/old.txt
deleted file mode 100644
`
    const files = buildAgentDiffIndex(patch).files
    expect(files[0]).toMatchObject({ oldPath: null, newPath: 'new.txt', kind: 'added', hunks: [] })
    expect(files[1]).toMatchObject({ oldPath: 'old.txt', newPath: null, kind: 'deleted', hunks: [] })
  })

  it('preserves CRLF bytes in added row content', () => {
    const patch = `diff --git a/crlf.txt b/crlf.txt
--- a/crlf.txt
+++ b/crlf.txt
@@ -1,2 +1,2 @@
-old\r
+new\r
 context\r
`
    const file = buildAgentDiffIndex(patch).files[0]
    expect(Array.from(file.rows).filter((row) => row.type === 'line').map((row) => row.content)).toEqual([
      'old\r',
      'new\r',
      'context\r',
    ])
  })

  it('indexes a missing-newline marker as its own row', () => {
    const patch = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-old
+new
\\ No newline at end of file
`
    const file = buildAgentDiffIndex(patch).files[0]
    expect(file.rows.at(-1)).toEqual({ type: 'noNewline', hunkIndex: 0 })
  })

  it('preserves mixed source rows across small pages and hunk boundaries', () => {
    const patch = `diff --git a/mixed.txt b/mixed.txt
--- a/mixed.txt
+++ b/mixed.txt
@@ -1,3 +1,3 @@
-old
\\ No newline at end of file
+new\r

 context
@@ -10 +20 @@ later
-before
+after
\\ No newline at end of file
`
    const index = buildAgentDiffIndex(patch)
    const rows = []
    let offset = 0
    do {
      const page = indexSlice(index, 0, offset, 2)
      if ('error' in page) throw new Error(page.error)
      rows.push(...page.rows)
      if (page.nextRow === null) break
      expect(page.nextRow).toBeGreaterThan(offset)
      offset = page.nextRow
    } while (offset < index.files[0].rowCount)
    expect(rows).toEqual([
      expect.objectContaining({ type: 'fileHeader', path: 'mixed.txt' }),
      expect.objectContaining({ type: 'hunkHeader', hunkIndex: 0 }),
      { type: 'line', hunkIndex: 0, kind: 'del', oldLineno: 1, newLineno: null, content: 'old' },
      { type: 'noNewline', hunkIndex: 0 },
      { type: 'line', hunkIndex: 0, kind: 'add', oldLineno: null, newLineno: 1, content: 'new\r' },
      { type: 'line', hunkIndex: 0, kind: 'context', oldLineno: 2, newLineno: 2, content: '' },
      { type: 'line', hunkIndex: 0, kind: 'context', oldLineno: 3, newLineno: 3, content: 'context' },
      expect.objectContaining({ type: 'hunkHeader', hunkIndex: 1 }),
      { type: 'line', hunkIndex: 1, kind: 'del', oldLineno: 10, newLineno: null, content: 'before' },
      { type: 'line', hunkIndex: 1, kind: 'add', oldLineno: null, newLineno: 20, content: 'after' },
      { type: 'noNewline', hunkIndex: 1 },
    ])
    expect(index.files[0]).toMatchObject({ additions: 2, deletions: 2, rowCount: rows.length })
    expect(indexSearch(index, 'after')).toMatchObject({
      hits: [expect.objectContaining({ fileIndex: 0, row: 9, oldLineno: null, newLineno: 20, preview: 'after' })],
    })
  })

  it('parses mixed quoted and unquoted rename paths', () => {
    const patch = `diff --git a/old name.ts "b/new name.ts"
similarity index 100%
rename from old name.ts
rename to new name.ts
`
    const file = buildAgentDiffIndex(patch).files[0]
    expect(file).toMatchObject({ oldPath: 'old name.ts', newPath: 'new name.ts', kind: 'renamed' })
  })

  it('preserves a literal b slash segment in unquoted paths', () => {
    const patch = `diff --git a/literal b/name a/literal b/name
old mode 100644
new mode 100755
`
    const file = buildAgentDiffIndex(patch).files[0]
    expect(file).toMatchObject({ oldPath: 'literal b/name', newPath: 'literal b/name' })
  })

  it('changes patch digests for mode and CR changes but not file position', () => {
    const first = `diff --git a/one.txt b/one.txt
--- a/one.txt
+++ b/one.txt
@@ -1 +1 @@
-old
+new
`
    const second = `diff --git a/two.txt b/two.txt
--- a/two.txt
+++ b/two.txt
@@ -1 +1 @@
-old
+new
`
    const reordered = buildAgentDiffIndex(second + first)
    const ordered = buildAgentDiffIndex(first + second)
    expect(ordered.files[0].metadata.patchDigest).toBe(reordered.files[1].metadata.patchDigest)
    expect(ordered.files[1].metadata.patchDigest).toBe(reordered.files[0].metadata.patchDigest)

    const modeChanged = buildAgentDiffIndex(`diff --git a/one.txt b/one.txt\nold mode 100644\nnew mode 100755\n${first}`).files[0]
    const crChanged = buildAgentDiffIndex(first.replace('+new\n', '+new\r\n')).files[0]
    expect(modeChanged.metadata.patchDigest).not.toBe(ordered.files[0].metadata.patchDigest)
    expect(crChanged.metadata.patchDigest).not.toBe(ordered.files[0].metadata.patchDigest)
  })
})

describe('index paging', () => {
  const index = buildAgentDiffIndex(SAMPLE, 9)

  it('summary counts files and kinds', () => {
    const s = indexSummary(index)
    expect('error' in s).toBe(false)
    if ('error' in s) return
    expect(s.generation).toBe(9)
    expect(s.files).toBe(3)
    expect(s.changes.modified).toBe(1)
    expect(s.changes.added).toBe(1)
    expect(s.changes.deleted).toBe(1)
    expect(s.next).toContain('diff_files')
    expect(s.directories).toEqual([
      expect.objectContaining({ path: 'src', files: 2 }),
      expect.objectContaining({ path: '.', files: 1 }),
    ])
  })

  it('pages files with nextCursor', () => {
    const page = indexFiles(index, 0, 2)
    expect('files' in page && page.returned).toBe(2)
    expect('nextCursor' in page && page.nextCursor).toBe(2)
    expect('matched' in page && page.matched).toBe(3)
    const rest = indexFiles(index, 2, 2)
    expect('files' in rest && rest.returned).toBe(1)
    expect('nextCursor' in rest && rest.nextCursor).toBeNull()
  })

  it('returns hunks and rejects stale generation', () => {
    const ok = indexHunks(index, 0, 0, 10, 9)
    expect('hunks' in ok && ok.hunks.length).toBeGreaterThan(0)
    const stale = indexHunks(index, 0, 0, 10, 1)
    expect('status' in stale && stale.status).toBe(409)
  })

  it('slices rows with nextRow continuation', () => {
    const first = indexSlice(index, 0, 0, 3, 256 * 1024, 9)
    expect('rows' in first).toBe(true)
    if (!('rows' in first)) return
    expect(first.rows[0]?.type).toBe('fileHeader')
    expect(first.rows.length).toBeLessThanOrEqual(3)
    if (first.nextRow != null) {
      const second = indexSlice(index, 0, first.nextRow, 50, 256 * 1024, 9)
      expect('rows' in second).toBe(true)
    }
  })

  it('searches content case-insensitively', () => {
    const page = indexSearch(index, 'HELLO', 0, 0, 25, 256 * 1024, 9)
    expect('hits' in page).toBe(true)
    if (!('hits' in page)) return
    expect(page.hits.some((h) => h.path === 'src/b.ts')).toBe(true)
  })

  it('returns no matches for an empty query', () => {
    const page = indexSearch(index, '', 0, 0, 25, 256 * 1024, 9)
    expect('hits' in page && page.hits).toEqual([])
    expect('nextFile' in page && page.nextFile).toBeNull()
  })
})

describe('path-scoped inspect', () => {
  const index = buildAgentDiffIndex(SAMPLE, 11)

  it('matches git pathspec-ish globs including basename patterns', () => {
    const src = compilePathspecGlob('src/**')
    expect('test' in src && src.test('src/a.ts')).toBe(true)
    expect('test' in src && src.test('gone.ts')).toBe(false)
    const deep = compilePathspecGlob('**/a.ts')
    expect('test' in deep && deep.test('src/a.ts')).toBe(true)
    const base = compilePathspecGlob('b.ts')
    expect('test' in base && base.test('src/b.ts')).toBe(true)
    const invalid = compilePathspecGlob('src/[')
    expect('status' in invalid && invalid.status).toBe(400)
    const nested = compilePathspecGlob('src/**/*.ts')
    expect('test' in nested && nested.test('src/a.ts')).toBe(true)
    expect('test' in nested && nested.test('src/lib/a.ts')).toBe(true)
    expect('test' in nested && nested.test('gone.ts')).toBe(false)
  })

  it('matches renames on old and new paths', () => {
    const patch = `diff --git a/old name.ts b/new name.ts
similarity index 100%
rename from old name.ts
rename to new name.ts
`
    const renamed = buildAgentDiffIndex(patch, 12)
    const matcher = compilePathspecGlob('old name.ts')
    expect('test' in matcher).toBe(true)
    if (!('test' in matcher)) return
    expect(fileMatchesPath(matcher, renamed.files[0].oldPath, renamed.files[0].newPath)).toBe(true)
    const byNew = indexFiles(renamed, 0, 10, 'new name.ts')
    expect('files' in byNew && byNew.files).toHaveLength(1)
    expect('files' in byNew && byNew.files[0].index).toBe(0)
  })

  it('pages the filtered file list while keeping global indexes', () => {
    const page = indexFiles(index, 0, 1, 'src/**')
    expect(page).toMatchObject({
      path: 'src/**',
      matched: 2,
      total: 3,
      returned: 1,
      nextCursor: 1,
    })
    if (!('files' in page)) return
    expect(page.files[0]).toMatchObject({ index: 0, path: 'src/a.ts' })
    const rest = indexFiles(index, 1, 1, 'src/**')
    expect('files' in rest && rest.files[0]).toMatchObject({ index: 1, path: 'src/b.ts' })
    expect('nextCursor' in rest && rest.nextCursor).toBeNull()
  })

  it('resolves slice/hunks by unique path and errors on 0 or many matches', () => {
    expect(resolveInspectFile(index, undefined, 'src/a.ts')).toEqual({ fileIndex: 0 })
    expect(resolveInspectFile(index, undefined, 'missing.ts')).toMatchObject({ status: 404, path: 'missing.ts' })
    const many = resolveInspectFile(index, undefined, 'src/**')
    expect(many).toMatchObject({ status: 409, path: 'src/**' })
    if (!('matches' in many) || !many.matches) return
    expect(many.matches).toEqual([
      { index: 0, path: 'src/a.ts' },
      { index: 1, path: 'src/b.ts' },
    ])
    expect('hunks' in indexHunks(index, 0, 0, 10, 11)).toBe(true)
    expect('rows' in indexSlice(index, 0, 0, 10, 256 * 1024, 11)).toBe(true)
  })

  it('filters search hits to matching files', () => {
    const page = indexSearch(index, 'line', 0, 0, 25, 256 * 1024, 11, 'src/a.ts')
    expect('hits' in page).toBe(true)
    if (!('hits' in page)) return
    expect(page.hits.length).toBeGreaterThan(0)
    expect(page.hits.every((hit) => hit.path === 'src/a.ts')).toBe(true)
    const other = indexSearch(index, 'hello', 0, 0, 25, 256 * 1024, 11, 'src/a.ts')
    expect('hits' in other && other.hits).toEqual([])
  })

  it('drops lockfile noise from summary counts only', () => {
    const patch = `${SAMPLE}diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1 +1,2 @@
 lock
+more
`
    const noisy = buildAgentDiffIndex(patch, 13)
    const full = indexSummary(noisy)
    const skipped = indexSummary(noisy, ['lockfiles'])
    expect('files' in full && full.files).toBe(4)
    expect('files' in skipped && skipped.files).toBe(3)
    expect('exclude' in skipped && skipped.exclude).toEqual(['lockfiles'])
    const files = indexFiles(noisy, 0, 10)
    expect('matched' in files && files.matched).toBe(4)
  })
})

describe('AgentDiffIndexCache', () => {
  it('hashes exact file sections across preambles, repeated headers, Unicode and missing trailing newline', () => {
    const first = 'diff --git a/café.ts b/café.ts\n@@ -1 +1 @@\n-old\n+diff --git a/inside b/inside\r'
    const second = 'diff --git a/café.ts b/café.ts\n@@ -1 +1 @@\n-old\n+tail'
    const index = buildAgentDiffIndex(`commit metadata\n${first}\n\n${second}`)
    expect(index.files).toHaveLength(2)
    expect(index.files.map((file) => file.metadata.patchDigest)).toEqual(
      [first, second].map((section) => createHash('sha256').update(section).digest('hex')),
    )
  })

  it('reuses generation for identical patch', () => {
    const cache = new AgentDiffIndexCache()
    const a = cache.getOrBuild(SAMPLE)
    const b = cache.getOrBuild(SAMPLE)
    expect(a.generation).toBe(b.generation)
    expect(a).toBe(b)
  })

  it('rebuilds when patch changes', () => {
    const cache = new AgentDiffIndexCache()
    const a = cache.getOrBuild(SAMPLE)
    const b = cache.getOrBuild(SAMPLE + '\n')
    expect(b.generation).not.toBe(a.generation)
  })

  it('rebuilds when completeness changes for the same patch', () => {
    const cache = new AgentDiffIndexCache()
    const a = cache.getOrBuild(SAMPLE, true)
    const b = cache.getOrBuild(SAMPLE, false, ['skip.ts'])
    expect(b.generation).not.toBe(a.generation)
    expect(b.complete).toBe(false)
    expect(b.omittedPaths).toEqual(['skip.ts'])
    const summary = indexSummary(b)
    expect('complete' in summary && summary.complete).toBe(false)
    expect('omittedPaths' in summary && summary.omittedPaths).toEqual(['skip.ts'])
  })
})
