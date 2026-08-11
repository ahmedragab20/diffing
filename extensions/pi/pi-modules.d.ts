/**
 * Ambient declarations for pi-bundled modules.
 *
 * The pi harness provides `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`
 * and `typebox` at extension load time — they are intentionally NOT installed in
 * this repository (keeps the product lockfile free of the pi runtime tree). These
 * declarations let the extension typecheck standalone for editors/LSP; the
 * authoritative types are the real packages resolved by pi at runtime.
 */

declare module "@earendil-works/pi-ai" {
	export function StringEnum<T extends readonly string[]>(
		values: T,
		options?: { description?: string; default?: T[number] },
	): { type: "string"; enum: T; description?: string; default?: T[number] };
}

declare module "@earendil-works/pi-coding-agent" {
export interface ExtensionContext {
cwd: string;
hasUI: boolean;
model?: { id: string; provider?: string };
ui: {
setStatus(id: string, text: string): void;
notify(text: string, level?: "info" | "error" | "success" | "warning"): void;
setWidget?(id: string, lines: string[]): void;
};
}

export interface ToolResult {
content: { type: "text"; text: string }[];
details: Record<string, unknown>;
}

export interface ToolDefinition {
name: string;
label?: string;
description: string;
parameters: any;
execute(
toolCallId: string,
params: any,
signal: AbortSignal | undefined,
onUpdate: any,
ctx: ExtensionContext,
): Promise<ToolResult> | ToolResult;
}

export interface ExtensionAPI {
on(
event: string,
handler: (event: any, ctx: ExtensionContext) => any,
): void;
registerTool(definition: ToolDefinition): void;
registerCommand(
name: string,
definition: {
description?: string;
handler: (args: string | undefined, ctx: ExtensionContext) => any;
},
): void;
}
}

declare module "typebox" {
	export const Type: any;
}
