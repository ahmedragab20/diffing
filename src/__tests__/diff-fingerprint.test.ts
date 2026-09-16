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

  it('decodes quoted paths and retains each occurrence of a repeated path', () => {
    const quoted = PATCH.replaceAll('src/a.ts', 'src/a\\t.ts').replace('a/src/a\\t.ts b/src/a\\t.ts', '"a/src/a\\t.ts" "b/src/a\\t.ts"')
    expect([...splitUnifiedDiffByFile(quoted).keys()]).toContain('src/a\t.ts')
    const repeated = PATCH + PATCH.replace('+new', '+later')
    const map = splitUnifiedDiffByFile(repeated)
    expect(map.get('src/a.ts')).toContain('+new')
    expect(map.get('src/a.ts')).toContain('+later')
    expect(fingerprintDiffFiles(repeated)['src/a.ts']).not.toBe(fingerprintDiffFiles(repeated.replace('+new', '+earlier'))['src/a.ts'])
  })

  it('distinguishes source CRLF bytes from LF bytes', () => {
    expect(fingerprintDiffFiles(PATCH)['src/a.ts']).not.toBe(fingerprintDiffFiles(PATCH.replace('+new\n', '+new\r\n'))['src/a.ts'])
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

  it('retains special object-key filenames as ordinary paths', () => {
    const fingerprint = fingerprintDiffFiles(PATCH.replaceAll('src/a.ts', '__proto__'))
    expect(Object.keys(fingerprint)).toContain('__proto__')
    expect(fingerprint.__proto__).toMatch(/^[0-9a-f]{8}$/)
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
