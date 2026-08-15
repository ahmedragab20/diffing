import { useState } from "react";
import { Check, Palette, Plus } from "lucide-react";
import { useDesignSystem } from "../hooks/useDesignSystem";
import { Tooltip } from "../primitives/Tooltip";

export function DesignSystemPanel() {
	const {
		active,
		isLoading,
		extract,
		publish,
		save,
		addComment,
		resolveComment,
	} = useDesignSystem();
	const [guidelines, setGuidelines] = useState<string | null>(null);
	const [commentBody, setCommentBody] = useState("");
	const draftGuidelines = guidelines ?? active?.guidelines ?? "";
	const colors = Object.entries(active?.tokens?.color ?? {});
	const fonts = Object.entries(active?.tokens?.font ?? {});
	const components = active?.components ?? [];
	const openComments = (active?.comments ?? []).filter((c) => c.status === "open");
	const extractError = extract.error
		? "Extract needs a running server with the design-system API. Restart diffing, then try again."
		: null;

	if (isLoading) {
		return <div className="design-system-panel">Loading design system…</div>;
	}

	return (
		<div className="design-system-panel">
			<header className="design-system-header">
				<div>
					<h2>Design system</h2>
					<p className="design-system-meta">
						{active
							? `${active.title} · ${active.status} · rev ${active.revision}`
							: "No system yet — extract from this repo or write tokens."}
					</p>
				</div>
				<div className="design-system-actions">
					{extractError && (
						<p className="design-system-empty" role="alert">
							{extractError}
						</p>
					)}
					<button
						type="button"
						className="btn btn-sm"
						onClick={() => extract.mutate()}
						disabled={extract.isPending}
					>
						Extract from repo
					</button>
					<button
						type="button"
						className="btn btn-sm btn-primary"
						onClick={() => publish.mutate()}
						disabled={!active || publish.isPending}
					>
						<Check size={13} />
						Publish
					</button>
				</div>
			</header>

			<section className="design-system-section">
				<h3>Color</h3>
				{colors.length === 0 ? (
					<p className="design-system-empty">No colors yet.</p>
				) : (
					<div className="design-system-swatches">
						{colors.map(([name, value]) => (
							<div key={name} className="design-system-swatch">
								<span
									className="design-system-chip"
									style={{ background: value }}
									title={value}
								/>
								<div className="design-system-swatch-meta">
									<code className="design-system-swatch-name">{name}</code>
									<span className="design-system-swatch-value">{value}</span>
								</div>
							</div>
						))}
					</div>
				)}
			</section>

			<section className="design-system-section">
				<h3>Type</h3>
				{fonts.length === 0 ? (
					<p className="design-system-empty">No fonts yet.</p>
				) : (
					<ul className="design-system-fonts">
						{fonts.map(([name, value]) => (
							<li key={name}>
								<code>{name}</code> {value}
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="design-system-section">
				<h3>Components</h3>
				{components.length === 0 ? (
					<p className="design-system-empty">
						No snippets yet. Promote a block from a mockup or add one from an agent propose.
					</p>
				) : (
					<div className="design-system-components">
						{components.map((component) => (
							<figure key={component.id} className="design-system-component">
								<figcaption>
									<code>{component.id}</code> {component.label}
								</figcaption>
								<iframe
									title={component.label}
									sandbox="allow-same-origin"
									srcDoc={component.html}
								/>
							</figure>
						))}
					</div>
				)}
			</section>

			<section className="design-system-section">
				<h3>Guidelines</h3>
				<textarea
					className="design-system-guidelines"
					value={draftGuidelines}
					onChange={(e) => setGuidelines(e.target.value)}
					placeholder="Voice, density, do/don't…"
					rows={6}
				/>
				<button
					type="button"
					className="btn btn-sm"
					disabled={save.isPending || draftGuidelines === (active?.guidelines ?? "")}
					onClick={() => save.mutate({ guidelines: draftGuidelines })}
				>
					Save guidelines
				</button>
			</section>

			<section className="design-system-section">
				<h3>Request a change</h3>
				<form
					className="design-system-comment-form"
					onSubmit={(e) => {
						e.preventDefault();
						if (!commentBody.trim()) return;
						addComment.mutate({ kind: "general", body: commentBody.trim() });
						setCommentBody("");
					}}
				>
					<textarea
						value={commentBody}
						onChange={(e) => setCommentBody(e.target.value)}
						placeholder="Ask the agent to add a token, tweak density, promote a component…"
						rows={3}
					/>
					<button type="submit" className="btn btn-sm" disabled={!commentBody.trim()}>
						<Plus size={13} />
						Add request
					</button>
				</form>
				{openComments.map((comment) => (
					<div key={comment.id} className="design-system-comment">
						<p>{comment.body}</p>
						<Tooltip content="Mark resolved">
							<button
								type="button"
								className="btn btn-sm"
								onClick={() => resolveComment.mutate(comment.id)}
							>
								Resolve
							</button>
						</Tooltip>
					</div>
				))}
			</section>
		</div>
	);
}

export function DesignSystemNavIcon() {
	return <Palette size={13} />;
}
