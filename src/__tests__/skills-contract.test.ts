// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const publishedRoot = join(process.cwd(), 'skills')
const localRoot = join(process.cwd(), '.agents', 'skills')

function skillNames(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function readSkill(root: string, name: string): string {
  return readFileSync(join(root, name, 'SKILL.md'), 'utf-8')
}

describe('published agent skills', () => {
  it('keeps installable and repo-local skill trees byte-identical', () => {
    const published = skillNames(publishedRoot)
    expect(published).toEqual([
      'diffing',
      'diffing-finish-review',
      'diffing-plan-review',
      'diffing-pr-address',
      'diffing-pr-read',
      'diffing-review',
      'diffing-start-review',
    ])
    expect(skillNames(localRoot)).toEqual(published)

    for (const name of published) {
      expect(readSkill(localRoot, name)).toBe(readSkill(publishedRoot, name))
    }
  })

  it('uses portable metadata and natural-language triggers', () => {
    for (const name of skillNames(publishedRoot)) {
      const body = readSkill(publishedRoot, name)
      const frontmatter = /^---\n([\s\S]*?)\n---/.exec(body)?.[1]

      expect(frontmatter, `${name} frontmatter`).toBeDefined()
      expect(frontmatter).toContain(`name: ${name}`)
      const description = /^description: (.+)$/m.exec(frontmatter!)?.[1]
      expect(description, `${name} description`).toBeDefined()
      expect(description!.length).toBeGreaterThan(80)
      expect(description).not.toMatch(/invokes? \/diffing/)
      expect(body).not.toContain('run_in_background')
      expect(body).not.toContain('Bash tool')
      expect(body).not.toContain('See AGENTS.md')
    }
  })
})
