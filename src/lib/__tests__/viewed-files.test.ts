// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as atomicJson from '../json-atomic.js'
import {
  FileViewedStore,
  unviewChangedFiles,
  visibleViewedPaths,
  viewedScopeKey,
} from '../viewed-files.js'
import { fingerprintDiffFiles } from '../diff-fingerprint.js'

describe('viewed-files', () => {
  it('keeps the last saved view after a replacement fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'diffing-viewed-failure-'))
    try {
      const store = new FileViewedStore(dir)
      const path = join(dir, 'viewed.json')
      await store.toggle('local', 'saved.ts', true, 'saved')
      const before = await readFile(path)
      const save = vi.spyOn(atomicJson, 'writeJsonAtomically').mockImplementationOnce(() => { throw new Error('replacement failed') })
      try {
        await expect(store.toggle('local', 'unsaved.ts', true, 'unsaved')).rejects.toThrow('replacement failed')
      } finally { save.mockRestore() }
      expect(await store.list('local')).toEqual(['saved.ts'])
      expect(await readFile(path)).toEqual(before)
      expect(await new FileViewedStore(dir).list('local')).toEqual(['saved.ts'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it.each(['{', '[]', '{"local":{"files":"invalid"}}'])('preserves malformed existing state: %s', async (contents) => {
    const dir = await mkdtemp(join(tmpdir(), 'diffing-viewed-corrupt-'))
    try {
      const path = join(dir, 'viewed.json')
      await writeFile(path, contents)
      const store = new FileViewedStore(dir)
      await expect(store.list('local')).rejects.toThrow()
      await expect(store.toggle('local', 'new.ts', true)).rejects.toThrow()
      expect(await readFile(path, 'utf8')).toBe(contents)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects invalid UTF-8 and an unreadable store without treating either as empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'diffing-viewed-unreadable-'))
    try {
      const path = join(dir, 'viewed.json')
      const bytes = Buffer.concat([Buffer.from('{"local":{"files":{"'), Buffer.from([0xff]), Buffer.from('":"value"}}}')])
      await writeFile(path, bytes)
      await expect(new FileViewedStore(dir).toggle('local', 'new.ts', true)).rejects.toThrow()
      expect(await readFile(path)).toEqual(bytes)
      await rm(path)
      await mkdir(path)
      await expect(new FileViewedStore(dir).list('local')).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keys PR identity separately from local', () => {
    expect(
      viewedScopeKey({ owner: 'acme', repo: 'widget', pullNumber: 7 }, true),
    ).toBe('pr:github.com::acme::widget::7')
    expect(viewedScopeKey(null, false)).toBe('local')
  })

  it('hides viewed files whose fingerprint no longer matches', () => {
    const files = { 'a.ts': 'aaaa', 'b.ts': 'bbbb' }
    expect(visibleViewedPaths(files, { 'a.ts': 'aaaa', 'b.ts': 'cccc' })).toEqual(['a.ts'])
  })

  it('unviews files that changed or were added on a new head', () => {
    const previous = { 'a.ts': 'old-a', 'b.ts': 'same-b' }
    const current = { 'a.ts': 'new-a', 'b.ts': 'same-b', 'c.ts': 'new-c' }
    const next = unviewChangedFiles({ 'a.ts': 'old-a', 'b.ts': 'same-b' }, previous, current)
    expect(next).toEqual({ 'b.ts': 'same-b' })
  })

  it('persists per-key viewed files and reconciles a new head', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'diffing-viewed-'))
    try {
      const store = new FileViewedStore(dir)
      const patch1 = `diff --git a/a.ts b/a.ts
index 111..222 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1,2 @@
 line
+added
`
      const fps1 = fingerprintDiffFiles(patch1)
      await store.toggle('pr:acme', 'a.ts', true, fps1['a.ts'], 'aaa', fps1)
      expect(await store.list('pr:acme', fps1)).toEqual(['a.ts'])

      const patch2 = `diff --git a/a.ts b/a.ts
index 111..333 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1,2 @@
 line
+changed
`
      const fps2 = fingerprintDiffFiles(patch2)
      const visible = await store.reconcile('pr:acme', 'bbb', fps2)
      expect(visible).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
