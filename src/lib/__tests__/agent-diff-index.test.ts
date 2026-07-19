// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  buildAgentDiffIndex,
  indexSummary,
  indexFiles,
  indexHunks,
  indexSlice,
  indexSearch,
  AgentDiffIndexCache,
} from '../agent-diff-index.js'

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
})

describe('index paging', () => {
  const index = buildAgentDiffIndex(SAMPLE, 9)

  it('summary counts files and kinds', () => {
    const s = indexSummary(index)
    expect(s.generation).toBe(9)
    expect(s.files).toBe(3)
    expect(s.changes.modified).toBe(1)
    expect(s.changes.added).toBe(1)
    expect(s.changes.deleted).toBe(1)
    expect(s.next).toContain('diff_files')
  })

  it('pages files with nextCursor', () => {
    const page = indexFiles(index, 0, 2)
    expect(page.returned).toBe(2)
    expect(page.nextCursor).toBe(2)
    const rest = indexFiles(index, 2, 2)
    expect(rest.returned).toBe(1)
    expect(rest.nextCursor).toBeNull()
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

describe('AgentDiffIndexCache', () => {
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
})
