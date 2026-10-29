import type { DesignSystem } from "./design-system-types.js";
import { tokensToCss } from "./design-system-types.js";
import type { Mockup, MockupComment } from "./mockup-types.js";

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
	/** Every open thread, including blocking comments and questions. */
	openComments: Array<{
		id: string;
		screenId: string;
		body: string;
		severity?: MockupComment["severity"];
	}>;
	guidance: string;
}

export function buildMockupHandoff(
	mockup: Mockup,
	system?: DesignSystem | null,
): MockupHandoff {
	const used = new Set<string>();
	const blob = mockup.screens.map((s) => s.html).join("\n");
	for (const component of system?.components ?? []) {
		if (!component.id) continue;
		if (blob.includes(`data-diffing="${component.id}"`)) used.add(component.id);
	}
	const open = (mockup.comments ?? []).filter((c) => c.status === "open");
	const openNits = open
		.filter((c) => c.severity == null || c.severity === "nit")
		.map((c) => ({ id: c.id, screenId: c.screenId, body: c.body }));
	const openComments = open.map((c) => ({
		id: c.id,
		screenId: c.screenId,
		body: c.body,
		...(c.severity ? { severity: c.severity } : {}),
	}));
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
		openComments,
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
	const comments =
		handoff.openComments.length === 0
			? ""
			: `    <open-comments>\n${handoff.openComments
					.map((n) => {
						const severity = n.severity
							? ` severity="${escape(n.severity)}"`
							: "";
						return `      <comment id="${escape(n.id)}" screen="${escape(n.screenId)}"${severity}>${escape(n.body)}</comment>`;
					})
					.join("\n")}\n    </open-comments>\n`;
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
${comments}${nits}  </mockup>
</mockup-handoff>`;
}

function escape(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
