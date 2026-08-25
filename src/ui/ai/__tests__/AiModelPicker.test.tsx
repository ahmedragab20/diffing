import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiModelPicker } from "../AiModelPicker";

vi.mock("../AiContext", () => ({
	useOptionalAi: () => ({ models: [], selectedModel: "", defaultModel: "", loading: true, selectModel: vi.fn() }),
}));

describe("AiModelPicker loading", () => {
	it("renders a control-shaped accessible skeleton", () => {
		render(<AiModelPicker />);
		expect(screen.getByRole("status", { name: "Loading AI models" })).toBeInTheDocument();
		expect(screen.queryByText("AI…")).not.toBeInTheDocument();
	});
});
