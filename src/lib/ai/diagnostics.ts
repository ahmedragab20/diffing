export type AiDiagnosticCode =
	| "source_unavailable"
	| "upstream_omission"
	| "evidence_excluded"
	| "history_truncated"
	| "attachment_truncated"
	| "context_truncated"
	| "provenance_note";

export interface AiDiagnostic {
	code: AiDiagnosticCode;
	severity: "info" | "warning";
	message: string;
	sourceId?: string;
	startLine?: number;
	endLine?: number;
}

export function warning(code: AiDiagnosticCode, message: string): AiDiagnostic {
	return { code, severity: "warning", message };
}
