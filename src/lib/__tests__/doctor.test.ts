// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { formatDoctorReport, type DoctorReport } from '../doctor.js'

const sampleReport: DoctorReport = {
  ok: true,
  checks: [
    { id: 'git', label: 'Git repository', level: 'ok', detail: '/repo' },
    { id: 'gh', label: 'GitHub CLI (gh)', level: 'warn', detail: 'not authenticated' },
  ],
}

describe('formatDoctorReport', () => {
  it('renders plain text when color is disabled', () => {
    const out = formatDoctorReport(sampleReport, { color: false })
    expect(out).toContain('diffing doctor')
    expect(out).toContain('✓ Git repository')
    expect(out).toContain('! GitHub CLI (gh)')
    expect(out).toContain('Overall: OK')
    expect(out).not.toMatch(/\x1b\[[0-9;]*m/)
  })

  it('includes ANSI when color is enabled', () => {
    const out = formatDoctorReport(sampleReport, { color: true })
    expect(out).toMatch(/\x1b\[[0-9;]*m/)
  })

  it('marks overall error when report is not ok', () => {
    const out = formatDoctorReport(
      {
        ok: false,
        checks: [{ id: 'git', label: 'Git repository', level: 'error', detail: 'missing' }],
      },
      { color: false },
    )
    expect(out).toContain('✗ Git repository')
    expect(out).toContain('Overall: issues found')
  })
})
