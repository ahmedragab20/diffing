import { useState } from "react";
import {
	Check,
	MessageSquareWarning,
	X,
	ClipboardCheck,
	RefreshCw,
	MessageSquare,
} from "lucide-react";
import type { PlanDecision, PlanMode } from "../../lib/plan-types";
import { useFeedback } from "../hooks/useHaptics";
import {
	useSubmitPanelSize,
	SUBMIT_PANEL_PRESETS,
} from "../hooks/useSubmitPanelSize";
import { Popover } from "../primitives/Popover";
import { MarkdownField } from "./MarkdownField";

interface SubmitPlanReviewPopoverProps {
	openCommentCount: number;
	onSubmit: (
		decision: PlanDecision,
		comment?: string,
		mode?: PlanMode,
	) => Promise<unknown>;
	submitting: boolean;
	agentWaiting: boolean;
	/** The plan's current verdict, so an already-decided plan reads as re-deciding. */
	currentDecision: PlanDecision;
	/** Surface noun for wording: "plan review" (default) or "mockup review". */
	kind?: "plan" | "mockup";
	/** Open comments in the current scoped view (mockup: version+screen+viewport). */
	scopedOpenCount?: number;
}

type Verdict = Exclude<PlanDecision, "pending">;

const OPTIONS: {
	value: Verdict;
	label: string;
	description: (noun: string) => string;
	icon: typeof Check;
	className: string;
}[] = [
	{
		value: "approved",
		label: "Approve",
		description: (noun) => `The ${noun} looks good — the agent should proceed.`,
		icon: Check,
		className: "plan-verdict-approve",
	},
	{
		value: "changes-requested",
		label: "Request changes",
		description: (noun) =>
			`The agent should revise the ${noun} and resubmit it.`,
		icon: MessageSquareWarning,
		className: "plan-verdict-changes",
	},
	{
		value: "rejected",
		label: "Reject",
		description: () => "Don't proceed — the approach needs rethinking.",
		icon: X,
		className: "plan-verdict-reject",
	},
	{
		value: "comment-only",
		label: "Comment only",
		description: () =>
			"Agent must NOT edit files — only reply to comments. General note goes to chat.",
		icon: MessageSquare,
		className: "plan-verdict-comment-only",
	},
];

/**
 * GitHub-style "submit your review" for a plan or mockup. Pick a verdict
 * (approve / request changes / reject), optionally add an overall note, and
 * submit — which both records the decision and releases the waiting agent.
 * Mockup mode (kind="mockup") rewords the panel and reports scoped vs total
 * open counts; every new prop is optional so plan usage is unchanged.
 */
export function SubmitPlanReviewPopover({
	openCommentCount,
	onSubmit,
	submitting,
	agentWaiting,
	currentDecision,
	kind = "plan",
	scopedOpenCount,
}: SubmitPlanReviewPopoverProps) {
	const noun = kind === "mockup" ? "mockup" : "plan";
	const { haptic, sound } = useFeedback();
	const [open, setOpen] = useState(false);
	const [verdict, setVerdict] = useState<Verdict | null>(null);
	const [comment, setComment] = useState("");
	const {
		popoverStyle,
		activePreset,
		applyPreset,
		startResize,
		startLeftResize,
		startCornerResize,
		handleOpenChange,
		panelRef,
	} = useSubmitPanelSize();

	const handleSubmit = async () => {
		if (!verdict) return;
		haptic("heavy");
		sound("send");
		const mode: PlanMode =
			verdict === "comment-only" ? "comment-only" : "standard";
		await onSubmit(verdict, comment, mode);
		setComment("");
		setVerdict(null);
		setOpen(false);
	};

	const alreadyDecided = currentDecision !== "pending";

	return (
		<Popover
			open={open}
			onOpenChange={(next, details) => handleOpenChange(next, details, setOpen)}
			ariaLabel="Submit review"
			className="submit-plan-review-popover"
			trigger={
				<button
					className="btn btn-primary btn-sm send-review-btn"
					disabled={submitting}
					title={
						agentWaiting
							? "An agent is connected and waiting for your verdict"
							: `Submit your verdict on this ${noun}`
					}
					style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
				>
					{agentWaiting && (
						<span className="agent-waiting-dot" aria-hidden="true" />
					)}
					{alreadyDecided ? (
						<RefreshCw size={14} />
					) : (
						<ClipboardCheck size={14} />
					)}
					<span className="btn-label">
						{submitting
							? "Submitting…"
							: alreadyDecided
								? "Update review"
								: "Submit review"}
					</span>
				</button>
			}
		>
			<div
				className={`srp ${kind === "mockup" ? "srp-mockup" : ""}`}
				ref={panelRef}
				style={popoverStyle}
			>
				<div
					className="srp-resize-handle-left"
					onPointerDown={startLeftResize}
					role="separator"
					aria-orientation="vertical"
					aria-label="Resize submit panel width"
					tabIndex={0}
				/>
				<div className="srp-head">
					{alreadyDecided ? (
						<RefreshCw size={15} aria-hidden="true" />
					) : (
						<ClipboardCheck size={15} aria-hidden="true" />
					)}
					<span className="srp-title">
						{alreadyDecided ? `Update ${noun} review` : `Submit ${noun} review`}
					</span>
					<div
						className="srp-size-presets"
						role="group"
						aria-label="Panel size"
					>
						{SUBMIT_PANEL_PRESETS.map((p, i) => (
							<button
								key={p.label}
								className="srp-preset-btn"
								role="radio"
								aria-checked={activePreset === i}
								aria-pressed={activePreset === i}
								onClick={() => applyPreset(p)}
								title={`${p.width}×${p.height}px`}
							>
								{p.label}
							</button>
						))}
					</div>
					{openCommentCount > 0 && (
						<span
							className="srp-count"
							title={
								scopedOpenCount !== undefined
									? `${openCommentCount} open total`
									: undefined
							}
						>
							{scopedOpenCount !== undefined
								? `${scopedOpenCount} open in view · ${openCommentCount} open total`
								: `${openCommentCount} open comment${openCommentCount === 1 ? "" : "s"}`}
						</span>
					)}
				</div>

				<div className="srp-scroll">
					<div
						className="plan-verdict-options"
						role="radiogroup"
						aria-label="Verdict"
					>
						{OPTIONS.map((opt) => {
							const Icon = opt.icon;
							const selected = verdict === opt.value;
							return (
								<button
									key={opt.value}
									type="button"
									role="radio"
									aria-checked={selected}
									className={`plan-verdict-option ${opt.className} ${selected ? "plan-verdict-option-selected" : ""}`}
									onClick={() => setVerdict(opt.value)}
								>
									<span className="plan-verdict-icon">
										<Icon size={15} aria-hidden="true" />
									</span>
									<span className="plan-verdict-text">
										<span className="plan-verdict-label">{opt.label}</span>
										<span className="plan-verdict-desc">
											{opt.description(noun)}
										</span>
									</span>
									<span className="plan-verdict-radio" aria-hidden="true" />
								</button>
							);
						})}
					</div>

					<div className="srp-general">
						<label
							className="srp-general-label"
							htmlFor="plan-decision-comment"
						>
							Overall comment{" "}
							<span className="srp-optional">(optional · Markdown)</span>
						</label>
						<MarkdownField
							id="plan-decision-comment"
							value={comment}
							onChange={setComment}
							textareaClassName="srp-general-input"
							placeholder={`Add an overall note for the agent that applies to the whole ${noun}…`}
							rows={3}
							ariaLabel={`Overall ${noun} review comment`}
							onSubmitShortcut={handleSubmit}
						/>
					</div>
				</div>

				<div className="srp-footer">
					<button
						className="btn btn-sm"
						onClick={() => setOpen(false)}
						disabled={submitting}
					>
						Cancel
					</button>
					<button
						className="btn btn-primary btn-sm"
						onClick={handleSubmit}
						disabled={!verdict || submitting}
					>
						{submitting ? "Submitting…" : "Submit review"}
					</button>
				</div>
				<div
					className="srp-resize-handle"
					onPointerDown={startResize}
					role="separator"
					aria-orientation="horizontal"
					aria-label="Resize submit panel"
					tabIndex={0}
				/>
				<div
					className="srp-resize-handle-corner"
					onPointerDown={startCornerResize}
					role="separator"
					aria-label="Resize submit panel width and height"
					tabIndex={0}
				/>
			</div>
		</Popover>
	);
}
