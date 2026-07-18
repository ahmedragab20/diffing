// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  diffSinceLast,
  fingerprintDiffFiles,
  filesToReviewSinceLast,
  hashString,
  splitUnifiedDiffByFile,
} from '../lib/diff-fingerprint.js'

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/src/b.ts b/src/b.ts
index 333..444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1 @@
-foo
+bar
`

describe('hashString', () => {
  it('is stable for the same input', () => {
    expect(hashString('hello')).toBe(hashString('hello'))
  })
  it('differs for different inputs', () => {
    expect(hashString('a')).not.toBe(hashString('b'))
  })
})

describe('splitUnifiedDiffByFile', () => {
  it('splits multi-file patches by b/ path', () => {
    const map = splitUnifiedDiffByFile(PATCH)
    expect([...map.keys()].sort()).toEqual(['src/a.ts', 'src/b.ts'])
    expect(map.get('src/a.ts')).toContain('+new')
    expect(map.get('src/b.ts')).toContain('+bar')
  })

  it('returns empty for blank patch', () => {
    expect(splitUnifiedDiffByFile('').size).toBe(0)
  })
})

describe('fingerprintDiffFiles', () => {
  it('produces one fingerprint per file', () => {
    const fp = fingerprintDiffFiles(PATCH)
    expect(Object.keys(fp).sort()).toEqual(['src/a.ts', 'src/b.ts'])
    expect(fp['src/a.ts']).toMatch(/^[0-9a-f]{8}$/)
  })

  it('changes when file content changes', () => {
    const a = fingerprintDiffFiles(PATCH)
    const b = fingerprintDiffFiles(PATCH.replace('+new', '+newer'))
    expect(a['src/a.ts']).not.toBe(b['src/a.ts'])
    expect(a['src/b.ts']).toBe(b['src/b.ts'])
  })
})

describe('diffSinceLast', () => {
  it('detects changed, added, and removed files', () => {
    const prev = { 'a.ts': '11111111', 'b.ts': '22222222', 'c.ts': '33333333' }
    const curr = { 'a.ts': '11111111', 'b.ts': '99999999', 'd.ts': '44444444' }
    const delta = diffSinceLast(prev, curr)
    expect(delta.changed).toEqual(['b.ts'])
    expect(delta.added).toEqual(['d.ts'])
    expect(delta.removed).toEqual(['c.ts'])
  })

  it('treats missing previous as all added', () => {
    const delta = diffSinceLast(null, { 'a.ts': 'abc' })
    expect(delta.added).toEqual(['a.ts'])
    expect(delta.changed).toEqual([])
    expect(delta.removed).toEqual([])
  })
})

describe('filesToReviewSinceLast', () => {
  it('unions changed and added', () => {
    expect(
      filesToReviewSinceLast({
        changed: ['b.ts'],
        added: ['a.ts'],
        removed: ['c.ts'],
      }),
    ).toEqual(['a.ts', 'b.ts'])
  })
})
