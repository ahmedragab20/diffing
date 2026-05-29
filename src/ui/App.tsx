import {
    useState,
    useMemo,
    useCallback,
    useRef,
    useEffect,
    useTransition,
} from "react";
import { parsePatchFiles, preloadHighlighter } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import { useWorkerPool } from "@pierre/diffs/react";
import type {
    LineDiffType,
    DiffIndicators,
    HunkSeparatorStyle,
    LineHoverHighlight,
} from "./hooks/useSettings";
import { useHotkeySequence } from "@tanstack/react-hotkeys";
import { SHIKI_THEME_MAP } from "./utils";
import type { ReviewComment } from "../lib/types";
import { useDiff } from "./hooks/useDiff";
import { useComments } from "./hooks/useComments";
import { useMergeStatus } from "./hooks/useMergeStatus";
import { useSettings } from "./hooks/useSettings";
import { useViewed } from "./hooks/useViewed";
import { HapticsProvider, playSound, fireFeedback } from "./hooks/useHaptics";
import { useDiffSearch } from "./hooks/useDiffSearch";
import { Toolbar } from "./components/Toolbar";
import { DiffViewer } from "./components/DiffViewer";
import { MergeConflictResolver } from "./components/MergeConflictResolver";
import { FileTree } from "./components/FileTree";
import { CommentTracker } from "./components/CommentTracker";
import { SearchPalette } from "./components/SearchPalette";
import type { Scope } from "./lib/searchTypes";
import { VimStatusBar } from "./components/VimStatusBar";
import { ShortcutsHelpModal } from "./components/ShortcutsHelpModal";
import { AgentActivityToast } from "./components/AgentActivityToast";
import { ThemeModal } from "./components/ThemeModal";


export function App() {
    const poolManager = useWorkerPool();
    const { settings, loaded, updateSettings } = useSettings();
    const [, startTransition] = useTransition();
    const {
        patch,
        repoName,
        branch,
        customMode,
        binaryFiles,
        tabSizeMap,
        untrackedFiles,
        loading,
        refreshing,
        error,
    } = useDiff(
        {
            staged: settings.staged,
            untracked: settings.untracked,
        },
        true,
    );
    const { comments, addComment, removeComment, resolveComment, unresolveComment, addReply, editComment, editReply, removeReply, copyAllComments, agentActivity, clearAgentActivity, sendToAgent, sending, agentWaiting } =
        useComments();
    const { status: mergeStatus, refresh: refreshMergeStatus } = useMergeStatus(patch);
    const [activeFile, setActiveFile] = useState<string | null>(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
        try {
            return localStorage.getItem("diffing-sidebar-collapsed") === "true";
        } catch {
            return false;
        }
    });
    const [sidebarWidth, setSidebarWidth] = useState(() => {
        try {
            const stored = localStorage.getItem("diffing-sidebar-width");
            return stored ? Number(stored) : 320;
        } catch {
            return 320;
        }
    });
    const sidebarWidthRef = useRef(sidebarWidth);
    sidebarWidthRef.current = sidebarWidth;
    const appRef = useRef<HTMLDivElement>(null);
    const sidebarRef = useRef<HTMLElement>(null);
    const sidebarGuideRef = useRef<HTMLDivElement>(null);

    const SIDEBAR_MIN_WIDTH = 240;
    const SIDEBAR_MAX_WIDTH = 640;

    // Resizing the sidebar live is not viable: every width change relayouts the
    // diff content in <main> (the @pierre/diffs shadow DOM re-wraps every line),
    // which measures at ~80-180ms per frame on a real diff — far too slow for a
    // smooth 60fps drag. So instead of resizing the panel on each mousemove, we
    // drag a lightweight guide line that tracks the cursor via a compositor-only
    // `transform` (zero layout), and commit the real width exactly once on
    // mouseup. The drag feels perfectly snappy and the expensive reflow happens
    // a single time, on release.
    const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = sidebarWidthRef.current;
        const sidebarEl = sidebarRef.current;
        const guideEl = sidebarGuideRef.current;
        // The sidebar's left edge is fixed for the duration of the drag, so the
        // guide's screen position is simply that edge plus the prospective width.
        const sidebarLeft = sidebarEl
            ? sidebarEl.getBoundingClientRect().left
            : 0;
        let latestWidth = startWidth;
        let rafId = 0;

        const flush = () => {
            rafId = 0;
            if (guideEl)
                guideEl.style.transform = `translateX(${sidebarLeft + latestWidth}px)`;
        };

        if (guideEl) {
            guideEl.style.transform = `translateX(${sidebarLeft + startWidth}px)`;
            guideEl.classList.add("sidebar-resize-guide-active");
        }

        const handleMove = (ev: MouseEvent) => {
            const delta = ev.clientX - startX;
            latestWidth = Math.max(
                SIDEBAR_MIN_WIDTH,
                Math.min(SIDEBAR_MAX_WIDTH, startWidth + delta),
            );
            if (!rafId) rafId = requestAnimationFrame(flush);
        };

        const handleUp = () => {
            if (rafId) cancelAnimationFrame(rafId);
            if (guideEl)
                guideEl.classList.remove("sidebar-resize-guide-active");
            // Single, one-time width commit -> one reflow of the diff.
            setSidebarWidth(latestWidth);
            try {
                localStorage.setItem("diffing-sidebar-width", String(latestWidth));
            } catch {}
            document.removeEventListener('mousemove', handleMove);
            document.removeEventListener('mouseup', handleUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, []);

    const [palette, setPalette] = useState<{ open: boolean; scope: Scope }>({
        open: false,
        scope: "files",
    });
    const openPalette = useCallback(
        (scope: Scope) => setPalette({ open: true, scope }),
        [],
    );
    const closePalette = useCallback(
        () => setPalette((p) => ({ ...p, open: false })),
        [],
    );
    const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
    const [themeModalOpen, setThemeModalOpen] = useState(false);
    const [commentPanelHeight, setCommentPanelHeight] = useState(() => {
        try {
            const stored = localStorage.getItem("diffing-comment-panel-height");
            return stored ? Number(stored) : 220;
        } catch {
            return 220;
        }
    });
    const commentPanelHeightRef = useRef(commentPanelHeight);
    commentPanelHeightRef.current = commentPanelHeight;

    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const startY = e.clientY;
        const startHeight = commentPanelHeightRef.current;
        const appEl = appRef.current;
        let latestHeight = startHeight;
        let rafId = 0;

        const flush = () => {
            rafId = 0;
            appEl?.style.setProperty("--comment-panel-height", `${latestHeight}px`);
        };

        const handleMove = (ev: MouseEvent) => {
            const delta = startY - ev.clientY;
            latestHeight = Math.max(100, Math.min(600, startHeight + delta));
            if (!rafId) rafId = requestAnimationFrame(flush);
        };

        const handleUp = () => {
            if (rafId) cancelAnimationFrame(rafId);
            setCommentPanelHeight(latestHeight);
            try {
                localStorage.setItem("diffing-comment-panel-height", String(latestHeight));
            } catch {}
            document.removeEventListener('mousemove', handleMove);
            document.removeEventListener('mouseup', handleUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleUp);
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem("diffing-comment-panel-height", String(commentPanelHeight));
        } catch {}
    }, [commentPanelHeight]);
    const { viewedFiles, setViewed } = useViewed();
    const diffViewerRef = useRef<HTMLDivElement>(null);

    useHotkeySequence(['G', 'S'], () => openPalette('symbols'));
    useHotkeySequence(['G', 'F'], () => openPalette('all'));
    useHotkeySequence(['G', 'V'], () => openPalette('files'));

    // Cmd/Ctrl+K opens the search palette from anywhere (including text fields),
    // matching the universal command-palette convention.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault();
                setPalette((p) => (p.open ? { ...p, open: false } : { open: true, scope: 'all' }));
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem(
                "diffing-sidebar-collapsed",
                String(sidebarCollapsed),
            );
        } catch {}
    }, [sidebarCollapsed]);

    const untrackedSet = useMemo(
        () => new Set(untrackedFiles),
        [untrackedFiles],
    );

    const prevFilesRef = useRef<FileDiffMetadata[]>([]);

    const files = useMemo(() => {
        if (!patch) return [];
        try {
            const parsed = parsePatchFiles(patch);
            const parsedFiles = parsed.flatMap((p) => p.files);

            // Add synthetic entries for binary files not already in parsed output
            const existingNames = new Set(parsedFiles.map((f) => f.name));
            for (const bf of binaryFiles) {
                if (!existingNames.has(bf.path)) {
                    const syntheticFile: FileDiffMetadata = {
                        name: bf.path,
                        type:
                            bf.type === "added" || bf.type === "untracked"
                                ? "new"
                                : bf.type === "deleted"
                                  ? "deleted"
                                  : "change",
                        hunks: [],
                        splitLineCount: 0,
                        unifiedLineCount: 0,
                        isPartial: true,
                        deletionLines: [],
                        additionLines: [],
                    };
                    parsedFiles.push(syntheticFile);
                }
            }

            // Optimize rendering by keeping exact object references for unchanged files
            const cachedFiles = parsedFiles.map((newFile) => {
                const prevFile = prevFilesRef.current.find(
                    (f) => f.name === newFile.name,
                );
                if (
                    prevFile &&
                    prevFile.type === newFile.type &&
                    prevFile.isPartial === newFile.isPartial &&
                    prevFile.deletionLines.length ===
                        newFile.deletionLines.length &&
                    prevFile.additionLines.length ===
                        newFile.additionLines.length &&
                    JSON.stringify(prevFile.hunks) ===
                        JSON.stringify(newFile.hunks)
                ) {
                    return prevFile;
                }
                return newFile;
            });

            prevFilesRef.current = cachedFiles;
            return cachedFiles;
        } catch {
            return [];
        }
    }, [patch, binaryFiles]);

    const diffSearchEntries = useDiffSearch(files);

    const diffStats = useMemo(() => {
        if (!patch) return { additions: 0, deletions: 0 };
        let additions = 0;
        let deletions = 0;
        let index = 0;
        const len = patch.length;

        while (index < len) {
            let nextNewline = patch.indexOf("\n", index);
            if (nextNewline === -1) {
                nextNewline = len;
            }

            const firstChar = patch.charCodeAt(index);
            if (firstChar === 43) {
                // '+'
                if (
                    index + 2 < len &&
                    patch.charCodeAt(index + 1) === 43 &&
                    patch.charCodeAt(index + 2) === 43
                ) {
                    // Skip '+++'
                } else {
                    additions++;
                }
            } else if (firstChar === 45) {
                // '-'
                if (
                    index + 2 < len &&
                    patch.charCodeAt(index + 1) === 45 &&
                    patch.charCodeAt(index + 2) === 45
                ) {
                    // Skip '---'
                } else {
                    deletions++;
                }
            }

            index = nextNewline + 1;
        }

        return { additions, deletions };
    }, [patch]);

    const binaryFileMap = useMemo(() => {
        const map = new Map<string, (typeof binaryFiles)[number]>();
        for (const bf of binaryFiles) {
            map.set(bf.path, bf);
        }
        return map;
    }, [binaryFiles]);

    const commentCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const c of comments) {
            counts[c.filePath] = (counts[c.filePath] ?? 0) + 1;
        }
        return counts;
    }, [comments]);

    const prevAnnotationsRef = useRef<
        Map<
            string,
            {
                side: ReviewComment["side"];
                lineNumber: number;
                metadata: ReviewComment;
            }[]
        >
    >(new Map());

    const fileAnnotationsMap = useMemo(() => {
        const nextMap = new Map<
            string,
            {
                side: ReviewComment["side"];
                lineNumber: number;
                metadata: ReviewComment;
            }[]
        >();
        const groups = new Map<string, ReviewComment[]>();

        // Group comments by file path
        for (const c of comments) {
            let g = groups.get(c.filePath);
            if (!g) {
                g = [];
                groups.set(c.filePath, g);
            }
            g.push(c);
        }

        for (const [filePath, fileComments] of groups) {
            const list = fileComments.map((c) => ({
                side: c.side,
                lineNumber: c.lineNumber,
                metadata: c,
            }));

            // Compare with previous annotations for this file
            const prevList = prevAnnotationsRef.current.get(filePath);
            if (prevList && JSON.stringify(prevList) === JSON.stringify(list)) {
                nextMap.set(filePath, prevList);
            } else {
                nextMap.set(filePath, list);
            }
        }

        prevAnnotationsRef.current = nextMap;
        return nextMap;
    }, [comments]);

    const handleFileClick = useCallback((filePath: string) => {
        setActiveFile(filePath);
        const el = document.getElementById(`file-${filePath}`);
        if (el) {
            el.scrollIntoView({ block: "start" });
        }
    }, []);

    const handleViewedChange = useCallback(
        (filePath: string, viewed: boolean) => {
            setViewed(filePath, viewed);
        },
        [setViewed],
    );

    const handleDiffStyleChange = useCallback(
        (style: "split" | "unified") => {
            startTransition(() => {
                updateSettings({ diffStyle: style });
            });
        },
        [updateSettings],
    );

    const handleDiffOptionsChange = useCallback(
        (options: { staged: boolean; untracked: boolean }) => {
            startTransition(() => {
                updateSettings(options);
            });
        },
        [updateSettings],
    );

    const handleDefaultTabSizeChange = useCallback(
        (size: number) => {
            startTransition(() => {
                updateSettings({ defaultTabSize: size });
            });
        },
        [updateSettings],
    );

    const handleBrowserChange = useCallback(
        (browser: string) => {
            startTransition(() => {
                updateSettings({ browser });
            });
        },
        [updateSettings],
    );

    const handleThemeChange = useCallback(
        (theme: string) => {
            startTransition(() => {
                updateSettings({ theme });
            });
        },
        [updateSettings],
    );

    const handleEditorIDEChange = useCallback(
        (editor: string) => {
            startTransition(() => {
                updateSettings({ editorIDE: editor as any });
            });
        },
        [updateSettings],
    );

    const handleLineDiffTypeChange = useCallback(
        (v: LineDiffType) => {
            startTransition(() => {
                updateSettings({ lineDiffType: v });
            });
        },
        [updateSettings],
    );

    const handleLineWrapChange = useCallback(
        (v: boolean) => {
            startTransition(() => {
                updateSettings({ lineWrap: v });
            });
        },
        [updateSettings],
    );

    const handleDiffIndicatorsChange = useCallback(
        (v: DiffIndicators) => {
            startTransition(() => {
                updateSettings({ diffIndicators: v });
            });
        },
        [updateSettings],
    );

    const handleShowLineNumbersChange = useCallback(
        (v: boolean) => {
            startTransition(() => {
                updateSettings({ showLineNumbers: v });
            });
        },
        [updateSettings],
    );

    const handleHunkSeparatorsChange = useCallback(
        (v: HunkSeparatorStyle) => {
            startTransition(() => {
                updateSettings({ hunkSeparators: v });
            });
        },
        [updateSettings],
    );

    const handleLineHoverHighlightChange = useCallback(
        (v: LineHoverHighlight) => {
            startTransition(() => {
                updateSettings({ lineHoverHighlight: v });
            });
        },
        [updateSettings],
    );

    const handleFontSizeChange = useCallback(
        (v: number) => {
            startTransition(() => {
                updateSettings({ fontSize: v });
            });
        },
        [updateSettings],
    );

    const handleHapticsChange = useCallback(
        (v: boolean) => {
            updateSettings({ haptics: v });
        },
        [updateSettings],
    );

    const handleSoundsChange = useCallback(
        (v: boolean) => {
            updateSettings({ sounds: v });
        },
        [updateSettings],
    );

    const toggleLineWrap = useCallback(() => {
        handleLineWrapChange(!settings.lineWrap);
    }, [settings.lineWrap, handleLineWrapChange]);

    const toggleLineNumbers = useCallback(() => {
        handleShowLineNumbersChange(!settings.showLineNumbers);
    }, [settings.showLineNumbers, handleShowLineNumbersChange]);

    const cycleDiffIndicators = useCallback(() => {
        const order: DiffIndicators[] = ["classic", "bars", "none"];
        const cur = settings.diffIndicators || "classic";
        const next = order[(order.indexOf(cur) + 1) % order.length];
        handleDiffIndicatorsChange(next);
    }, [settings.diffIndicators, handleDiffIndicatorsChange]);

    const cycleLineDiffType = useCallback(() => {
        const order: LineDiffType[] = ["word", "word-alt", "char", "none"];
        const cur = settings.lineDiffType || "word";
        const next = order[(order.indexOf(cur) + 1) % order.length];
        handleLineDiffTypeChange(next);
    }, [settings.lineDiffType, handleLineDiffTypeChange]);

    const handleToggleCollapse = useCallback(() => {
        setSidebarCollapsed((c) => !c);
    }, []);

    const navigateFile = useCallback((direction: 'next' | 'prev') => {
        if (files.length === 0) return;
        let nextIndex = 0;
        if (activeFile) {
            const currentIndex = files.findIndex(f => f.name === activeFile);
            if (currentIndex !== -1) {
                if (direction === 'next') {
                    nextIndex = Math.min(currentIndex + 1, files.length - 1);
                } else {
                    nextIndex = Math.max(currentIndex - 1, 0);
                }
            }
        }
        const nextFile = files[nextIndex].name;
        setActiveFile(nextFile);
        const el = document.getElementById(`file-${nextFile}`);
        if (el) {
            el.scrollIntoView({ block: 'start' });
        }
    }, [files, activeFile, setActiveFile]);

    const toggleActiveFileViewed = useCallback(() => {
        if (!activeFile) return;
        const isCurrentlyViewed = viewedFiles.has(activeFile);
        setViewed(activeFile, !isCurrentlyViewed);
    }, [activeFile, viewedFiles, setViewed]);

    const toggleDiffStyle = useCallback(() => {
        const nextStyle = settings.diffStyle === 'split' ? 'unified' : 'split';
        handleDiffStyleChange(nextStyle);
    }, [settings.diffStyle, handleDiffStyleChange]);

    const cycleTabSize = useCallback(() => {
        const sizes = [2, 4, 8];
        const current = settings.defaultTabSize || 4;
        const nextIndex = (sizes.indexOf(current) + 1) % sizes.length;
        handleDefaultTabSizeChange(sizes[nextIndex]);
    }, [settings.defaultTabSize, handleDefaultTabSizeChange]);

    const toggleSidebar = useCallback(() => {
        handleToggleCollapse();
    }, [handleToggleCollapse]);

    useEffect(() => {
        let keyBuffer = '';
        let bufferTimeout: NodeJS.Timeout;
        let lastNavSound = 0;

        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            const active = document.activeElement;
            if (active) {
                const tag = active.tagName.toLowerCase();
                if (
                    tag === 'input' ||
                    tag === 'textarea' ||
                    active.hasAttribute('contenteditable')
                ) {
                    return;
                }
            }

            clearTimeout(bufferTimeout);
            const key = e.key;

            if (e.ctrlKey) {
                if (key === 'd') {
                    e.preventDefault();
                    window.scrollBy({ top: window.innerHeight / 2, behavior: 'auto' });
                    fireFeedback('selection', 'navigate');
                    keyBuffer = '';
                } else if (key === 'u') {
                    e.preventDefault();
                    window.scrollBy({ top: -window.innerHeight / 2, behavior: 'auto' });
                    fireFeedback('selection', 'navigate');
                    keyBuffer = '';
                }
                return;
            }

            if (key.length > 1 && key !== 'Escape' && key !== 'Enter') return;

            keyBuffer += key;
            bufferTimeout = setTimeout(() => {
                keyBuffer = '';
            }, 800);

            if (keyBuffer === 'j') {
                e.preventDefault();
                window.scrollBy({ top: 100, behavior: 'auto' });
                const now = Date.now();
                if (now - lastNavSound > 80) { playSound('navigate'); lastNavSound = now; }
                keyBuffer = '';
            } else if (keyBuffer === 'k') {
                e.preventDefault();
                window.scrollBy({ top: -100, behavior: 'auto' });
                const now = Date.now();
                if (now - lastNavSound > 80) { playSound('navigate'); lastNavSound = now; }
                keyBuffer = '';
            } else if (keyBuffer === 'gg') {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'auto' });
                fireFeedback('selection', 'navigate');
                keyBuffer = '';
            } else if (keyBuffer === 'G') {
                e.preventDefault();
                window.scrollTo({
                    top: document.documentElement.scrollHeight,
                    behavior: 'auto',
                });
                fireFeedback('selection', 'navigate');
                keyBuffer = '';
            } else if (keyBuffer === 'J') {
                e.preventDefault();
                navigateFile('next');
                fireFeedback('selection', 'navigate');
                keyBuffer = '';
            } else if (keyBuffer === 'K') {
                e.preventDefault();
                navigateFile('prev');
                fireFeedback('selection', 'navigate');
                keyBuffer = '';
            } else if (keyBuffer === 'v') {
                e.preventDefault();
                toggleActiveFileViewed();
                fireFeedback('selection', 'toggle');
                keyBuffer = '';
            } else if (keyBuffer === 'm') {
                e.preventDefault();
                toggleDiffStyle();
                fireFeedback('selection', 'toggle');
                keyBuffer = '';
            } else if (keyBuffer === 't') {
                e.preventDefault();
                cycleTabSize();
                fireFeedback('selection', 'toggle');
                keyBuffer = '';
            } else if (keyBuffer === 'b') {
                e.preventDefault();
                toggleSidebar();
                fireFeedback('selection', 'toggle');
                keyBuffer = '';
            } else if (keyBuffer === 'w') {
                e.preventDefault();
                toggleLineWrap();
                fireFeedback('selection', 'toggle');
                keyBuffer = '';
            } else if (keyBuffer === 'n') {
                e.preventDefault();
                toggleLineNumbers();
                fireFeedback('selection', 'toggle');
                keyBuffer = '';
            } else if (keyBuffer === 'i') {
                e.preventDefault();
                cycleDiffIndicators();
                fireFeedback('selection', 'toggle');
                keyBuffer = '';
            } else if (keyBuffer === 'I') {
                e.preventDefault();
                cycleLineDiffType();
                fireFeedback('selection', 'toggle');
                keyBuffer = '';
            } else if (keyBuffer === '/') {
                e.preventDefault();
                openPalette('text');
                fireFeedback('medium', 'open');
                keyBuffer = '';
            } else if (keyBuffer === 's') {
                e.preventDefault();
                openPalette('symbols');
                fireFeedback('medium', 'open');
                keyBuffer = '';
            } else if (keyBuffer === 'gv') {
                e.preventDefault();
                openPalette('files');
                fireFeedback('medium', 'open');
                keyBuffer = '';
            } else if (keyBuffer === 'gt') {
                e.preventDefault();
                setThemeModalOpen(true);
                fireFeedback('medium', 'open');
                keyBuffer = '';
            } else if (keyBuffer === '?') {
                e.preventDefault();
                setShortcutsHelpOpen(true);
                fireFeedback('medium', 'open');
                keyBuffer = '';
            } else if (keyBuffer.length >= 2) {
                keyBuffer = '';
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => {
            window.removeEventListener('keydown', handleGlobalKeyDown);
            clearTimeout(bufferTimeout);
        };
    }, [
        files,
        activeFile,
        viewedFiles,
        settings.diffStyle,
        settings.defaultTabSize,
        navigateFile,
        toggleActiveFileViewed,
        toggleDiffStyle,
        cycleTabSize,
        toggleSidebar,
        toggleLineWrap,
        toggleLineNumbers,
        cycleDiffIndicators,
        cycleLineDiffType,
        setThemeModalOpen,
    ]);


    const diffOptions = useMemo(
        () => ({
            staged: settings.staged,
            untracked: settings.untracked,
        }),
        [settings.staged, settings.untracked],
    );

    useEffect(() => {
        const activeTheme = settings.theme || "nord";
        const root = document.documentElement;
        // Suppress the global color/border/box-shadow transitions while the
        // theme attribute flips. Otherwise every card, button and row animates
        // its color change simultaneously, which is what made switching themes
        // feel laggy. We re-enable transitions on the next frame, after the new
        // palette has painted instantly.
        root.classList.add("theme-switching");
        root.setAttribute("data-theme", activeTheme);
        const id = requestAnimationFrame(() => {
            requestAnimationFrame(() => root.classList.remove("theme-switching"));
        });
        return () => cancelAnimationFrame(id);
    }, [settings.theme]);

    const shikiConfig = useMemo(() => {
        const activeTheme = settings.theme || "nord";
        return SHIKI_THEME_MAP[activeTheme] || SHIKI_THEME_MAP.nord;
    }, [settings.theme]);

    useEffect(() => {
        if (!poolManager) return;
        poolManager
            .setRenderOptions({
                theme: {
                    dark:
                        shikiConfig.type === "dark"
                            ? shikiConfig.themeName
                            : "nord",
                    light:
                        shikiConfig.type === "light"
                            ? shikiConfig.themeName
                            : "github-light",
                },
            })
            .catch((err) => {
                console.error("Failed to set worker pool render options:", err);
            });
    }, [poolManager, shikiConfig]);

    // Pre-warm the Shiki highlighter on the main thread for snappier first paint
    useEffect(() => {
        const dark =
            shikiConfig.type === "dark" ? shikiConfig.themeName : "nord";
        const light =
            shikiConfig.type === "light"
                ? shikiConfig.themeName
                : "github-light";
        preloadHighlighter({
            themes: Array.from(new Set([dark, light])),
            langs: [],
        }).catch(() => {});
    }, [shikiConfig]);

    if (loading) {
        return (
            <div className="app skeleton-app">
                <header className="skeleton-toolbar">
                    <div className="skeleton-item skeleton-logo"></div>
                    <div className="skeleton-item skeleton-stats"></div>
                    <div className="skeleton-item skeleton-actions"></div>
                </header>
                <div className="app-body">
                    <aside className="sidebar skeleton-sidebar">
                        <div className="skeleton-search"></div>
                        <div className="skeleton-tree-nodes">
                            {Array.from({ length: 8 }).map((_, i) => (
                                <div
                                    key={i}
                                    className="skeleton-tree-node"
                                    style={{
                                        paddingLeft: `${(i % 3) * 16 + 16}px`,
                                    }}
                                >
                                    <div className="skeleton-node-icon"></div>
                                    <div
                                        className="skeleton-node-text"
                                        style={{
                                            width: `${60 + ((i * 12) % 60)}px`,
                                        }}
                                    ></div>
                                </div>
                            ))}
                        </div>
                    </aside>
                    <main className="main skeleton-main">
                        <div className="diff-viewer">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div
                                    key={i}
                                    className="file-diff-card skeleton-card"
                                >
                                    <div className="skeleton-card-header">
                                        <div
                                            className="skeleton-card-title"
                                            style={{
                                                width: `${120 + ((i * 45) % 150)}px`,
                                            }}
                                        ></div>
                                        <div className="skeleton-card-badge"></div>
                                    </div>
                                    <div className="skeleton-card-body">
                                        {Array.from({ length: 5 }).map(
                                            (_, j) => (
                                                <div
                                                    key={j}
                                                    className="skeleton-code-line"
                                                    style={{
                                                        width: `${50 + ((j * 15) % 45)}%`,
                                                    }}
                                                ></div>
                                            ),
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </main>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="error">
                <p>Error: {error}</p>
            </div>
        );
    }

    return (
        <HapticsProvider enabled={settings.haptics ?? true} soundsEnabled={settings.sounds ?? true}>
        <div
            className="app"
            ref={appRef}
            style={
                {
                    "--sidebar-width": `${sidebarWidth}px`,
                    "--comment-panel-height": `${commentPanelHeight}px`,
                } as React.CSSProperties
            }
        >
            {refreshing && <div className="refresh-bar" role="status" aria-label="Refreshing diff" />}
            <div
                className="sidebar-resize-guide"
                ref={sidebarGuideRef}
                aria-hidden="true"
            />
            <Toolbar
                repoName={repoName}
                branch={branch}
                fileCount={files.length}
                additions={diffStats.additions}
                deletions={diffStats.deletions}
                commentCount={comments.length}
                diffStyle={settings.diffStyle}
                diffOptions={diffOptions}
                defaultTabSize={settings.defaultTabSize}
                browser={settings.browser}
                theme={settings.theme || "nord"}
                editorIDE={settings.editorIDE}
                customMode={customMode}
                lineDiffType={settings.lineDiffType}
                lineWrap={settings.lineWrap}
                diffIndicators={settings.diffIndicators}
                showLineNumbers={settings.showLineNumbers}
                hunkSeparators={settings.hunkSeparators}
                lineHoverHighlight={settings.lineHoverHighlight}
                fontSize={settings.fontSize}
                haptics={settings.haptics ?? true}
                sounds={settings.sounds ?? true}
                onDiffStyleChange={handleDiffStyleChange}
                onDiffOptionsChange={handleDiffOptionsChange}
                onDefaultTabSizeChange={handleDefaultTabSizeChange}
                onBrowserChange={handleBrowserChange}
                onOpenThemeModal={() => setThemeModalOpen(true)}
                onEditorIDEChange={handleEditorIDEChange}
                onLineDiffTypeChange={handleLineDiffTypeChange}
                onLineWrapChange={handleLineWrapChange}
                onDiffIndicatorsChange={handleDiffIndicatorsChange}
                onShowLineNumbersChange={handleShowLineNumbersChange}
                onHunkSeparatorsChange={handleHunkSeparatorsChange}
                onLineHoverHighlightChange={handleLineHoverHighlightChange}
                onFontSizeChange={handleFontSizeChange}
                onHapticsChange={handleHapticsChange}
                onSoundsChange={handleSoundsChange}
                onOpenSearch={() => openPalette('all')}
                onCopyComments={copyAllComments}
                onSendToAgent={sendToAgent}
                agentWaiting={agentWaiting}
                sending={sending}
                comments={comments}
                onEditComment={editComment}
                onDeleteComment={removeComment}
            />
            <div className="app-body">
                <aside
                    ref={sidebarRef}
                    className={`sidebar ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
                >
                    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                        <FileTree
                            files={files}
                            activeFile={activeFile}
                            commentCounts={commentCounts}
                            viewedFiles={viewedFiles}
                            untrackedFiles={untrackedSet}
                            onFileClick={handleFileClick}
                            collapsed={sidebarCollapsed}
                            onToggleCollapse={handleToggleCollapse}
                        />
                    </div>
                    {!sidebarCollapsed && comments.length > 0 && (
                        <>
                            <div
                                className="ct-resize-handle"
                                onMouseDown={handleResizeStart}
                                role="separator"
                                aria-label="Resize comments panel"
                                aria-orientation="horizontal"
                                tabIndex={0}
                            />
                            <div
                                className="ct-wrapper"
                                style={{ flexShrink: 0 }}
                            >
                                <CommentTracker
                                    comments={comments}
                                    resolveComment={resolveComment}
                                    unresolveComment={unresolveComment}
                                    removeComment={removeComment}
                                    addReply={addReply}
                                    editComment={editComment}
                                    editReply={editReply}
                                    removeReply={removeReply}
                                />
                            </div>
                        </>
                    )}

                </aside>
                {!sidebarCollapsed && (
                    <div
                        className="sidebar-resize-handle"
                        onMouseDown={handleSidebarResizeStart}
                        role="separator"
                        aria-label="Resize sidebar"
                        aria-orientation="vertical"
                        tabIndex={0}
                    />
                )}
                <main className="main" ref={diffViewerRef}>
                    {mergeStatus.inMerge && mergeStatus.conflicts.length > 0 && (
                        <div className="merge-conflict-banner">
                            <strong>Merge in progress</strong>
                            <span>
                                {mergeStatus.conflicts.length} unresolved file
                                {mergeStatus.conflicts.length === 1 ? "" : "s"} below.
                                Use the inline buttons to accept current/incoming/both,
                                then "Save &amp; stage".
                            </span>
                        </div>
                    )}
                    {mergeStatus.conflicts.map((conflictPath) => (
                        <MergeConflictResolver
                            key={conflictPath}
                            filePath={conflictPath}
                            theme={settings.theme || "nord"}
                            fontSize={settings.fontSize}
                            tabSize={
                                tabSizeMap[conflictPath] ?? settings.defaultTabSize
                            }
                            onSaved={() => {
                                refreshMergeStatus();
                            }}
                        />
                    ))}
                    <DiffViewer
                        files={files}
                        diffStyle={settings.diffStyle}
                        tabSizeMap={tabSizeMap}
                        defaultTabSize={settings.defaultTabSize}
                        viewedFiles={viewedFiles}
                        binaryFiles={binaryFileMap}
                        theme={settings.theme || "nord"}
                        editorIDE={settings.editorIDE}
                        lineDiffType={settings.lineDiffType}
                        lineWrap={settings.lineWrap}
                        diffIndicators={settings.diffIndicators}
                        showLineNumbers={settings.showLineNumbers}
                        hunkSeparators={settings.hunkSeparators}
                        lineHoverHighlight={settings.lineHoverHighlight}
                        fontSize={settings.fontSize}
                        expandContextByDefault={settings.expandContextByDefault}
                        collapsedContextThreshold={settings.collapsedContextThreshold}
                        expansionLineCount={settings.expansionLineCount}
                        onViewedChange={handleViewedChange}
                        fileAnnotationsMap={fileAnnotationsMap}
                        onAddComment={addComment}
                        onDeleteComment={removeComment}
                    />
                </main>
            </div>
            <SearchPalette
                isOpen={palette.open}
                onClose={closePalette}
                initialScope={palette.scope}
                files={files}
                changedEntries={diffSearchEntries}
                customMode={customMode}
                staged={settings.staged}
                onNavigateFile={handleFileClick}
                theme={settings.theme || "nord"}
                fontSize={settings.fontSize}
                defaultTabSize={settings.defaultTabSize}
                lineWrap={settings.lineWrap}
                showLineNumbers={settings.showLineNumbers}
                lineHoverHighlight={settings.lineHoverHighlight}
            />
            <VimStatusBar
                activeFile={activeFile}
                onShowHelp={() => setShortcutsHelpOpen(true)}
            />
            <ShortcutsHelpModal
                isOpen={shortcutsHelpOpen}
                onClose={() => setShortcutsHelpOpen(false)}
            />
            <ThemeModal
                open={themeModalOpen}
                activeTheme={settings.theme || "nord"}
                onThemeChange={handleThemeChange}
                onClose={() => setThemeModalOpen(false)}
            />
            <AgentActivityToast
                activity={agentActivity}
                onDismiss={clearAgentActivity}
                onJump={handleFileClick}
            />
        </div>
        </HapticsProvider>
    );
}
