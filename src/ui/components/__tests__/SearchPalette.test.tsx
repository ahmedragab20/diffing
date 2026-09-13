// @vitest-environment jsdom
import * as React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchPalette } from "../SearchPalette";

vi.mock("../../primitives/Modal", () => ({
  Modal: ({
    open,
    children,
    onClose,
    onKeyDown,
  }: {
    open: boolean;
    children: ReactNode;
    onClose: () => void;
    onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  }) =>
    open ? (
      <div role="dialog" onKeyDown={onKeyDown}>
        <button aria-label="Close palette" onClick={onClose}>
          close
        </button>
        {children}
      </div>
    ) : null,
}));
vi.mock("@pierre/diffs/react", () => ({
  File: () => <div data-testid="preview-file" />,
}));
vi.mock("../../utils", () => ({
  scrollToLine: vi.fn(),
  fileName: (path: string) => path.split("/").pop(),
  SHIKI_THEME_MAP: {
    "rose-pine": { themeName: "rose-pine", type: "dark" },
    "github-dark": { themeName: "github-dark", type: "dark" },
  },
  highlightLineInElement: vi.fn(),
}));

type PaletteProps = React.ComponentProps<typeof SearchPalette>;
const files: PaletteProps["files"] = ["src/alpha.ts", "src/beta.ts"].map(
  (name) => ({
    name,
    type: "change",
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: true,
    additionLines: [],
    deletionLines: [],
  }),
);
const common: PaletteProps = {
  isOpen: true,
  initialScope: "all" as const,
  onClose: vi.fn(),
  files,
  changedEntries: [],
  customMode: false,
  staged: false,
  onNavigateFile: vi.fn(),
  theme: "github-dark",
  fontSize: 12,
  monoFontFamily: "monospace",
  defaultTabSize: 2,
  lineWrap: false,
  showLineNumbers: true,
  lineHoverHighlight: "line",
};
const clients: QueryClient[] = [];
function makeClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  return client;
}
function renderPalette(props: Partial<PaletteProps> = {}) {
  const client = makeClient();
  return render(
    <QueryClientProvider client={client}>
      <SearchPalette {...common} {...props} />
    </QueryClientProvider>,
  );
}
function searchResponse(scope: "all" | "files" | "text", query = "alpha") {
  if (scope === "files")
    return {
      scope,
      total: 1,
      indexing: false,
      items: [
        {
          path: "src/alpha.ts",
          fileName: "alpha.ts",
          gitStatus: "modified",
          matchType: "",
          exact: true,
        },
      ],
    };
  if (scope === "text")
    return {
      scope,
      total: 1,
      indexing: false,
      items: [
        {
          path: "src/alpha.ts",
          fileName: "alpha.ts",
          line: 1,
          col: 1,
          content: query,
          matchRanges: [[0, query.length]],
          gitStatus: "modified",
        },
      ],
    };
  return {
    scope,
    total: 1,
    indexing: false,
    items: [
      {
        kind: "file",
        hit: {
          path: "src/alpha.ts",
          fileName: "alpha.ts",
          gitStatus: "modified",
          matchType: "",
          exact: true,
        },
      },
    ],
  };
}

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SearchPalette", () => {
  it("does not reset query, Text scope, or regex when the parent echoes changed-only preference", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              searchResponse(JSON.parse(String(init?.body)).scope),
            ),
            { status: 200 },
          ),
        ),
      ),
    );
    function Harness() {
      const [changed, setChanged] = React.useState(false);
      return (
        <SearchPalette
          {...common}
          initialScope="all"
          initialChangedOnly={changed}
          onChangedOnlyPreference={setChanged}
        />
      );
    }
    render(
      <QueryClientProvider client={makeClient()}>
        <Harness />
      </QueryClientProvider>,
    );
    const input = () => screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input(), { target: { value: "needle" } });
    fireEvent.click(screen.getByRole("tab", { name: "Text" }));
    fireEvent.click(screen.getByTitle("Regular expression"));
    fireEvent.keyDown(input(), { key: "g", ctrlKey: true });
    expect(input().value).toBe("needle");
    expect(screen.getByRole("tab", { name: "Text" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTitle("Regular expression")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Changed" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("cannot activate stale hits by pressing Enter while a new request is pending", async () => {
    let release!: (r: Response) => void;
    const fetchMock = vi.fn((_: string, init?: RequestInit) => {
      const query = JSON.parse(String(init?.body)).query;
      return query === "beta"
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(
            new Response(JSON.stringify(searchResponse("files")), {
              status: 200,
            }),
          );
    });
    vi.stubGlobal("fetch", fetchMock);
    const navigate = vi.fn();
    const close = vi.fn();
    const snapshot = vi.fn();
    renderPalette({
      initialScope: "files",
      initialChangedOnly: false,
      onNavigateFile: navigate,
      onClose: close,
      onSessionSnapshot: snapshot,
    });
    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "alpha" } });
    await waitFor(() => expect(screen.getByRole("option")).toBeInTheDocument());
    fireEvent.change(input, { target: { value: "beta" } });
    await waitFor(
      () =>
        expect(
          fetchMock.mock.calls.some(
            ([, init]) => JSON.parse(String(init?.body)).query === "beta",
          ),
        ).toBe(true),
      { timeout: 1000 },
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigate).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    await act(async () =>
      release(
        new Response(JSON.stringify(searchResponse("files", "beta")), {
          status: 200,
        }),
      ),
    );
  });

  it("shows Search failed and Retry for HTTP500, not No matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("broken", { status: 500 }))),
    );
    renderPalette({ initialScope: "text" });
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "alpha" },
    });
    await waitFor(() =>
      expect(screen.getByText("Search failed")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/No matches/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("preserves the query across close and reopen", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify(searchResponse("all")))),
      ),
    );
    function Harness() {
      const [open, setOpen] = React.useState(true);
      return (
        <>
          <button onClick={() => setOpen((v) => !v)}>toggle</button>
          <SearchPalette {...common} isOpen={open} />
        </>
      );
    }
    render(
      <QueryClientProvider client={makeClient()}>
        <Harness />
      </QueryClientProvider>,
    );
    const input = () => screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input(), { target: { value: "persist" } });
    fireEvent.click(screen.getByText("toggle"));
    fireEvent.click(screen.getByText("toggle"));
    expect(input().value).toBe("persist");
  });

  it("snapshots nonempty hits when a successful activation closes the palette", async () => {
    const items = files.map(({ name }) => ({
      path: name,
      fileName: name.split("/").pop(),
      gitStatus: "modified",
      matchType: "",
      exact: true,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              scope: "files",
              items,
              total: 2,
              indexing: false,
            }),
          ),
        ),
      ),
    );
    const snapshot = vi.fn();
    function Harness() {
      const [open, setOpen] = React.useState(true);
      return (
        <SearchPalette
          {...common}
          initialScope="files"
          isOpen={open}
          onClose={() => setOpen(false)}
          onSessionSnapshot={snapshot}
        />
      );
    }
    render(
      <QueryClientProvider client={makeClient()}>
        <Harness />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    fireEvent.click(screen.getAllByRole("option")[1]);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(snapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        index: 1,
        hits: [
          expect.objectContaining({ path: "src/alpha.ts" }),
          expect.objectContaining({ path: "src/beta.ts" }),
        ],
      }),
    );
  });
});
