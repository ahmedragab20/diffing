import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiConnectionsPanel } from "../AiConnectionsPanel";

const mocks = vi.hoisted(() => ({ setSettingsExpanded: vi.fn(async () => {}) }));

vi.mock("../AiContext", () => ({
	useOptionalAi: () => ({
		connections: [{ id: "codex", label: "Codex / ChatGPT", status: "connected", runtimeAvailable: true, credentialRoutes: ["subscription"], activeRoutes: ["subscription"] }],
		models: [{ id: "codex/subscription/codex/sol", displayName: "Sol", sourceId: "codex", credentialRoute: "subscription", providerId: "codex", modelId: "sol" }],
		defaultModel: "codex/subscription/codex/sol",
		settingsExpanded: false,
		setSettingsExpanded: mocks.setSettingsExpanded,
		setDefaultModel: vi.fn(),
		connectKey: vi.fn(), setup: vi.fn(), disconnect: vi.fn(), refresh: vi.fn(), loading: false, error: null,
	}),
}));

describe("AiConnectionsPanel", () => {
	it("keeps the large connection section collapsed until requested", () => {
		render(<AiConnectionsPanel />);
		const toggle = screen.getByRole("button", { name: /AI connections/i });
		expect(toggle).toHaveAttribute("aria-expanded", "false");
		expect(screen.queryByText("Disconnect")).not.toBeInTheDocument();
		fireEvent.click(toggle);
		expect(mocks.setSettingsExpanded).toHaveBeenCalledWith(true);
	});
});
