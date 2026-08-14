import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen, Search, Trash2 } from "lucide-react";
import type { MockupDecision, MockupSummary } from "../../lib/mockup-types";
import { timeAgo } from "../utils";
import { Tooltip } from "../primitives/Tooltip";
import { ConfirmDialog } from "../primitives/ConfirmDialog";
import { DECISION_META } from "./MockupAnchors";

export interface MockupListProps {
	mockups: MockupSummary[];
	activeId: string | null;
	collapsed: boolean;
	onToggle: () => void;
	onSelect: (id: string) => void;
	onDelete: (id: string) => void;
}

export function MockupList({
	mockups,
	activeId,
	collapsed,
	onToggle,
	onSelect,
	onDelete,
}: MockupListProps) {
	const [filter, setFilter] = useState("");
	const [decisionFilter, setDecisionFilter] = useState<"all" | MockupDecision>(
		"all",
	);
	const [toDelete, setToDelete] = useState<MockupSummary | null>(null);
	const pendingCount = mockups.filter((m) => m.decision === "pending").length;
	const filtered = mockups
		.slice()
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.filter((m) => {
			if (decisionFilter !== "all" && m.decision !== decisionFilter)
				return false;
			if (!filter.trim()) return true;
			return `${m.title} ${m.model ?? ""} ${m.id}`
				.toLowerCase()
				.includes(filter.toLowerCase());
		});

	if (collapsed) {
		return (
			<div className="plan-list plan-list-collapsed">
				<Tooltip content="Expand sidebar · b" side="right">
					<button
						className="sidebar-toggle"
						onClick={onToggle}
						aria-label="Expand sidebar"
					>
						<PanelLeftOpen size={16} />
					</button>
				</Tooltip>
			</div>
		);
	}

	return (
		<div className="plan-list">
			<div className="plan-list-chrome">
				<div className="plan-list-toolbar">
					<Tooltip content="Collapse sidebar · b" side="right">
						<button
							className="sidebar-toggle"
							onClick={onToggle}
							aria-label="Collapse sidebar"
						>
							<PanelLeftClose size={16} />
						</button>
					</Tooltip>
					<div className="plan-list-search">
						<Search
							size={14}
							className="plan-list-search-icon"
							aria-hidden="true"
						/>
						<input
							type="text"
							placeholder="Search mockups…"
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
							className="plan-list-search-input"
							aria-label="Search mockups"
						/>
					</div>
				</div>
				<div
					className="plan-list-filters"
					role="group"
					aria-label="Filter by decision"
				>
					{(
						[
							{ id: "all" as const, label: "All" },
							{
								id: "pending" as const,
								label: pendingCount ? `Pending ${pendingCount}` : "Pending",
							},
							{ id: "approved" as const, label: "Approved" },
							{ id: "changes-requested" as const, label: "Changes" },
							{ id: "rejected" as const, label: "Rejected" },
						] as const
					).map((chip) => (
						<button
							key={chip.id}
							type="button"
							className={`plan-list-filter ${decisionFilter === chip.id ? "is-active" : ""}`}
							aria-pressed={decisionFilter === chip.id}
							onClick={() => setDecisionFilter(chip.id)}
						>
							{chip.label}
						</button>
					))}
				</div>
			</div>
			<div className="plan-list-scroll">
				<div className="plan-list-header">
					<span>
						{filtered.length === mockups.length
							? `${mockups.length} mockup${mockups.length === 1 ? "" : "s"}`
							: `${filtered.length} of ${mockups.length}`}
					</span>
				</div>
				{filtered.length === 0 && (
					<div className="plan-list-empty">
						{filter || decisionFilter !== "all"
							? "No matching mockups."
							: "No mockups yet."}
					</div>
				)}
				<div className="plan-list-items">
					{filtered.map((m) => {
						const meta = DECISION_META[m.decision];
						const Icon = meta.icon;
						const open = m.commentCounts.open;
						return (
							<div
								key={m.id}
								className={`plan-list-item ${m.id === activeId ? "plan-list-item-active" : ""}`}
								onClick={() => onSelect(m.id)}
								role="button"
								tabIndex={0}
								aria-current={m.id === activeId ? "true" : undefined}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										onSelect(m.id);
									}
								}}
							>
								<div className="plan-list-item-top">
									<span
										className={`plan-badge plan-badge-dot ${meta.className}`}
										title={meta.label}
									>
										<Icon size={11} aria-hidden="true" />
									</span>
									<span className="plan-list-item-title" title={m.title}>
										{m.title}
									</span>
									<button
										className="plan-list-delete"
										title="Delete mockup"
										aria-label="Delete mockup"
										onClick={(e) => {
											e.stopPropagation();
											setToDelete(m);
										}}
									>
										<Trash2 size={12} />
									</button>
								</div>
								<div className="plan-list-item-sub">
									{m.screens.length} screen{m.screens.length === 1 ? "" : "s"}
									{open > 0 ? ` · ${open} open` : ""}
									{m.model ? ` · ${m.model}` : ""}
									{" · "}
									{timeAgo(m.updatedAt)}
								</div>
							</div>
						);
					})}
				</div>
			</div>
			<ConfirmDialog
				open={!!toDelete}
				title="Delete mockup?"
				description={toDelete?.title}
				confirmLabel="Delete"
				onCancel={() => setToDelete(null)}
				onConfirm={() => {
					if (toDelete) onDelete(toDelete.id);
					setToDelete(null);
				}}
			/>
		</div>
	);
}
