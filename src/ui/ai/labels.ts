import type { AiSourceId } from "../../lib/ai/types";

export function aiSourceLabel(sourceId: AiSourceId): string {
	return sourceId === "xai" ? "Grok" : sourceId;
}
