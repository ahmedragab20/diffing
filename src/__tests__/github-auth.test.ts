import { describe, it, expect } from 'vitest'
import { parseGhAuthStatusUser } from '../lib/github.js'

describe('parseGhAuthStatusUser', () => {
  // `gh auth status` has changed its output phrasing across versions and
  // sometimes writes the line to stderr (notably on Windows) and sometimes
  // to stdout. Our detector concatenates both streams before parsing, so
  // these tests focus on the regex's tolerance.

  it('parses the modern "account <user>" phrasing (gh 2.40+)', () => {
    const output = `github.com
  ✓ Logged in to github.com account octocat (keyring)
  - Active account: true
  - Git operations protocol: https
`
    expect(parseGhAuthStatusUser(output)).toBe('octocat')
  })

  it('parses the legacy "as <user>" phrasing', () => {
    const output = `github.com
  ✓ Logged in to github.com as octocat (oauth_token)
`
    expect(parseGhAuthStatusUser(output)).toBe('octocat')
  })

  it('parses output even when only stderr was concatenated (Windows path)', () => {
    // gh on Windows historically writes the auth line to stderr only.
    // The caller does `stdout + '\n' + stderr`, so we test with the
    // stdout empty and the line buried after a newline.
    const stdout = ''
    const stderr = 'Logged in to github.com as msft-user (oauth_token)\n'
    expect(parseGhAuthStatusUser(`${stdout}\n${stderr}`)).toBe('msft-user')
  })

  it('handles GHES (enterprise) hostnames', () => {
    const output = `✓ Logged in to ghe.example.com account enterprise-admin (keyring)
`
    expect(parseGhAuthStatusUser(output)).toBe('enterprise-admin')
  })

  it('returns undefined when not authenticated', () => {
    const output = `You are not logged into any GitHub hosts.
Run gh auth login to authenticate.
`
    expect(parseGhAuthStatusUser(output)).toBeUndefined()
  })

  it('returns undefined for completely empty output', () => {
    expect(parseGhAuthStatusUser('')).toBeUndefined()
  })

  it('does not pick up a "(oauth_token)" suffix as part of the name', () => {
    const output = 'Logged in to github.com as octocat (oauth_token)'
    expect(parseGhAuthStatusUser(output)).toBe('octocat')
  })

  it('prefers the modern phrasing when both are present', () => {
    // In a hypothetical multi-host gh output, the modern phrasing wins so
    // we don't accidentally return a stale `as <user>` from a previous run.
    const output = `
✓ Logged in to github.com account new-style (keyring)
  Some other line that mentions "as old-style" historically.
`
    expect(parseGhAuthStatusUser(output)).toBe('new-style')
  })
})
