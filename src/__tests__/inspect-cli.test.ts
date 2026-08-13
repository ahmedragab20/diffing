// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { validateInspectSelectors } from '../cli-agent.js'

describe('inspect CLI selectors', () => {
  it('requires file or path for slice and hunks', () => {
    expect(validateInspectSelectors('slice')).toMatch(/--file or --path is required/)
    expect(validateInspectSelectors('hunks', '0')).toBeNull()
    expect(validateInspectSelectors('slice', undefined, 'src/a.ts')).toBeNull()
  })

  it('rejects file and path together for slice and hunks', () => {
    expect(validateInspectSelectors('slice', '0', 'src/a.ts')).toMatch(/mutually exclusive/)
    expect(validateInspectSelectors('files', '0', 'src/**')).toBeNull()
  })
})
