// @vitest-environment jsdom
/**
 * Regression: permalink useEffect must not reference sortedFiles before it is
 * declared (TDZ → blank UI + "Cannot access 'sortedFiles' before initialization").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@pierre/diffs', () => ({
  parsePatchFiles: () => [],
  preloadHighlighter: () => Promise.resolve(),
}))

vi.mock('@pierre/diffs/react', () => ({
  useWorkerPool: () => ({
    setRenderOptions: vi.fn(() => Promise.resolve()),
    preloadHighlighter: vi.fn(() => Promise.resolve()),
  }),
}))

vi.mock('../hooks/useDiff', () => ({
  useDiff: () => ({
    patch: null,
    repoName: 'test',
    branch: 'main',
    customMode: false,
    showMode: false,
    commits: [],
    truncated: 0,
    binaryFiles: [],
    tabSizeMap: {},
    untrackedFiles: [],
    overview: undefined,
    loading: false,
    refreshing: false,
    error: null,
  }),
}))

vi.mock('../hooks/useComments', () => ({
  useComments: () => ({
    comments: [],
    addComment: vi.fn(),
    removeComment: vi.fn(),
    resolveComment: vi.fn(),
    unresolveComment: vi.fn(),
    addReply: vi.fn(),
    editComment: vi.fn(),
    editReply: vi.fn(),
    removeReply: vi.fn(),
    copyAllComments: vi.fn(),
    copyAllCommentsMarkdown: vi.fn(),
    agentActivity: null,
    clearAgentActivity: vi.fn(),
    sendToAgent: vi.fn(),
    sending: false,
    agentWaiting: false,
    waitingAgents: [],
    resolveAllOpen: vi.fn(),
    lastSend: null,
  }),
}))

vi.mock('../hooks/usePlans', () => ({
  usePlans: () => ({ plans: [] }),
}))

vi.mock('../hooks/useMergeStatus', () => ({
  useMergeStatus: () => ({ status: { inMerge: false, conflicts: [] }, refresh: vi.fn() }),
}))

vi.mock('../hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      staged: true,
      untracked: true,
      diffStyle: 'unified',
      defaultTabSize: 4,
      theme: 'rose-pine',
      lineDiffType: 'word',
      lineWrap: false,
      diffIndicators: 'classic',
      showLineNumbers: true,
      hunkSeparators: 'line-info',
      lineHoverHighlight: 'both',
      fontSize: 13,
      expandContextByDefault: false,
      collapsedContextThreshold: 10,
      expansionLineCount: 20,
      haptics: false,
      sounds: false,
      density: 'comfortable',
      autoCollapseLineThreshold: 400,
      requireViewAllBeforeSend: false,
      showStatusBar: true,
      ignoreSpaceChange: false,
      ignoreAllSpace: false,
      savedReplies: [],
    },
    loaded: true,
    updateSettings: vi.fn(),
  }),
  resolveMonoFont: () => 'monospace',
}))

vi.mock('../hooks/useApplyFonts', () => ({
  useApplyFonts: () => undefined,
}))

vi.mock('../hooks/useViewed', () => ({
  useViewed: () => ({ viewedFiles: new Set(), setViewed: vi.fn() }),
}))

vi.mock('../hooks/useScrollToNextFile', () => ({
  useScrollToNextFile: () => vi.fn(),
}))

vi.mock('../hooks/useDiffSearch', () => ({
  useDiffSearch: () => [],
}))

vi.mock('../hooks/useHaptics', () => ({
  HapticsProvider: ({ children }: { children: React.ReactNode }) => children,
  playSound: vi.fn(),
  fireFeedback: vi.fn(),
  useFeedback: () => ({ haptic: vi.fn(), sound: vi.fn() }),
}))

vi.mock('../utils/uiState', () => ({
  getUiStateItem: () => null,
  setUiStateItem: vi.fn(),
}))

vi.mock('../router', () => ({
  navigate: vi.fn(),
  useRoutePath: () => '/',
}))

vi.mock('lucide-react', () => {
  const Stub = () => null
  const keys = [
    'AlertTriangle', 'Search', 'GitBranch', 'Settings', 'Palette', 'ClipboardList',
    'Type', 'Menu', 'LayoutGrid', 'Sparkles', 'CheckCheck', 'History', 'FileCode2',
    'Bot', 'X', 'ChevronLeft', 'ChevronRight', 'GitCommit', 'MessageSquare',
    'Check', 'RotateCcw', 'CornerUpLeft', 'Pencil', 'Trash2', 'ChevronDown',
    'ChevronUp', 'Eye', 'EyeOff', 'PanelLeftClose', 'PanelLeftOpen', 'Filter',
    'Copy', 'CheckCircle2', 'Loader2', 'GitCompare', 'GitPullRequest', 'ExternalLink',
    'RefreshCw', 'MessageCircle', 'Clock', 'XCircle',
  ]
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k] = Stub
  return out
})

vi.mock('@tanstack/react-hotkeys', () => ({
  useHotkeySequence: () => undefined,
}))

// Heavy children — stub so we only assert App mounts without TDZ crash.
vi.mock('../components/Toolbar', () => ({
  Toolbar: () => <div data-testid="toolbar">toolbar</div>,
}))
vi.mock('../components/DiffViewer', () => ({
  DiffViewer: () => null,
  sortFilesByName: (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name),
}))
vi.mock('../components/FileTree', () => ({
  FileTree: () => null,
}))
vi.mock('../components/CommentTracker', () => ({
  CommentTracker: () => null,
}))
vi.mock('../components/SearchPalette', () => ({
  SearchPalette: () => null,
}))
vi.mock('../components/VimStatusBar', () => ({
  VimStatusBar: () => null,
}))
vi.mock('../components/ShortcutsHelpModal', () => ({
  ShortcutsHelpModal: () => null,
}))
vi.mock('../components/AgentActivityToast', () => ({
  AgentActivityToast: () => null,
}))
vi.mock('../components/AgentProgressToast', () => ({
  AgentProgressToast: () => null,
}))
vi.mock('../components/ThemeModal', () => ({
  ThemeModal: () => null,
}))
vi.mock('../components/FontPickerModal', () => ({
  FontPickerModal: () => null,
}))
vi.mock('../components/DiffOverviewBanner', () => ({
  DiffOverviewBanner: () => null,
}))
vi.mock('../components/CommitWalkBar', () => ({
  CommitWalkBar: () => null,
}))
vi.mock('../components/MergeConflictResolver', () => ({
  MergeConflictResolver: () => null,
}))

import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../App'

describe('App boot (permalink TDZ regression)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ prMode: false }),
      })),
    )
  })

  it('mounts without TDZ ReferenceError on sortedFiles', () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    expect(() => {
      render(
        <QueryClientProvider client={qc}>
          <App />
        </QueryClientProvider>,
      )
    }).not.toThrow()
    expect(screen.getByTestId('toolbar')).toBeInTheDocument()
  })
})
