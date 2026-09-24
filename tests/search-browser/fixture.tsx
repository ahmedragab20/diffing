import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseDiffFromFile } from "@pierre/diffs";
import { DiffViewer } from "../../src/ui/components/DiffViewer";
import { DiffNavigationStatus } from "../../src/ui/components/DiffNavigationStatus";
import { SearchPalette } from "../../src/ui/components/SearchPalette";
import { buildFileSearchCorpus, useDiffSearch } from "../../src/ui/hooks/useDiffSearch";
import { useFileSearch } from "../../src/ui/hooks/useFileSearch";
import { useSearchSession } from "../../src/ui/hooks/useSearchSession";
import { buildChangedLineKeys, buildDiffFileSet } from "../../src/ui/lib/diffIndex";
import { navigateToFile } from "../../src/ui/lib/diffNavigation";
import { paths, content, targetPath } from "./data";
import "../../src/ui/styles/global.css";
import "../../src/ui/styles/gridline.css";

const params = new URLSearchParams(location.search);
const files = paths.map(name => parseDiffFromFile({ name, contents: content(name, true) }, { name, contents: content(name) }, { context: 3 }));
const corpus = buildFileSearchCorpus(files);
const noop = () => {};
const settings = {
  theme: "rose-pine", fontSize: 13, monoFontFamily: "monospace", defaultTabSize: 2,
  lineWrap: params.has("wrap"), showLineNumbers: true, lineHoverHighlight: "both" as const,
};

function Fixture() {
  const [open, setOpen] = useState(false);
  const [viewed, setViewed] = useState(new Set(params.has("viewed") ? [targetPath] : []));
  const fileSearch = useFileSearch(corpus);
  const changedEntries = useDiffSearch(files);
  const staged = params.has("staged");
  const customMode = params.has("custom");
  const navContext = useMemo(() => ({ diffFileSet: buildDiffFileSet(files), changedKeys: buildChangedLineKeys(changedEntries), staged, customMode }), [changedEntries]);
  const searchSession = useSearchSession(navContext, navigateToFile);
  return <>
    <header style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 100, background: "var(--bg-primary)", padding: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button onClick={() => setOpen(true)}>Open search</button>
      <button onClick={() => fileSearch.open(targetPath)}>Find in target</button>
      <button onClick={() => window.scrollTo(0, 0)}>Top</button>
      <button onClick={searchSession.nextHit}>Next saved result</button>
    </header>
    <main style={{ paddingTop: 85 }}>
      {/* Keep the initial placeholders beyond the renderer's 800px mount margin. */}
      <div style={{ height: 2000 }} aria-hidden="true" />
      <DiffViewer {...settings} files={files} diffStyle={params.get("layout") === "split" ? "split" : "unified"}
        tabSizeMap={{}} viewedFiles={viewed} binaryFiles={new Map()} lineDiffType="word"
        diffIndicators="classic" hunkSeparators="line-info" expandContextByDefault={params.has("expanded")}
        collapsedContextThreshold={10} expansionLineCount={20} autoCollapseLineThreshold={params.has("collapsed") ? 400 : 0}
        fileAnnotationsMap={new Map()} onViewedChange={(path, next) => setViewed(current => {
          const copy = new Set(current); if (next) copy.add(path); else copy.delete(path); return copy;
        })}
        onAddComment={noop} onDeleteComment={noop} allowLocalActions={false}
        fileSearch={fileSearch} onOpenFileSearch={fileSearch.open} />
    </main>
    <SearchPalette {...settings} isOpen={open} onClose={() => setOpen(false)} initialScope="text"
      files={files} changedEntries={changedEntries} staged={staged} customMode={customMode}
      onNavigateFile={navigateToFile} onSessionSnapshot={searchSession.setSnapshot} />
    <DiffNavigationStatus />
  </>;
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <Fixture />
  </QueryClientProvider>,
);
