export const DEFAULT_AI_PROMPT_BYTES = 96 * 1024;

export interface AiPromptBudget {
	/** Verified provider metadata only; never inferred from a model name. */
	contextWindowTokens?: number;
	reservedOutputTokens?: number;
}

/** UTF-8 bytes are a conservative fallback, not an exact token measurement. */
export function promptByteLimit(budget?: AiPromptBudget): number {
	if (budget?.contextWindowTokens === undefined) return DEFAULT_AI_PROMPT_BYTES;
	const window = budget.contextWindowTokens;
	const output = budget.reservedOutputTokens ?? 4096;
	if (
		!Number.isSafeInteger(window) ||
		!Number.isSafeInteger(output) ||
		output < 1 ||
		window <= output + 2048
	)
		throw new Error("Invalid AI prompt budget.");
	return Math.min(DEFAULT_AI_PROMPT_BYTES, window - output - 1024);
}
