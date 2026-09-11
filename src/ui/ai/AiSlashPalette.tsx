import { useEffect, useRef } from "react";
import type { RailQuickAction } from "./railHelpers";

export interface AiSlashPaletteProps {
	items: RailQuickAction[];
	focusedIndex: number;
	query: string;
	onSelect: (item: RailQuickAction) => void;
	onHover: (index: number) => void;
}

export function AiSlashPalette({
	items,
	focusedIndex,
	query,
	onSelect,
	onHover,
}: AiSlashPaletteProps) {
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const list = listRef.current;
		const el = list?.querySelector<HTMLElement>('[data-focused="true"]');
		if (!list || !el) return;
		const item = el.getBoundingClientRect();
		const viewport = list.getBoundingClientRect();
		if (item.top < viewport.top) list.scrollTop += item.top - viewport.top;
		else if (item.bottom > viewport.bottom)
			list.scrollTop += item.bottom - viewport.bottom;
	}, [focusedIndex, items]);

	if (items.length === 0) return null;

	const needle = query.trim().toLowerCase();

	return (
		<div
			className="mention-dropdown ai-slash-palette"
			ref={listRef}
			role="listbox"
			aria-label="AI actions"
		>
			{items.map((item, index) => {
				const Icon = item.icon;
				const focused = index === focusedIndex;
				const label = item.label;
				const matchAt = needle ? label.toLowerCase().indexOf(needle) : -1;
				return (
					<div
						key={item.action}
						role="option"
						aria-selected={focused}
						aria-label={item.label}
						data-focused={focused}
						className={`mention-item ${focused ? "mention-item-focused" : ""}`}
						onMouseDown={(event) => {
							event.preventDefault();
							onSelect(item);
						}}
						onMouseEnter={() => onHover(index)}
					>
						<span className="mention-icon">
							<Icon size={13} />
						</span>
						<div className="mention-info">
							<span className="mention-name">
								{matchAt >= 0 ? (
									<>
										{label.slice(0, matchAt)}
										<mark className="mention-highlight">
											{label.slice(matchAt, matchAt + needle.length)}
										</mark>
										{label.slice(matchAt + needle.length)}
									</>
								) : (
									label
								)}
							</span>
							<span className="mention-dir">{item.hint}</span>
						</div>
					</div>
				);
			})}
		</div>
	);
}
