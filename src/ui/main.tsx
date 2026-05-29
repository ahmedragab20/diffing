import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker'
// Register the <diffs-container> custom element. @pierre/diffs marks only
// this one file as side-effectful, but `components/FileDiff.js` (which
// imports it) is not — so esbuild's dev pre-bundler drops the whole chain
// and the element never registers. Importing it directly keeps it alive.
import '../../node_modules/@pierre/diffs/dist/components/web-components.js'
import { TooltipProvider } from './primitives/Tooltip'
import { App } from './App'
import './styles/global.css'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <HotkeysProvider>
      <WorkerPoolContextProvider
        poolOptions={{
          workerFactory: () => new DiffsWorker(),
          poolSize: Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2)),
        }}
        highlighterOptions={{
          theme: {
            dark: 'nord',
            light: 'github-light',
          },
        }}
      >
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </WorkerPoolContextProvider>
    </HotkeysProvider>
  </QueryClientProvider>,
)

