// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { formatMcpSnippet, buildDiffingMcpEntry } from '../setup-mcp.js'

describe('setup --yes MCP behavior', () => {
  it('prints MCP JSON without implying IDE writes', () => {
    const snippet = formatMcpSnippet(buildDiffingMcpEntry('/repo'))
    const parsed = JSON.parse(snippet)
    expect(parsed.mcpServers.diffing.args).toEqual(['mcp', '--repo', '/repo'])
    expect(snippet).not.toContain('write-mcp')
  })
})
