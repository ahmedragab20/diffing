import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiProvider, useAi } from "../AiContext";

afterEach(() => vi.restoreAllMocks());

describe("AiProvider trigger contract", () => {
	it("loads shared settings/catalog without starting inference", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = String(input);
			if (url.endsWith("/api/ai/connections")) return new Response(JSON.stringify({ connections: [] }), { status: 200 });
			if (url.endsWith("/api/ai/models")) return new Response(JSON.stringify({ models: [] }), { status: 200 });
			if (url.endsWith("/api/settings")) return new Response(JSON.stringify({ aiModel: null }), { status: 200 });
			throw new Error(`Unexpected request: ${url}`);
		});
		render(<AiProvider><div>child</div></AiProvider>);
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
		expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/ai/run"))).toBe(false);
	});

	it("keeps toolbar selection session-only and persists the Settings default", async () => {
		const first = "codex/subscription/codex/sol";
		const second = "cursor/runtime-key/cursor/sonnet";
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = String(input);
			if (url.endsWith("/api/ai/connections")) return new Response(JSON.stringify({ connections: [] }), { status: 200 });
			if (url.endsWith("/api/ai/models")) return new Response(JSON.stringify({ models: [
				{ id: first, displayName: "Sol", sourceId: "codex", credentialRoute: "subscription", providerId: "codex", modelId: "sol" },
				{ id: second, displayName: "Sonnet", sourceId: "cursor", credentialRoute: "runtime-key", providerId: "cursor", modelId: "sonnet" },
			] }), { status: 200 });
			if (url.endsWith("/api/settings") && init?.method === "PUT") return new Response(JSON.stringify({ aiModel: second }), { status: 200 });
			if (url.endsWith("/api/settings")) return new Response(JSON.stringify({ aiModel: first }), { status: 200 });
			throw new Error(`Unexpected request: ${url}`);
		});
		function Controls() {
			const ai = useAi();
			return <><span data-testid="session">{ai.selectedModel}</span><span data-testid="default">{ai.defaultModel}</span><button onClick={() => ai.selectModel(second)}>Session</button><button onClick={() => void ai.setDefaultModel(second)}>Default</button></>;
		}
		render(<AiProvider><Controls /></AiProvider>);
		await waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent(first));
		fireEvent.click(screen.getByText("Session"));
		expect(screen.getByTestId("session")).toHaveTextContent(second);
		expect(screen.getByTestId("default")).toHaveTextContent(first);
		expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
		fireEvent.click(screen.getByText("Default"));
		await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT" && String(init.body).includes(second))).toBe(true));
		expect(screen.getByTestId("default")).toHaveTextContent(second);
	});
});
