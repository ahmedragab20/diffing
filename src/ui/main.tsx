import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker'
import { App } from './App'
import './styles/global.css'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
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
      <App />
    </WorkerPoolContextProvider>
  </QueryClientProvider>,
)

