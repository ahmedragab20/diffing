import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: '.',
  // Ensure a single React instance across the app and Base UI primitives,
  // otherwise hooks inside Base UI components throw "Invalid hook call".
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      '@base-ui-components/react/dialog',
      '@base-ui-components/react/tooltip',
      '@base-ui-components/react/select',
      '@base-ui-components/react/popover',
    ],
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3433',
    },
  },
})
