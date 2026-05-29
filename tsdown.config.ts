import { defineConfig } from 'tsdown'

export default defineConfig({
  // mcp.ts is reached via a dynamic import('./mcp.js') from cli.ts, so the
  // bundler code-splits it into a lazy chunk automatically (the MCP SDK stays
  // out of the hot diff path). No separate entry needed.
  entry: ['src/cli.ts'],
  format: 'esm',
  outDir: 'dist',
  clean: false,
  deps: {
    neverBundle: ['open', 'get-port', '@modelcontextprotocol/sdk', 'zod'],
  },
})
