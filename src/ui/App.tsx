import {
    useState,
    useMemo,
    useCallback,
    useRef,
    useEffect,
    useTransition,
} from "react";
import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import { useWorkerPool } from "@pierre/diffs/react";
import { useHotkeySequence } from "@tanstack/react-hotkeys";
import { SHIKI_THEME_MAP } from "./utils";
import type { ReviewComment } from "../lib/types";
import { useDiff } from "./hooks/useDiff";
import { useComments } from "./hooks/useComments";
import { useSettings } from "./hooks/useSettings";
import { useViewed } from "./hooks/useViewed";
import { useSymbols } from "./hooks/useSymbols";
import { useDiffSearch } from "./hooks/useDiffSearch";
import { Toolbar } from "./components/Toolbar";
import { DiffViewer } from "./components/DiffViewer";
import { FileTree } from "./components/FileTree";
import { CommentTracker } from "./components/CommentTracker";
import { SymbolModal } from "./components/SymbolModal";
import { DiffSearchModal } from "./components/DiffSearchModal";
import { VimStatusBar } from "./components/VimStatusBar";
import { ShortcutsHelpModal } from "./components/ShortcutsHelpModal";


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
        error,
    } = useDiff(
        {
            staged: settings.staged,
            untracked: settings.untracked,
        },
        true,
    );
    const { comments, addComment, removeComment, resolveComment, unresolveComment, removeReply, copyAllComments } =
        useComments();
    const [activeFile, setActiveFile] = useState<string | null>(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
        try {
            return localStorage.getItem("diffit-sidebar-collapsed") === "true";
        } catch {
            return false;
        }
    });
    const [symbolModalOpen, setSymbolModalOpen] = useState(false);
    const [diffSearchOpen, setDiffSearchOpen] = useState(false);
    const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
    const [commentPanelHeight, setCommentPanelHeight] = useState(() => {
        try {
            const stored = localStorage.getItem("diffit-comment-panel-height");
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

        const handleMove = (ev: MouseEvent) => {
            const delta = startY - ev.clientY;
            const newHeight = Math.max(100, Math.min(600, startHeight + delta));
            setCommentPanelHeight(newHeight);
        };

        const handleUp = () => {
            try {
                localStorage.setItem("diffit-comment-panel-height", String(commentPanelHeightRef.current));
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
            localStorage.setItem("diffit-comment-panel-height", String(commentPanelHeight));
        } catch {}
    }, [commentPanelHeight]);
    const { viewedFiles, setViewed } = useViewed();
    const diffViewerRef = useRef<HTMLDivElement>(null);

    useHotkeySequence(['G', 'S'], () => {
        setSymbolModalOpen((o) => !o);
    });

    useHotkeySequence(['G', 'F'], () => {
        setDiffSearchOpen((o) => !o);
    });

    useEffect(() => {
        try {
            localStorage.setItem(
                "diffit-sidebar-collapsed",
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

    const symbols = useSymbols(files);
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
                    keyBuffer = '';
                } else if (key === 'u') {
                    e.preventDefault();
                    window.scrollBy({ top: -window.innerHeight / 2, behavior: 'auto' });
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
                keyBuffer = '';
            } else if (keyBuffer === 'k') {
                e.preventDefault();
                window.scrollBy({ top: -100, behavior: 'auto' });
                keyBuffer = '';
            } else if (keyBuffer === 'gg') {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'auto' });
                keyBuffer = '';
            } else if (keyBuffer === 'G') {
                e.preventDefault();
                window.scrollTo({
                    top: document.documentElement.scrollHeight,
                    behavior: 'auto',
                });
                keyBuffer = '';
            } else if (keyBuffer === 'J') {
                e.preventDefault();
                navigateFile('next');
                keyBuffer = '';
            } else if (keyBuffer === 'K') {
                e.preventDefault();
                navigateFile('prev');
                keyBuffer = '';
            } else if (keyBuffer === 'v') {
                e.preventDefault();
                toggleActiveFileViewed();
                keyBuffer = '';
            } else if (keyBuffer === 'm') {
                e.preventDefault();
                toggleDiffStyle();
                keyBuffer = '';
            } else if (keyBuffer === 't') {
                e.preventDefault();
                cycleTabSize();
                keyBuffer = '';
            } else if (keyBuffer === 'b') {
                e.preventDefault();
                toggleSidebar();
                keyBuffer = '';
            } else if (keyBuffer === '/') {
                e.preventDefault();
                setDiffSearchOpen(true);
                keyBuffer = '';
            } else if (keyBuffer === 'gs' || keyBuffer === 's') {
                e.preventDefault();
                setSymbolModalOpen(true);
                keyBuffer = '';
            } else if (keyBuffer === '?') {
                e.preventDefault();
                setShortcutsHelpOpen(true);
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
        document.documentElement.setAttribute("data-theme", activeTheme);
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
        <div className="app">
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
                onDiffStyleChange={handleDiffStyleChange}
                onDiffOptionsChange={handleDiffOptionsChange}
                onDefaultTabSizeChange={handleDefaultTabSizeChange}
                onBrowserChange={handleBrowserChange}
                onThemeChange={handleThemeChange}
                onEditorIDEChange={handleEditorIDEChange}
                onCopyComments={copyAllComments}
            />
            <div className="app-body">
                <aside
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
                                style={{ height: commentPanelHeight, flexShrink: 0 }}
                            >
                                <CommentTracker
                                    comments={comments}
                                    resolveComment={resolveComment}
                                    unresolveComment={unresolveComment}
                                    removeComment={removeComment}
                                    removeReply={removeReply}
                                />
                            </div>
                        </>
                    )}

                </aside>
                <main className="main" ref={diffViewerRef}>
                    <DiffViewer
                        files={files}
                        diffStyle={settings.diffStyle}
                        tabSizeMap={tabSizeMap}
                        defaultTabSize={settings.defaultTabSize}
                        viewedFiles={viewedFiles}
                        binaryFiles={binaryFileMap}
                        theme={settings.theme || "nord"}
                        editorIDE={settings.editorIDE}
                        onViewedChange={handleViewedChange}
                        fileAnnotationsMap={fileAnnotationsMap}
                        onAddComment={addComment}
                        onDeleteComment={removeComment}
                    />
                </main>
            </div>
            <SymbolModal
                symbols={symbols}
                isOpen={symbolModalOpen}
                onClose={() => setSymbolModalOpen(false)}
            />
            <DiffSearchModal
                entries={diffSearchEntries}
                isOpen={diffSearchOpen}
                onClose={() => setDiffSearchOpen(false)}
            />
            <VimStatusBar
                activeFile={activeFile}
                onShowHelp={() => setShortcutsHelpOpen(true)}
            />
            <ShortcutsHelpModal
                isOpen={shortcutsHelpOpen}
                onClose={() => setShortcutsHelpOpen(false)}
            />
        </div>
    );
}
