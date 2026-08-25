import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { AiAssistantRail } from "../AiAssistantRail";

const mocks = vi.hoisted(() => ({
	setRailWidth: vi.fn(async () => {}),
	run: vi.fn(),
	cancel: vi.fn(async () => {}),
}));

vi.mock("../AiContext", () => ({
	useOptionalAi: () => ({
		models: [{
			id: "codex/subscription/codex/gpt-test",
			displayName: "GPT Test",
			sourceId: "codex",
			credentialRoute: "subscription",
			providerId: "codex",
			modelId: "gpt-test",
		}],
		selectedModel: "codex/subscription/codex/gpt-test",
		railWidth: 360,
		setRailWidth: mocks.setRailWidth,
		run: mocks.run,
		cancel: mocks.cancel,
	}),
}));

describe("AiAssistantRail", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.run.mockResolvedValue({ text: "# Answer\n\n```ts\nconst value = 1\n```", runId: "r1", warnings: [] });
	});
	afterEach(() => vi.unstubAllGlobals());
	const renderRail = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

	it("renders a deliberate user-triggered empty state", () => {
		renderRail(<AiAssistantRail open onClose={vi.fn()} surface="diff" context={{ kind: "diff", patch: "+x" }} />);
		expect(screen.getByText("What do you want to understand?")).toBeInTheDocument();
		expect(screen.getByText(/Nothing runs until you tell it to/)).toBeInTheDocument();
		expect(mocks.run).not.toHaveBeenCalled();
	});

	it("resizes from the left edge and persists on release", () => {
		renderRail(<AiAssistantRail open onClose={vi.fn()} surface="diff" context={{ kind: "diff" }} />);
		const separator = screen.getByRole("separator", { name: "Resize AI assistant" });
		fireEvent.mouseDown(separator, { clientX: 500 });
		fireEvent.mouseMove(document, { clientX: 420 });
		fireEvent.mouseUp(document);
		expect(mocks.setRailWidth).toHaveBeenCalledWith(440);
	});

	it("supports keyboard resizing", () => {
		renderRail(<AiAssistantRail open onClose={vi.fn()} surface="plan" context={{ kind: "plan", planId: "p1", title: "Plan", version: 1 }} />);
		fireEvent.keyDown(screen.getByRole("separator", { name: "Resize AI assistant" }), { key: "ArrowLeft" });
		expect(mocks.setRailWidth).toHaveBeenCalledWith(376);
	});

	it("uses FFF mentions as explicit file attachments and renders streamed Markdown", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
			scope: "files",
			items: [{ path: "docs/cli.md", fileName: "cli.md", gitStatus: "", matchType: "fuzzy", exact: false }],
			total: 1,
			indexing: false,
		}), { status: 200 })));
		const user = userEvent.setup();
		renderRail(<AiAssistantRail open onClose={vi.fn()} surface="diff" context={{ kind: "diff" }} />);
		const composer = screen.getByRole("textbox", { name: "Ask AI" });
		await user.type(composer, "Review @cli");
		await user.click(await screen.findByRole("option", { name: /cli\.md/i }));
		expect(screen.getByRole("button", { name: /Remove docs\/cli\.md/i })).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: /Send/i }));
		await screen.findByRole("heading", { level: 1, name: /Answer/i });
		expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
		expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({
			context: expect.objectContaining({ attachmentPaths: ["docs/cli.md"] }),
		}));
	});

	it("clears the composer immediately and shows the labeled thinking state", async () => {
		let release!: () => void;
		mocks.run.mockImplementation(() => new Promise((resolve) => {
			release = () => resolve({ text: "Done", runId: "r2", warnings: [] });
		}));
		vi.stubGlobal("fetch", vi.fn(async (input, init) => {
			const url = String(input);
			if (url.includes("/api/ai/conversations?") && !init?.method) return new Response(JSON.stringify({ conversations: [] }), { status: 200 });
			if (url.endsWith("/api/ai/conversations") && init?.method === "POST") return new Response(JSON.stringify({ conversation: { id: "c1", title: "New conversation", surface: "diff", scopeKey: "review", createdAt: 1, updatedAt: 1, turns: [] } }), { status: 201 });
			return new Response(JSON.stringify({}), { status: 200 });
		}));
		const user = userEvent.setup();
		renderRail(<AiAssistantRail open onClose={vi.fn()} surface="diff" context={{ kind: "diff" }} />);
		const composer = screen.getByRole("textbox", { name: "Ask AI" });
		await user.type(composer, "Explain this change");
		await waitFor(() => expect(screen.getByRole("button", { name: /Send/i })).not.toBeDisabled());
		await user.click(screen.getByRole("button", { name: /Send/i }));
		await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Thinking about your request"));
		expect(composer).toHaveValue("");
		release();
		await waitFor(() => expect(screen.getByText("Done")).toBeInTheDocument());
	});
});
