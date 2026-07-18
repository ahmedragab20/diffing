// @vitest-environment node
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { execWithInput, fetchExistingCommentsViaGh, fetchExistingReviewsViaGh, replyToPrComment, setPrReviewThreadResolved } from '../lib/github.js'

describe('GitHub CLI submission transport', () => {
  it('writes the JSON payload to stdin and closes the stream', async () => {
    const script = [
      "let body = ''",
      "process.stdin.setEncoding('utf8')",
      "process.stdin.on('data', (chunk) => { body += chunk })",
      "process.stdin.on('end', () => process.stdout.write(body.toUpperCase()))",
    ].join(';')

    const result = await execWithInput(process.execPath, ['-e', script], '{"ok":true}', 2_000)
    expect(result.stdout).toBe('{"OK":TRUE}')
  })

  it('terminates commands that do not complete', async () => {
    const script = "process.stdin.resume(); setInterval(() => {}, 1000)"
    await expect(
      execWithInput(process.execPath, ['-e', script], '{}', 75),
    ).rejects.toThrow(/timed out/i)
  })

  it('delivers an existing-thread reply through gh stdin and maps the created reply', async () => {
    const binDir = await mkdtemp(join(tmpdir(), 'diffing-gh-reply-'))
    const ghPath = join(binDir, 'gh')
    const originalPath = process.env.PATH
    await writeFile(
      ghPath,
      [
        '#!/usr/bin/env node',
        "let body = ''",
        "process.stdin.setEncoding('utf8')",
        "process.stdin.on('data', (chunk) => { body += chunk })",
        "process.stdin.on('end', () => {",
        '  const request = JSON.parse(body)',
        '  process.stdout.write(JSON.stringify({',
        '    id: 77, body: request.body,',
        "    user: { login: 'reviewer', avatar_url: 'https://example.test/avatar.png' },",
        "    created_at: '2026-07-18T10:00:00.000Z',",
        "    updated_at: '2026-07-18T10:00:00.000Z'",
        '  }))',
        '})',
      ].join('\n'),
      'utf8',
    )
    await chmod(ghPath, 0o755)
    process.env.PATH = `${binDir}:${originalPath ?? ''}`

    try {
      const result = await replyToPrComment({
        resolved: { owner: 'acme', repo: 'widget', pullNumber: 42, ref: '42' },
        inReplyTo: 11,
        body: 'Thanks for the context.',
      })

      expect(result.ok).toBe(true)
      expect(result.reply).toMatchObject({
        id: 77,
        author: { login: 'reviewer' },
        body: 'Thanks for the context.',
        createdAt: '2026-07-18T10:00:00.000Z',
      })
    } finally {
      process.env.PATH = originalPath
      await rm(binDir, { recursive: true, force: true })
    }
  })

  it('hydrates and mutates GitHub review-thread resolution state through GraphQL', async () => {
    const binDir = await mkdtemp(join(tmpdir(), 'diffing-gh-thread-'))
    const ghPath = join(binDir, 'gh')
    const originalPath = process.env.PATH
    await writeFile(
      ghPath,
      [
        '#!/usr/bin/env node',
        "const args = process.argv.slice(2).join(' ')",
        "if (args.includes('/reviews')) { process.stdout.write(JSON.stringify([{ id: 501, state: 'APPROVED', body: 'Approved again buddy@', submitted_at: '2026-07-18T20:00:00.000Z', html_url: 'https://github.test/review/501', commit_id: 'abc123', user: { login: 'reviewer', avatar_url: 'https://example.test/avatar.png' } }])); process.exit(0) }",
        "if (args.includes('?per_page=100')) {",
        "  process.stdout.write(JSON.stringify([{ id: 101, body: 'Feedback', path: 'src/x.ts', start_line: 11, start_side: 'RIGHT', line: 12, side: 'RIGHT', created_at: '2026-07-18T10:00:00.000Z', updated_at: '2026-07-18T10:00:00.000Z', user: { login: 'reviewer' } }]))",
        '  process.exit(0)',
        '}',
        "let body = ''",
        "process.stdin.setEncoding('utf8')",
        "process.stdin.on('data', (chunk) => { body += chunk })",
        "process.stdin.on('end', () => {",
        '  const request = JSON.parse(body)',
        "  if (request.query.includes('query ReviewThreads')) {",
        "    process.stdout.write(JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [{ id: 'PRRT_thread', isResolved: true, viewerCanResolve: false, viewerCanUnresolve: true, comments: { nodes: [{ databaseId: 101, viewerDidAuthor: true }] } }], pageInfo: { hasNextPage: false, endCursor: null } } } } } }))",
        "  } else if (request.query.includes('resolveReviewThread') && request.variables.threadId === 'PRRT_thread') {",
        "    process.stdout.write(JSON.stringify({ data: { resolveReviewThread: { thread: { id: 'PRRT_thread', isResolved: true } } } }))",
        '  } else {',
        "    process.stdout.write(JSON.stringify({ errors: [{ message: 'unexpected GraphQL request' }] }))",
        '  }',
        '})',
      ].join('\n'),
      'utf8',
    )
    await chmod(ghPath, 0o755)
    process.env.PATH = `${binDir}:${originalPath ?? ''}`

    try {
      const resolved = { owner: 'acme', repo: 'widget', pullNumber: 42, ref: '42' }
      const reviews = await fetchExistingReviewsViaGh(resolved)
      expect(reviews).toMatchObject([{
        id: 501,
        state: 'APPROVED',
        body: 'Approved again buddy@',
        author: { login: 'reviewer' },
        htmlUrl: 'https://github.test/review/501',
      }])
      const comments = await fetchExistingCommentsViaGh(resolved)
      expect(comments).toHaveLength(1)
      expect(comments[0]).toMatchObject({
        id: 101,
        startLine: 11,
        startSide: 'RIGHT',
        threadId: 'PRRT_thread',
        isResolved: true,
        viewerCanUnresolve: true,
        viewerDidAuthor: true,
      })
      await expect(setPrReviewThreadResolved({ threadId: 'PRRT_thread', resolved: true })).resolves.toEqual({ ok: true })
    } finally {
      process.env.PATH = originalPath
      await rm(binDir, { recursive: true, force: true })
    }
  })
})
