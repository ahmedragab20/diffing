// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { scanTextForSecrets, scanReviewForSecrets } from '../lib/secrets-scan.js'

describe('scanTextForSecrets', () => {
  it('returns no findings for empty text', () => {
    expect(scanTextForSecrets('', 'x')).toEqual([])
  })

  it('flags AWS access keys', () => {
    const f = scanTextForSecrets('key is AKIAIOSFODNN7EXAMPLE in env', 'env')
    expect(f).toHaveLength(1)
    expect(f[0].rule).toBe('aws-access-key')
    expect(f[0].snippet).toContain('AKIA')
    expect(f[0].snippet).toContain('MPLE')
    expect(f[0].source).toBe('env')
  })

  it('flags GitHub tokens', () => {
    const f = scanTextForSecrets('ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'token')
    expect(f).toHaveLength(1)
    expect(f[0].rule).toBe('github-token')
  })

  it('flags Slack tokens', () => {
    const f = scanTextForSecrets('xoxb-1234567890-abcdefghij', 'slack')
    expect(f).toHaveLength(1)
    expect(f[0].rule).toBe('slack-token')
  })

  it('flags private key headers', () => {
    const f = scanTextForSecrets('\n-----BEGIN RSA PRIVATE KEY-----\n', 'pem')
    expect(f.length).toBeGreaterThanOrEqual(1)
    expect(f[0].rule).toBe('private-key')
  })

  it('flags generic API key=value patterns', () => {
    const f = scanTextForSecrets('api_key = "abcdEFGHijklmnop_-12"', 'cfg')
    expect(f).toHaveLength(1)
    expect(f[0].rule).toBe('generic-api-key')
  })

  it('flags JWT tokens', () => {
    // header.payload.signature with each segment > 10 chars of the alphabet
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const f = scanTextForSecrets(jwt, 'auth')
    expect(f).toHaveLength(1)
    expect(f[0].rule).toBe('jwt')
  })

  it('flags Postgres connection strings and redacts password', () => {
    const f = scanTextForSecrets('postgres://user:hunter2@db.example.com:5432/app', 'url')
    expect(f).toHaveLength(1)
    expect(f[0].rule).toBe('connection-string')
    expect(f[0].snippet).not.toContain('hunter2')
    expect(f[0].snippet).toMatch(/\*\*\*/)
  })

  it('returns no findings for safe text', () => {
    const safe = [
      'const x = 42',
      'See src/lib/git.ts for the rev walker',
      'TODO: tighten the regex',
      'Lorem ipsum dolor sit amet',
    ].join('\n')
    expect(scanTextForSecrets(safe, 'comment')).toEqual([])
  })

  it('returns one finding per occurrence (dedup happens at the review level)', () => {
    const f = scanTextForSecrets(
      'AKIAIOSFODNN7EXAMPLE and AKIAIOSFODNN7EXAMPLE',
      'env',
    )
    expect(f).toHaveLength(2)
  })

  it('does NOT flag a random 16-letter hex string as a key', () => {
    // No separator and no keyword prefix → should not match generic-api-key
    const f = scanTextForSecrets('abcdef0123456789abcdef0123456789', 'x')
    expect(f).toEqual([])
  })

  it('flags multiple distinct rules in one blob', () => {
    const blob = [
      'Token: AKIAIOSFODNN7EXAMPLE',
      'Other: xoxb-1234567890-abcdefghij',
    ].join('\n')
    const f = scanTextForSecrets(blob, 'env')
    expect(f.map((x) => x.rule).sort()).toEqual(['aws-access-key', 'slack-token'])
  })
})

describe('scanReviewForSecrets', () => {
  it('scans overall comment, comment bodies, and line content', () => {
    const f = scanReviewForSecrets({
      generalComment: 'Here is AKIAIOSFODNN7EXAMPLE',
      comments: [
        {
          id: 'c1',
          filePath: 'src/a.ts',
          body: 'no secrets here',
          lineContent: 'const x = 1',
        },
        {
          id: 'c2',
          filePath: 'src/b.ts',
          body: 'looks like ghp_abcdefghijklmnopqrstuvwxyz0123456789 leaked',
          lineContent: 'no issue',
        },
      ],
    })
    expect(f.map((x) => x.rule).sort()).toEqual(['aws-access-key', 'github-token'])
  })

  it('deduplicates by (rule, snippet, source)', () => {
    const f = scanReviewForSecrets({
      comments: [
        {
          id: 'c1',
          filePath: 'src/a.ts',
          body: 'AKIAIOSFODNN7EXAMPLE',
        },
        {
          id: 'c2',
          filePath: 'src/b.ts', // different source → not deduped
          body: 'AKIAIOSFODNN7EXAMPLE',
        },
      ],
    })
    expect(f).toHaveLength(2)
    expect(f.every((x) => x.rule === 'aws-access-key')).toBe(true)
  })

  it('returns empty array for all safe review payload', () => {
    const f = scanReviewForSecrets({
      generalComment: 'LGTM overall',
      comments: [
        { id: 'c1', filePath: 'src/a.ts', body: 'Rename this to bar()', lineContent: 'foo()' },
      ],
    })
    expect(f).toEqual([])
  })
})
