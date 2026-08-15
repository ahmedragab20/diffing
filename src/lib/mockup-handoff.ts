import type { DesignSystem } from "./design-system-types.js";
import { tokensToCss } from "./design-system-types.js";
import type { Mockup } from "./mockup-types.js";

export interface MockupHandoff {
	mockupId: string;
	title: string;
	version: number;
	decision: string;
	designSystemId?: string;
	designRevision?: number;
	mode?: string;
	planId?: string;
	tokens?: DesignSystem["tokens"];
	tokenCss?: string;
	componentsUsed: string[];
	screens: Array<{
		id: string;
		label: string;
		stateOf?: string;
		flow?: string;
		intent: string;
	}>;
	openNits: Array<{ id: string; screenId: string; body: string }>;
	guidance: string;
}

export function buildMockupHandoff(
	mockup: Mockup,
	system?: DesignSystem | null,
): MockupHandoff {
	const used = new Set<string>();
	const blob = mockup.screens.map((s) => s.html).join("\n");
	for (const component of system?.components ?? []) {
		if (blob.includes(`data-diffing="${component.id}"`) || blob.includes(component.id)) {
			used.add(component.id);
		}
	}
	const openNits = (mockup.comments ?? [])
		.filter((c) => c.status === "open")
		.map((c) => ({ id: c.id, screenId: c.screenId, body: c.body }));
	return {
		mockupId: mockup.id,
		title: mockup.title,
		version: mockup.version,
		decision: mockup.decision,
		designSystemId: mockup.designSystemId ?? system?.id,
		designRevision: mockup.designRevision ?? system?.revision,
		mode: mockup.mode,
		planId: mockup.planId,
		tokens: system?.tokens,
		tokenCss: system ? tokensToCss(system.tokens) : undefined,
		componentsUsed: [...used],
		screens: mockup.screens.map((s) => ({
			id: s.id,
			label: s.label,
			stateOf: s.stateOf,
			flow: s.flow,
			intent: s.stateOf ? `${s.label} (state of ${s.stateOf})` : s.label,
		})),
		openNits,
		guidance:
			"This is a mockup. Match feel (type, color, density, chrome) — not class names or a pixel grid.",
	};
}

export function formatMockupHandoffXml(handoff: MockupHandoff): string {
	const screens = handoff.screens
		.map(
			(s) =>
				`    <screen id="${escape(s.id)}" label="${escape(s.label)}"${s.stateOf ? ` state-of="${escape(s.stateOf)}"` : ""}${s.flow ? ` flow="${escape(s.flow)}"` : ""}>${escape(s.intent)}</screen>`,
		)
		.join("\n");
	const nits =
		handoff.openNits.length === 0
			? ""
			: `    <open-nits>\n${handoff.openNits
					.map(
						(n) =>
							`      <nit id="${escape(n.id)}" screen="${escape(n.screenId)}">${escape(n.body)}</nit>`,
					)
					.join("\n")}\n    </open-nits>\n`;
	return `<mockup-handoff>
  <mockup id="${escape(handoff.mockupId)}" title="${escape(handoff.title)}" version="${handoff.version}" decision="${escape(handoff.decision)}"${handoff.designSystemId ? ` design-system="${escape(handoff.designSystemId)}"` : ""}${handoff.designRevision ? ` design-revision="${handoff.designRevision}"` : ""}${handoff.mode ? ` mode="${escape(handoff.mode)}"` : ""}${handoff.planId ? ` plan="${escape(handoff.planId)}"` : ""}>
    <guidance>${escape(handoff.guidance)}</guidance>
    <screens>
${screens}
    </screens>
${nits}  </mockup>
</mockup-handoff>`;
}

function escape(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
