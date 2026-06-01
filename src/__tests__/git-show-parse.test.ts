// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseGitShowRaw } from '../lib/git.js'

const SHA_A = '1111111111111111111111111111111111111111'
const SHA_B = '2222222222222222222222222222222222222222'
const PARENT_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const PARENT_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const PARENT_C = 'cccccccccccccccccccccccccccccccccccccccc'

function commitHeader(sha: string, parents: string[], opts?: { gpg?: boolean }) {
  const lines = [
    `commit ${sha}`,
    `tree ${'9'.repeat(40)}`,
    ...parents.map((p) => `parent ${p}`),
    'author Alice Example <alice@example.com> 1700000000 +0000',
    'committer Alice Example <alice@example.com> 1700000000 +0000',
  ]
  if (opts?.gpg) {
    // gpgsig header + indented continuation lines, mirroring real `--pretty=raw` output
    lines.push('gpgsig -----BEGIN PGP SIGNATURE-----')
    lines.push(' ')
    lines.push(' wsFcBAABCAAQBQJqHMC7CRC1aQ7uu5UhlAAA')
    lines.push(' -----END PGP SIGNATURE-----')
    lines.push(' ')
  }
  return lines
}

function commitMessage(subject: string, body = '') {
  const lines = ['', `    ${subject}`]
  if (body) {
    lines.push('    ')
    for (const bl of body.split('\n')) lines.push(`    ${bl}`)
  }
  lines.push('')
  return lines
}

const SAMPLE_PATCH = [
  'diff --git a/foo.ts b/foo.ts',
  'index 0000000..1111111 100644',
  '--- a/foo.ts',
  '+++ b/foo.ts',
  '@@ -1,0 +1,1 @@',
  '+console.log("hi")',
].join('\n')

describe('parseGitShowRaw', () => {
  it('returns [] for empty input', () => {
    expect(parseGitShowRaw('')).toEqual([])
    expect(parseGitShowRaw('\n\n')).toEqual([])
  })

  it('parses a single normal commit', () => {
    const raw = [
      ...commitHeader(SHA_A, [PARENT_A]),
      ...commitMessage('Add greeting', 'Body line one\nBody line two'),
      SAMPLE_PATCH,
    ].join('\n')

    const commits = parseGitShowRaw(raw)
    expect(commits).toHaveLength(1)
    const c = commits[0]
    expect(c.sha).toBe(SHA_A)
    expect(c.shortSha).toBe(SHA_A.slice(0, 7))
    expect(c.parents).toEqual([PARENT_A])
    expect(c.subject).toBe('Add greeting')
    expect(c.body).toBe('Body line one\nBody line two')
    expect(c.authorName).toBe('Alice Example')
    expect(c.authorEmail).toBe('alice@example.com')
    expect(c.authorDate).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(c.patch).toContain('diff --git a/foo.ts b/foo.ts')
  })

  it('parses two commits separated by another `commit ...` line', () => {
    const raw = [
      ...commitHeader(SHA_A, [PARENT_A]),
      ...commitMessage('First'),
      SAMPLE_PATCH,
      '',
      ...commitHeader(SHA_B, [SHA_A]),
      ...commitMessage('Second'),
      SAMPLE_PATCH.replace('foo.ts', 'bar.ts'),
    ].join('\n')

    const commits = parseGitShowRaw(raw)
    expect(commits).toHaveLength(2)
    expect(commits[0].sha).toBe(SHA_A)
    expect(commits[0].subject).toBe('First')
    expect(commits[0].patch).toContain('foo.ts')
    expect(commits[1].sha).toBe(SHA_B)
    expect(commits[1].subject).toBe('Second')
    expect(commits[1].patch).toContain('bar.ts')
    expect(commits[0].patch).not.toContain('bar.ts')
  })

  it('skips gpgsig continuation lines without misreading them as headers or message', () => {
    const raw = [
      ...commitHeader(SHA_A, [PARENT_A], { gpg: true }),
      ...commitMessage('Signed commit', 'Body here'),
      SAMPLE_PATCH,
    ].join('\n')

    const commits = parseGitShowRaw(raw)
    expect(commits).toHaveLength(1)
    expect(commits[0].subject).toBe('Signed commit')
    expect(commits[0].body).toBe('Body here')
    expect(commits[0].authorName).toBe('Alice Example')
  })

  it('handles commits with empty body (subject only)', () => {
    const raw = [
      ...commitHeader(SHA_A, [PARENT_A]),
      ...commitMessage('Subject only, no body'),
      SAMPLE_PATCH,
    ].join('\n')

    const commits = parseGitShowRaw(raw)
    expect(commits[0].subject).toBe('Subject only, no body')
    expect(commits[0].body).toBe('')
  })

  it('handles commits whose diff is empty (path-filtered out)', () => {
    const raw = [
      ...commitHeader(SHA_A, [PARENT_A]),
      ...commitMessage('No matching files'),
    ].join('\n')

    const commits = parseGitShowRaw(raw)
    expect(commits).toHaveLength(1)
    expect(commits[0].patch).toBe('')
    // Metadata still surfaces so the banner can render.
    expect(commits[0].subject).toBe('No matching files')
  })

  it('captures multiple parents for merge commits', () => {
    const raw = [
      ...commitHeader(SHA_A, [PARENT_A, PARENT_B, PARENT_C]),
      ...commitMessage('Octopus merge'),
      SAMPLE_PATCH,
    ].join('\n')

    const commits = parseGitShowRaw(raw)
    expect(commits[0].parents).toEqual([PARENT_A, PARENT_B, PARENT_C])
  })

  it('handles a root commit (no parent line)', () => {
    const raw = [
      ...commitHeader(SHA_A, []),
      ...commitMessage('Initial commit'),
      SAMPLE_PATCH,
    ].join('\n')

    const commits = parseGitShowRaw(raw)
    expect(commits[0].parents).toEqual([])
    expect(commits[0].subject).toBe('Initial commit')
  })

  it('ignores garbage prefix and only emits commits found via the `commit <sha>` boundary', () => {
    const raw = [
      'this is not a commit',
      'neither is this',
      ...commitHeader(SHA_A, [PARENT_A]),
      ...commitMessage('Real'),
      SAMPLE_PATCH,
    ].join('\n')

    const commits = parseGitShowRaw(raw)
    expect(commits).toHaveLength(1)
    expect(commits[0].subject).toBe('Real')
  })

  it('preserves multi-line body content verbatim', () => {
    const body = 'Paragraph one.\n\nParagraph two.\n- bullet\n- bullet'
    const raw = [
      ...commitHeader(SHA_A, [PARENT_A]),
      ...commitMessage('Has structure', body),
      SAMPLE_PATCH,
    ].join('\n')

    const commits = parseGitShowRaw(raw)
    expect(commits[0].body).toBe(body)
  })

  it('renders dates in the commit timezone, not UTC', () => {
    // 1700000000 = 2023-11-14T22:13:20Z; with +0530 → 2023-11-15T03:43:20+05:30
    const raw = [
      `commit ${SHA_A}`,
      `tree ${'9'.repeat(40)}`,
      'author Alice <a@b> 1700000000 +0530',
      'committer Alice <a@b> 1700000000 +0530',
      '',
      '    Subject',
      '',
      SAMPLE_PATCH,
    ].join('\n')

    const commits = parseGitShowRaw(raw)
    expect(commits[0].authorDate).toBe('2023-11-15T03:43:20+05:30')
  })
})
