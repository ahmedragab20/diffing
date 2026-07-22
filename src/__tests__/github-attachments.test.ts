// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractLocalAttachmentRefs,
  githubRawBlobUrl,
  githubWebOrigin,
  rewriteAttachmentUrls,
  rewriteLocalAttachmentsInBodies,
  sanitizeAttachmentFilename,
} from '../lib/github-attachments.js'

describe('github-attachments', () => {
  describe('sanitizeAttachmentFilename', () => {
    it('accepts pasted image names', () => {
      expect(sanitizeAttachmentFilename('pasted_image_de4f55-bc11.png')).toBe(
        'pasted_image_de4f55-bc11.png',
      )
    })

    it('rejects traversal and odd extensions', () => {
      expect(sanitizeAttachmentFilename('../etc/passwd')).toBeNull()
      expect(sanitizeAttachmentFilename('..%2Fsecret.png')).toBeNull()
      expect(sanitizeAttachmentFilename('note.txt')).toBeNull()
      expect(sanitizeAttachmentFilename('/abs.png')).toBeNull()
    })
  })

  describe('extractLocalAttachmentRefs', () => {
    it('finds markdown image urls and dedupes', () => {
      const md = [
        'See ![a](/api/attachments/pasted_image_a.png)',
        'and ![b](/api/attachments/pasted_image_a.png)',
        'plus ![c](/api/attachments/pasted_image_b.jpg)',
      ].join('\n')
      const refs = extractLocalAttachmentRefs(md)
      expect(refs).toHaveLength(2)
      expect(refs.map((r) => r.filename).sort()).toEqual([
        'pasted_image_a.png',
        'pasted_image_b.jpg',
      ])
    })

    it('ignores unsafe filenames in markdown', () => {
      expect(extractLocalAttachmentRefs('![x](/api/attachments/../x.png)')).toEqual([])
    })
  })

  describe('rewriteAttachmentUrls / web origin', () => {
    it('rewrites every occurrence of a local url', () => {
      const md = '![a](/api/attachments/a.png) and ![b](/api/attachments/a.png)'
      expect(
        rewriteAttachmentUrls(md, {
          '/api/attachments/a.png': 'https://github.com/o/r/raw/abc/a.png',
        }),
      ).toBe(
        '![a](https://github.com/o/r/raw/abc/a.png) and ![b](https://github.com/o/r/raw/abc/a.png)',
      )
    })

    it('builds github.com and GHE raw urls (not raw.githubusercontent.com)', () => {
      expect(githubWebOrigin(undefined)).toBe('https://github.com')
      expect(githubWebOrigin('ghe.example.com')).toBe('https://ghe.example.com')
      expect(
        githubRawBlobUrl({ owner: 'acme', repo: 'widget', host: 'ghe.example.com' }, 'deadbeef', 'ab.png'),
      ).toBe('https://ghe.example.com/acme/widget/raw/deadbeef/ab.png')
      expect(
        githubRawBlobUrl({ owner: 'acme', repo: 'widget' }, 'deadbeef', 'ab.png'),
      ).toBe('https://github.com/acme/widget/raw/deadbeef/ab.png')
    })
  })

  describe('rewriteLocalAttachmentsInBodies', () => {
    let dir: string

    afterEach(async () => {
      if (dir) await rm(dir, { recursive: true, force: true })
      vi.restoreAllMocks()
    })

    it('no-ops when bodies have no local attachments', async () => {
      const result = await rewriteLocalAttachmentsInBodies(
        { owner: 'acme', repo: 'widget', pullNumber: 1, ref: '1' },
        ['no images here'],
      )
      expect(result.error).toBeUndefined()
      expect(result.uploaded).toBe(0)
      expect(result.bodies).toEqual(['no images here'])
    })

    it('dry-run rewrites to pending raw urls without calling GitHub', async () => {
      dir = await mkdtemp(join(tmpdir(), 'diffing-attach-'))
      const name = 'pasted_image_abc.png'
      await writeFile(join(dir, name), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

      const local = `/api/attachments/${name}`
      const result = await rewriteLocalAttachmentsInBodies(
        { owner: 'acme', repo: 'widget', pullNumber: 9, ref: '9', host: 'ghe.example.com' },
        [`![shot](${local})`],
        { dryRun: true, attachmentsDir: dir },
      )

      expect(result.error).toBeUndefined()
      expect(result.uploaded).toBe(0)
      expect(result.bodies[0]).toMatch(
        /^!\[shot\]\(https:\/\/ghe\.example\.com\/acme\/widget\/raw\/<pending>\/[a-f0-9]{16}\.png\)$/,
      )
      expect(result.bodies[0]).not.toContain('/api/attachments/')
    })

    it('uploads blobs via gh api and rewrites published bodies', async () => {
      dir = await mkdtemp(join(tmpdir(), 'diffing-attach-'))
      const name = 'pasted_image_xyz.png'
      await writeFile(join(dir, name), Buffer.from('png-bytes'))

      const binDir = await mkdtemp(join(tmpdir(), 'diffing-gh-attach-'))
      const ghPath = join(binDir, 'gh')
      const originalPath = process.env.PATH
      const calls: { method: string; path: string; body: any }[] = []

      await writeFile(
        ghPath,
        [
          '#!/usr/bin/env node',
          'const args = process.argv.slice(2)',
          "if (args[0] === '--version') { process.stdout.write('gh version 2.40.0\\n'); process.exit(0) }",
          "if (args[0] === 'auth' && args[1] === 'status') {",
          "  process.stderr.write('✓ Logged in to github.com account tester (keyring)\\n')",
          '  process.exit(0)',
          '}',
          "const methodIdx = args.indexOf('--method')",
          "const method = methodIdx >= 0 ? args[methodIdx + 1] : 'GET'",
          "const path = args.find((a) => a.startsWith('repos/')) || ''",
          "let body = ''",
          "process.stdin.setEncoding('utf8')",
          "process.stdin.on('data', (c) => { body += c })",
          "process.stdin.on('end', () => {",
          '  let parsed = null',
          '  try { parsed = body ? JSON.parse(body) : null } catch {}',
          "  if (path.includes('/git/blobs')) { process.stdout.write(JSON.stringify({ sha: 'blobsha1' })); return }",
          "  if (path.includes('/git/trees')) { process.stdout.write(JSON.stringify({ sha: 'treesha1' })); return }",
          "  if (path.includes('/git/commits')) { process.stdout.write(JSON.stringify({ sha: 'commitsha1' })); return }",
          "  if (method === 'GET' && path.includes('/git/ref/')) { process.stderr.write('not found'); process.exit(1) }",
          "  if (method === 'POST' && path.endsWith('/git/refs')) {",
          '    process.stdout.write(JSON.stringify({ ref: parsed.ref, object: { sha: parsed.sha } })); return',
          '  }',
          "  process.stderr.write('unexpected: ' + JSON.stringify({ method, path, parsed })); process.exit(1)",
          '})',
        ].join('\n'),
        'utf8',
      )
      const { chmod } = await import('node:fs/promises')
      await chmod(ghPath, 0o755)
      process.env.PATH = `${binDir}:${originalPath ?? ''}`

      try {
        const local = `/api/attachments/${name}`
        const result = await rewriteLocalAttachmentsInBodies(
          { owner: 'acme', repo: 'widget', pullNumber: 42, ref: '42' },
          [`See ![x](${local})`],
          { attachmentsDir: dir },
        )

        expect(result.error).toBeUndefined()
        expect(result.uploaded).toBe(1)
        expect(result.bodies[0]).toContain('https://github.com/acme/widget/raw/commitsha1/')
        expect(result.bodies[0]).not.toContain('/api/attachments/')
      } finally {
        process.env.PATH = originalPath
        await rm(binDir, { recursive: true, force: true })
      }
    })

    it('fails clearly when the local file is missing', async () => {
      dir = await mkdtemp(join(tmpdir(), 'diffing-attach-missing-'))
      await mkdir(dir, { recursive: true })
      const result = await rewriteLocalAttachmentsInBodies(
        { owner: 'acme', repo: 'widget', pullNumber: 1, ref: '1' },
        ['![x](/api/attachments/pasted_image_missing.png)'],
        { attachmentsDir: dir },
      )
      expect(result.error).toMatch(/Missing local attachment/)
      expect(result.bodies[0]).toContain('/api/attachments/')
    })
  })
})
