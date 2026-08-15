import {
	tokensToCss,
	type DesignComponent,
	type DesignSystem,
	type DesignTokens,
} from "./design-system-types.js";

export type MockupRenderMode = "fragment" | "document";

export const MOCKUP_SLOT = "data-diffing-slot";

const RESET_CSS = `*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--ds-color-bg,#fff);color:var(--ds-color-text,#111);font-family:var(--ds-font-ui,ui-sans-serif,system-ui,sans-serif);line-height:1.45}
img,svg,video{max-width:100%;display:block}
button,input,select,textarea{font:inherit}
`;

export interface WrapFragmentOptions {
	tokens: DesignTokens;
	components?: DesignComponent[];
	title?: string;
	theme?: "light" | "dark";
}

function appShell(components: DesignComponent[] | undefined, inner: string): string {
	const shell = components?.find((c) => c.id === "app-shell");
	if (!shell?.html) {
		return `<main ${MOCKUP_SLOT}="content" data-diffing="content">${inner}</main>`;
	}
	if (shell.html.includes("{{content}}") || shell.html.includes("data-diffing-slot=\"content\"")) {
		return shell.html
			.replace("{{content}}", inner)
			.replace(
				new RegExp(`(<[^>]+${MOCKUP_SLOT}=["']content["'][^>]*>)([\\s\\S]*?)(</[^>]+>)`),
				`$1${inner}$3`,
			);
	}
	return `${shell.html}<main ${MOCKUP_SLOT}="content" data-diffing="content">${inner}</main>`;
}

/** Wrap a fragment in the host document. Stored HTML stays unwrapped. */
export function wrapMockupFragment(
	fragment: string,
	opts: WrapFragmentOptions,
): string {
	const theme = opts.theme ?? "light";
	const css = `${RESET_CSS}\n${tokensToCss(opts.tokens)}`;
	const body = appShell(opts.components, fragment);
	const title = opts.title ?? "Mockup";
	return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export function resolveRenderMode(
	requested: unknown,
	system: DesignSystem | null,
): MockupRenderMode {
	if (requested === "document" || requested === "fragment") return requested;
	return system && system.status === "published" ? "fragment" : "document";
}

export function renderMockupHtml(
	html: string,
	opts: {
		mode: MockupRenderMode;
		system?: DesignSystem | null;
		title?: string;
		theme?: "light" | "dark";
	},
): string {
	if (opts.mode !== "fragment" || !opts.system) return html;
	// A full document must not be nested inside the host shell — that
	// breaks the comment probe (shield / parser hoist).
	if (/<!doctype\s+html|<html[\s>]/i.test(html)) return html;
	return wrapMockupFragment(html, {
		tokens: opts.system.tokens,
		components: opts.system.components,
		title: opts.title,
		theme: opts.theme,
	});
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
