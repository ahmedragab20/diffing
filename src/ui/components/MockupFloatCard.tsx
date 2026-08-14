import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { GripVertical, MessageSquare, Minus, X } from "lucide-react";
import { clampPanelRect, type ResizeEdge } from "./PlanFloatComposers";

export const MOCKUP_FLOAT_WIDTH = 340;
export const MOCKUP_FLOAT_HEIGHT = 420;

const PANEL_MIN_WIDTH = 300;
const PANEL_MIN_HEIGHT = 240;
const RESIZE_EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

interface MockupFloatCardProps {
	/** Anchor in % of the frame box (0–100). */
	anchor: { x: number; y: number };
	frameRef: React.RefObject<HTMLDivElement | null>;
	title: ReactNode;
	onClose: () => void;
	children: ReactNode;
	className?: string;
	width?: number;
	height?: number;
}

function isEditableTarget(el: EventTarget | null): boolean {
	if (!(el instanceof HTMLElement)) return false;
	return !!el.closest("input, textarea, select, [contenteditable='true']");
}

/**
 * Anchored mockup thread/composer with the same window controls as the plan
 * composer: drag, eight-edge resize, minimize to the shared bottom tray,
 * restore, close, Escape, and viewport clamping.
 */
export function MockupFloatCard({
	anchor,
	frameRef,
	title,
	onClose,
	children,
	className,
	width = MOCKUP_FLOAT_WIDTH,
	height = MOCKUP_FLOAT_HEIGHT,
}: MockupFloatCardProps) {
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
	const [size, setSize] = useState({ width, height });
	const [minimized, setMinimized] = useState(false);
	const sizeRef = useRef(size);
	sizeRef.current = size;
	const posRef = useRef(pos);
	posRef.current = pos;
	const dragRef = useRef<{
		startX: number;
		startY: number;
		origLeft: number;
		origTop: number;
	} | null>(null);
	const resizeRef = useRef<{
		edge: ResizeEdge;
		startX: number;
		startY: number;
		origLeft: number;
		origTop: number;
		origWidth: number;
		origHeight: number;
	} | null>(null);

	const computeRect = useCallback(
		(panelSize: { width: number; height: number }) => {
			const frame = frameRef.current;
			if (!frame || typeof window === "undefined") return null;
			const frameRect = frame.getBoundingClientRect();
			if (frameRect.width <= 0 || frameRect.height <= 0) return null;
			const anchorX = (anchor.x / 100) * frameRect.width;
			const anchorY = (anchor.y / 100) * frameRect.height;
			const flip = anchor.x > 62;
			const left = flip
				? frameRect.left + anchorX - panelSize.width - 16
				: frameRect.left + anchorX + 16;
			const top = frameRect.top + anchorY;
			return clampPanelRect(left, top, panelSize.width, panelSize.height);
		},
		[anchor.x, anchor.y, frameRef],
	);

	useEffect(() => {
		const next = computeRect(sizeRef.current);
		setPos(next ? { left: next.left, top: next.top } : null);
	}, [computeRect]);

	useEffect(() => {
		setSize({ width, height });
	}, [width, height]);

	useEffect(() => {
		const onResize = () => {
			const current = posRef.current;
			if (!current) {
				const next = computeRect(sizeRef.current);
				if (next) setPos({ left: next.left, top: next.top });
				return;
			}
			const next = clampPanelRect(
				current.left,
				current.top,
				sizeRef.current.width,
				sizeRef.current.height,
			);
			setSize({ width: next.width, height: next.height });
			setPos({ left: next.left, top: next.top });
		};
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [computeRect]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || minimized) return;
			if (isEditableTarget(event.target)) return;
			event.preventDefault();
			event.stopPropagation();
			onClose();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [minimized, onClose]);

	const onDragStart = useCallback(
		(event: React.MouseEvent) => {
			if (
				minimized ||
				(event.target as HTMLElement).closest(
					"button, input, textarea, select, a, .plan-float-resize",
				)
			) {
				return;
			}
			if (!pos) return;
			event.preventDefault();
			dragRef.current = {
				startX: event.clientX,
				startY: event.clientY,
				origLeft: pos.left,
				origTop: pos.top,
			};
			const onMove = (moveEvent: MouseEvent) => {
				const drag = dragRef.current;
				if (!drag) return;
				const next = clampPanelRect(
					drag.origLeft + (moveEvent.clientX - drag.startX),
					drag.origTop + (moveEvent.clientY - drag.startY),
					sizeRef.current.width,
					sizeRef.current.height,
				);
				setPos({ left: next.left, top: next.top });
			};
			const onUp = () => {
				dragRef.current = null;
				window.removeEventListener("mousemove", onMove);
				window.removeEventListener("mouseup", onUp);
			};
			window.addEventListener("mousemove", onMove);
			window.addEventListener("mouseup", onUp);
		},
		[minimized, pos],
	);

	const onResizeStart = useCallback(
		(edge: ResizeEdge, event: React.MouseEvent) => {
			if (!pos || minimized) return;
			event.preventDefault();
			event.stopPropagation();
			resizeRef.current = {
				edge,
				startX: event.clientX,
				startY: event.clientY,
				origLeft: pos.left,
				origTop: pos.top,
				origWidth: sizeRef.current.width,
				origHeight: sizeRef.current.height,
			};
			const onMove = (moveEvent: MouseEvent) => {
				const resize = resizeRef.current;
				if (!resize) return;
				const dx = moveEvent.clientX - resize.startX;
				const dy = moveEvent.clientY - resize.startY;
				let left = resize.origLeft;
				let top = resize.origTop;
				let nextWidth = resize.origWidth;
				let nextHeight = resize.origHeight;

				if (resize.edge.includes("e")) nextWidth = resize.origWidth + dx;
				if (resize.edge.includes("s")) nextHeight = resize.origHeight + dy;
				if (resize.edge.includes("w")) {
					nextWidth = resize.origWidth - dx;
					left = resize.origLeft + dx;
				}
				if (resize.edge.includes("n")) {
					nextHeight = resize.origHeight - dy;
					top = resize.origTop + dy;
				}
				if (nextWidth < PANEL_MIN_WIDTH) {
					if (resize.edge.includes("w")) {
						left = resize.origLeft + resize.origWidth - PANEL_MIN_WIDTH;
					}
					nextWidth = PANEL_MIN_WIDTH;
				}
				if (nextHeight < PANEL_MIN_HEIGHT) {
					if (resize.edge.includes("n")) {
						top = resize.origTop + resize.origHeight - PANEL_MIN_HEIGHT;
					}
					nextHeight = PANEL_MIN_HEIGHT;
				}

				const next = clampPanelRect(left, top, nextWidth, nextHeight);
				setPos({ left: next.left, top: next.top });
				setSize({ width: next.width, height: next.height });
			};
			const onUp = () => {
				resizeRef.current = null;
				window.removeEventListener("mousemove", onMove);
				window.removeEventListener("mouseup", onUp);
			};
			window.addEventListener("mousemove", onMove);
			window.addEventListener("mouseup", onUp);
		},
		[minimized, pos],
	);

	if (typeof document === "undefined") return null;

	const titleText = typeof title === "string" ? title : "Comment";
	const layer = minimized ? (
		<div
			className="plan-float-tray mockup-float-tray"
			role="toolbar"
			aria-label="Minimized mockup comments"
		>
			<div className="plan-float-tray-chip-wrap">
				<button
					type="button"
					className="plan-float-tray-chip"
					title={`Restore ${titleText}`}
					onClick={() => setMinimized(false)}
				>
					<MessageSquare size={12} aria-hidden="true" />
					<span>{titleText}</span>
				</button>
				<button
					type="button"
					className="plan-float-tray-close"
					aria-label={`Close ${titleText}`}
					title="Close"
					onClick={onClose}
				>
					<X size={12} />
				</button>
			</div>
		</div>
	) : (
		<div
			className={`plan-selection-comment plan-selection-comment-floating mockup-float-card ${className ?? ""}`}
			role="dialog"
			aria-label={titleText}
			style={{
				left: pos?.left ?? 0,
				top: pos?.top ?? 0,
				width: size.width,
				height: size.height,
				zIndex: 130,
				visibility: pos ? "visible" : "hidden",
			}}
		>
			{RESIZE_EDGES.map((edge) => (
				<div
					key={edge}
					className={`plan-float-resize plan-float-resize-${edge}`}
					onMouseDown={(event) => onResizeStart(edge, event)}
					aria-hidden="true"
				/>
			))}
			<div
				className="plan-selection-comment-drag"
				onMouseDown={onDragStart}
				title="Drag to move"
			>
				<GripVertical size={14} aria-hidden="true" />
				<span className="plan-selection-comment-meta mockup-float-title">
					{title}
				</span>
				<button
					type="button"
					className="plan-selection-comment-close"
					aria-label="Minimize"
					title="Minimize"
					onClick={() => setMinimized(true)}
				>
					<Minus size={14} />
				</button>
				<button
					type="button"
					className="plan-selection-comment-close"
					aria-label="Close"
					title="Close (Esc)"
					onClick={onClose}
				>
					<X size={14} />
				</button>
			</div>
			<div className="plan-selection-comment-body mockup-float-body">
				{children}
			</div>
		</div>
	);

	return createPortal(layer, document.body);
}
