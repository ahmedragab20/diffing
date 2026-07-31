// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildSkillsInstallCommand, formatSkillsInstallCommand, SKILLS_PACKAGE } from '../setup-skills.js'

describe('setup-skills', () => {
  it('constructs npx skills add command', () => {
    expect(buildSkillsInstallCommand()).toEqual({
      command: 'npx',
      args: ['skills', 'add', SKILLS_PACKAGE],
    })
    expect(formatSkillsInstallCommand()).toBe(`npx skills add ${SKILLS_PACKAGE}`)
  })
})
