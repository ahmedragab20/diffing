import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ArrowLeft,
	Bot,
	Eye,
	History,
	LayoutTemplate,
	Maximize2,
	Menu,
	Minimize2,
	Monitor,
	MousePointer2,
	Palette,
	Settings,
	Smartphone,
	SquareDashed,
	Tablet,
} from "lucide-react";
import type { CommentSeverity } from "../../lib/types";
import type {
	MockupAnchorKind,
	MockupComment,
	MockupViewport,
} from "../../lib/mockup-types";
import { commentViewport } from "../../lib/mockup-types";
import { useRoutePath, navigate } from "../router";
import { timeAgo } from "../utils";
import { useMockups } from "../hooks/useMockups";
import { useSettings } from "../hooks/useSettings";
import { useApplyFonts } from "../hooks/useApplyFonts";
import { usePlanCommentsSheet } from "../hooks/usePlanLayoutMedia";
import { HapticsProvider } from "../hooks/useHaptics";
import { getUiStateItem, setUiStateItem } from "../utils/uiState";
import { BrandMark } from "./BrandMark";
import { SubmitPlanReviewPopover } from "./SubmitPlanReviewPopover";
import { ThemeModal } from "./ThemeModal";
import { Tooltip } from "../primitives/Tooltip";
import { Popover } from "../primitives/Popover";
import { Select } from "../primitives/Select";
import { MockupList } from "./MockupList";
import { MockupCanvas, type ProbeHit } from "./MockupCanvas";
import { MockupCommentsRail } from "./MockupCommentsRail";
import { MockupScreenTabs } from "./MockupScreenTabs";
import {
	DECISION_META,
	VIEWPORT_LABEL,
	VIEWPORT_OPTIONS,
	VIEWPORT_PX,
	type ViewportPx,
} from "./MockupAnchors";

const COMMENTS_RAIL_KEY = "diffing-mockup-comments-rail";
const VIEW_ONLY_KEY = "diffing-mockup-view-only";
const ZEN_KEY = "diffing-mockup-zen";

type Tool = MockupAnchorKind;

const TOOL_OPTIONS: {
	id: Tool;
	label: string;
	icon: typeof SquareDashed;
	tip: string;
	key: string;
}[] = [
	{
		id: "section",
		label: "Section",
		icon: SquareDashed,
		tip: "Section — click a tagged region",
		key: "1",
	},
	{
		id: "block",
		label: "Block",
		icon: MousePointer2,
		tip: "Block — click any element",
		key: "2",
	},
	{
		id: "point",
		label: "Pin",
		icon: LayoutTemplate,
		tip: "Pin — drop a point comment",
		key: "3",
	},
];

export function MockupReviewApp() {
	const { settings, loaded, updateSettings } = useSettings();
	useApplyFonts(loaded, settings.uiFont, settings.monoFont);
	const path = useRoutePath();
	const routeId = useMemo(() => {
		const m = /^\/mockup\/([^/?]+)/.exec(path);
		return m ? decodeURIComponent(m[1]) : null;
	}, [path]);
	const {
		mockups,
		activeMockup,
		addComment,
		updateComment,
		removeComment,
		addReply,
		updateReply,
		removeReply,
		submitDecision,
		submitting,
		removeMockup,
		agentWaiting,
		isLoading,
	} = useMockups(routeId);
	const active = activeMockup;
	const defaultId = useMemo(() => {
		if (mockups.length === 0) return null;
		return (
			[...mockups].reverse().find((mockup) => mockup.decision === "pending")?.id ??
			mockups[mockups.length - 1].id
		);
	}, [mockups]);

	useEffect(() => {
		if (!routeId && defaultId)
			navigate(`/mockup/${defaultId}`, { replace: true });
	}, [routeId, defaultId]);

	const [themeModalOpen, setThemeModalOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
		try {
			const stored = getUiStateItem("diffing-sidebar-collapsed");
			if (stored != null) return stored === "true";
		} catch {
			/* ignore */
		}
		return typeof window !== "undefined" && window.innerWidth <= 768;
	});
	const [sidebarWidth, setSidebarWidth] = useState(() => {
		try {
			const stored = getUiStateItem("diffing-sidebar-width");
			return stored ? Number(stored) : 320;
		} catch {
			return 320;
		}
	});
	const [commentsRailOpen, setCommentsRailOpen] = useState(() => {
		try {
			const stored = getUiStateItem(COMMENTS_RAIL_KEY);
			if (stored != null) return stored === "true";
		} catch {
			/* ignore */
		}
		return true;
	});
	const [viewOnly, setViewOnly] = useState(() => {
		try {
			const stored = getUiStateItem(VIEW_ONLY_KEY);
			if (stored != null) return stored === "true";
		} catch {
			/* ignore */
		}
		return false;
	});
	const [zen, setZen] = useState(() => {
		try {
			const stored = getUiStateItem(ZEN_KEY);
			if (stored != null) return stored === "true";
		} catch {
			/* ignore */
		}
		return false;
	});
	const [tool, setTool] = useState<Tool>("block");
	const [viewport, setViewport] = useState<ViewportPx>(1280);
	const [screenId, setScreenId] = useState<string | null>(null);
	const [viewVersion, setViewVersion] = useState<number | null>(null);
	const [srcdoc, setSrcdoc] = useState("");
	const [hover, setHover] = useState<ProbeHit | null>(null);
	const [pending, setPending] = useState<ProbeHit | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);
	const [zenReveal, setZenReveal] = useState<
		"toolbar" | "sidebar" | "rail" | null
	>(null);
	const [probeReady, setProbeReady] = useState(false);
	const [staleIds, setStaleIds] = useState<Set<string>>(new Set());
	const [sections, setSections] = useState<
		{ name: string; rect: { x: number; y: number; w: number; h: number } }[]
	>([]);
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const frameRef = useRef<HTMLDivElement>(null);
	const appRef = useRef<HTMLDivElement>(null);
	const toolbarRef = useRef<HTMLDivElement>(null);
	const sidebarRef = useRef<HTMLElement>(null);
	const sidebarGuideRef = useRef<HTMLDivElement>(null);
	const sidebarWidthRef = useRef(sidebarWidth);
	sidebarWidthRef.current = sidebarWidth;
	/**
	 * Nonce + doc identity of the document currently served to the iframe
	 * (X-Diffing-Mockup-Nonce). Posted events must match both so stale frames
	 * (older screen/version/viewport or a different mockup) are ignored.
	 */
	const docNonceRef = useRef<{ nonce: string; docKey: string } | null>(null);
	/** Comment id to select once the scope settles (prior-version history jump). */
	const pendingSelectRef = useRef<string | null>(null);

	const viewportLabel: MockupViewport = VIEWPORT_LABEL[viewport];

	useEffect(() => {
		try {
			setUiStateItem("diffing-sidebar-collapsed", String(sidebarCollapsed));
		} catch {
			/* ignore */
		}
	}, [sidebarCollapsed]);

	useEffect(() => {
		try {
			setUiStateItem(COMMENTS_RAIL_KEY, String(commentsRailOpen));
		} catch {
			/* ignore */
		}
	}, [commentsRailOpen]);

	useEffect(() => {
		try {
			setUiStateItem(VIEW_ONLY_KEY, String(viewOnly));
		} catch {
			/* ignore */
		}
	}, [viewOnly]);

	useEffect(() => {
		try {
			setUiStateItem(ZEN_KEY, String(zen));
		} catch {
			/* ignore */
		}
	}, [zen]);

	const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		const startX = e.clientX;
		const startWidth = sidebarWidthRef.current;
		const sidebarEl = sidebarRef.current;
		const guideEl = sidebarGuideRef.current;
		const sidebarLeft = sidebarEl ? sidebarEl.getBoundingClientRect().left : 0;
		let latestWidth = startWidth;
		let rafId = 0;
		const flush = () => {
			rafId = 0;
			if (guideEl)
				guideEl.style.transform = `translateX(${sidebarLeft + latestWidth}px)`;
		};
		if (guideEl) {
			guideEl.style.transform = `translateX(${sidebarLeft + startWidth}px)`;
			guideEl.classList.add("sidebar-resize-guide-active");
		}
		const handleMove = (ev: MouseEvent) => {
			latestWidth = Math.max(
				240,
				Math.min(640, startWidth + (ev.clientX - startX)),
			);
			if (!rafId) rafId = requestAnimationFrame(flush);
		};
		const handleUp = () => {
			if (rafId) cancelAnimationFrame(rafId);
			if (guideEl) guideEl.classList.remove("sidebar-resize-guide-active");
			setSidebarWidth(latestWidth);
			try {
				setUiStateItem("diffing-sidebar-width", String(latestWidth));
			} catch {
				/* ignore */
			}
			document.removeEventListener("mousemove", handleMove);
			document.removeEventListener("mouseup", handleUp);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};
		document.addEventListener("mousemove", handleMove);
		document.addEventListener("mouseup", handleUp);
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
	}, []);

	const screens = useMemo(() => {
		if (!active) return [];
		if (viewVersion && viewVersion !== active.version) {
			return (
				active.versions.find((v) => v.version === viewVersion)?.screens ??
				active.screens
			);
		}
		return active.screens;
	}, [active, viewVersion]);

	const currentScreenId =
		screenId && screens.some((s) => s.id === screenId)
			? screenId
			: (screens[0]?.id ?? null);
	const viewingVersion = viewVersion ?? active?.version ?? 1;
	const historical = Boolean(
		active && viewVersion && viewVersion !== active.version,
	);
	const decision = active ? DECISION_META[active.decision] : null;
	const DecisionIcon = decision?.icon ?? DECISION_META.pending.icon;

	/**
	 * Comment scope = version + screen + viewport. Only comments anchored at
	 * the exact version/viewport being viewed are pinned on the canvas.
	 */
	const comments = useMemo(() => {
		if (!active) return [];
		return (active.comments ?? [])
			.filter(
				(c) =>
					c.screenId === currentScreenId &&
					c.createdAtMockupVersion === viewingVersion &&
					commentViewport(c) === viewportLabel,
			)
			.sort((a, b) => a.createdAt - b.createdAt);
	}, [active, currentScreenId, viewingVersion, viewportLabel]);

	/** Open comments from older versions (same screen + viewport) — never pinned. */
	const priorVersionOpen = useMemo(() => {
		if (!active) return [];
		return (active.comments ?? [])
			.filter(
				(c) =>
					c.screenId === currentScreenId &&
					c.status === "open" &&
					c.createdAtMockupVersion < viewingVersion &&
					commentViewport(c) === viewportLabel,
			)
			.sort((a, b) => b.createdAt - a.createdAt);
	}, [active, currentScreenId, viewingVersion, viewportLabel]);

	/**
	 * Open comments from the *other two* viewports on the current screen +
	 * version — reachable from the rail but never pinned on this canvas. Order
	 * is canonical (desktop → tablet → mobile), then chronological.
	 */
	const otherViewportOpen = useMemo(() => {
		if (!active) return [];
		const order: Record<MockupViewport, number> = {
			desktop: 0,
			tablet: 1,
			mobile: 2,
		};
		return (active.comments ?? [])
			.filter(
				(c) =>
					c.screenId === currentScreenId &&
					c.status === "open" &&
					c.createdAtMockupVersion === viewingVersion &&
					commentViewport(c) !== viewportLabel,
			)
			.sort(
				(a, b) =>
					order[commentViewport(a)] - order[commentViewport(b)] ||
					a.createdAt - b.createdAt,
			);
	}, [active, currentScreenId, viewingVersion, viewportLabel]);

	const scopedOpenCount = comments.filter((c) => c.status === "open").length;
	const totalOpenCount = (active?.comments ?? []).filter(
		(c) => c.status === "open",
	).length;

	const screenOpenCounts = useMemo(() => {
		const out: Record<string, number> = {};
		if (!active) return out;
		for (const s of screens) {
			out[s.id] = (active.comments ?? []).filter(
				(c) =>
					c.screenId === s.id &&
					c.createdAtMockupVersion === viewingVersion &&
					commentViewport(c) === viewportLabel &&
					c.status === "open",
			).length;
		}
		return out;
	}, [active, screens, viewingVersion, viewportLabel]);

	const selected = comments.find((c) => c.id === selectedId) ?? null;
	const selectedIndex = selected
		? comments.findIndex((c) => c.id === selected.id)
		: -1;

	// Fetch the screen document framed at the current viewport; keep the
	// per-document nonce so posted events/comments can be validated.
	useEffect(() => {
		if (!active || !currentScreenId) {
			setSrcdoc("");
			setProbeReady(false);
			return;
		}
		const version = viewVersion ?? active.version;
		const docKey = `${active.id}:${currentScreenId}:${version}:${viewportLabel}`;
		const mode = viewOnly ? "&mode=view" : "";
		let cancelled = false;
		setProbeReady(false);
		fetch(
			`/api/mockups/${active.id}/screens/${currentScreenId}/document?version=${version}&viewport=${viewportLabel}${mode}`,
		)
			.then(async (r) => {
				if (!r.ok) return Promise.reject(new Error(String(r.status)));
				const html = await r.text();
				if (!cancelled) {
					const nonce = r.headers.get("X-Diffing-Mockup-Nonce");
					docNonceRef.current = nonce ? { nonce, docKey } : null;
					setSrcdoc(html);
				}
			})
			.catch(() => {
				if (!cancelled) setSrcdoc("");
			});
		return () => {
			cancelled = true;
		};
	}, [
		active?.id,
		currentScreenId,
		viewVersion,
		active?.version,
		viewportLabel,
		viewOnly,
	]);

	// Scope change (mockup / screen / version / viewport) clears transient UI state.
	useEffect(() => {
		setHover(null);
		setPending(null);
		setSelectedId(null);
		setStaleIds(new Set());
		setSections([]);
		if (pendingSelectRef.current) {
			setSelectedId(pendingSelectRef.current);
			pendingSelectRef.current = null;
		}
	}, [active?.id, currentScreenId, viewportLabel, viewVersion]);

	useEffect(() => {
		if (!toast) return;
		const t = setTimeout(() => setToast(null), 2200);
		return () => clearTimeout(t);
	}, [toast]);

	// Entering view-only drops any in-flight selection state (no shield → no
	// new hover/click probes) and closes any open thread.
	useEffect(() => {
		if (viewOnly) {
			setHover(null);
			setPending(null);
			setSelectedId(null);
		}
	}, [viewOnly]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
			if ((e.metaKey || e.ctrlKey) && (e.key === "," || e.code === "Comma")) {
				e.preventDefault();
				setSettingsOpen((o) => !o);
				return;
			}
			if (e.key === "b" && !e.metaKey && !e.ctrlKey)
				setSidebarCollapsed((v) => !v);
			else if (e.key === "1" && !historical) setTool("section");
			else if (e.key === "2" && !historical) setTool("block");
			else if (e.key === "3" && !historical) setTool("point");
			else if (e.key === "c") setCommentsRailOpen((v) => !v);
			else if (e.key === "v") setViewOnly((v) => !v);
			else if (e.key === "z") setZen((v) => !v);
			else if (e.key === "[" || e.key === "]") {
				if (!screens.length || !currentScreenId) return;
				const i = screens.findIndex((s) => s.id === currentScreenId);
				const next =
					e.key === "]"
						? (i + 1) % screens.length
						: (i - 1 + screens.length) % screens.length;
				setScreenId(screens[next].id);
			} else if (e.key === "Escape") {
				if (zen) {
					setZen(false);
					setZenReveal(null);
				} else {
					setPending(null);
					setHover(null);
					setSelectedId(null);
				}
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [screens, currentScreenId, historical, zen]);

	const sendAnchorCheck = useCallback(() => {
		const anchors = comments
			.filter((c) => c.selector)
			.map((c) => ({ id: c.id, selector: c.selector }));
		iframeRef.current?.contentWindow?.postMessage(
			{ type: "diffing-mockup", event: "check-anchors", anchors },
			"*",
		);
	}, [comments]);

	// Only accept probe events from the live iframe contentWindow, carrying the
	// exact nonce + viewport of the document we served.
	useEffect(() => {
		const expectedDocKey =
			active && currentScreenId
				? `${active.id}:${currentScreenId}:${viewingVersion}:${viewportLabel}`
				: null;
		const onMsg = (ev: MessageEvent) => {
			if (ev.source !== iframeRef.current?.contentWindow) return;
			const d = ev.data;
			if (!d || d.type !== "diffing-mockup") return;
			const served = docNonceRef.current;
			if (
				!served ||
				d.nonce !== served.nonce ||
				d.viewport !== viewportLabel ||
				served.docKey !== expectedDocKey
			)
				return;
			if (d.event === "ready") {
				setSections(d.sections ?? []);
				setProbeReady(true);
				sendAnchorCheck();
				return;
			}
			if (d.event === "anchors") {
				const results = Array.isArray(d.results) ? d.results : [];
				const missing = new Set<string>();
				for (const r of results) {
					if (r && !r.present && typeof r.id === "string") missing.add(r.id);
				}
				setStaleIds(missing);
				return;
			}
			if (d.event === "hover") {
				setHover(d as ProbeHit);
				return;
			}
			if (d.event === "hover-miss") {
				setHover(null);
				return;
			}
			if (d.event === "section-miss") {
				setHover(null);
				setToast("Choose an area tagged with data-diffing, or use Block");
				return;
			}
			if (d.event === "click" || d.event === "dragend") {
				if (historical) {
					setToast("Comments are disabled on historical versions");
					return;
				}
				// Canvas click always starts a new comment. Opening an existing
				// thread is only via the pin (or the rail), never via the region.
				setSelectedId(null);
				setPending(d as ProbeHit);
			}
		};
		window.addEventListener("message", onMsg);
		return () => window.removeEventListener("message", onMsg);
	}, [
		active?.id,
		currentScreenId,
		viewingVersion,
		viewportLabel,
		historical,
		sendAnchorCheck,
	]);

	// Re-run the anchor check whenever the scoped comments change on a ready
	// frame (new comment, viewport/screen switch re-render, etc.).
	useEffect(() => {
		if (probeReady) sendAnchorCheck();
	}, [probeReady, sendAnchorCheck]);

	const pushTool = useCallback(() => {
		iframeRef.current?.contentWindow?.postMessage(
			{ type: "diffing-mockup", event: "set-tool", tool },
			"*",
		);
	}, [tool]);

	useEffect(() => {
		pushTool();
	}, [pushTool, srcdoc]);

	const postComment = async (body: string, severity?: CommentSeverity) => {
		if (!active || !pending || !currentScreenId) return;
		await addComment({
			mockupId: active.id,
			screenId: currentScreenId,
			kind: pending.kind,
			body,
			target: pending.target,
			selector: pending.selector,
			html: pending.html,
			contextHtml: pending.contextHtml,
			x: pending.x,
			y: pending.y,
			sectionX: pending.sectionX,
			sectionY: pending.sectionY,
			snapshot: pending.snapshot,
			rect: pending.rect,
			severity,
			createdAtMockupVersion: active.version,
			nonce: docNonceRef.current?.nonce,
			viewport: viewportLabel,
			fingerprint: pending.fingerprint,
		});
		setPending(null);
	};

	const withSelected = (
		fn: (mockupId: string, comment: MockupComment) => void,
	) => {
		if (!active || !selected) return;
		fn(active.id, selected);
	};

	const commentsRailSheet = usePlanCommentsSheet();

	useEffect(() => {
		if (
			commentsRailSheet &&
			typeof window !== "undefined" &&
			typeof window.matchMedia === "function" &&
			window.matchMedia("(max-width: 768px)").matches
		) {
			setSidebarCollapsed(true);
		}
	}, [commentsRailSheet]);

	const toolTip = (id: Tool, tip: string, key: string): string => {
		if (viewOnly) return "View only — selection tools are disabled";
		if (historical) return "Comments are disabled on historical versions";
		if (id === "section" && sections.length === 0)
			return "Section — no tagged sections in this screen";
		return `${tip} · ${key}`;
	};

	const toolDisabled = (id: Tool): boolean =>
		viewOnly || historical || (id === "section" && sections.length === 0);

	if (isLoading || !loaded) {
		return (
			<div
				className="app plan-app skeleton-app"
				style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
			>
				<header className="skeleton-toolbar">
					<div className="skeleton-item skeleton-logo" />
					<div className="skeleton-item skeleton-stats" />
					<div className="skeleton-item skeleton-actions" />
				</header>
				<div className="app-body">
					<aside className="sidebar plan-sidebar skeleton-sidebar" />
					<main className="main plan-main skeleton-main" />
				</div>
			</div>
		);
	}

	return (
		<HapticsProvider
			enabled={settings.haptics ?? true}
			soundsEnabled={settings.sounds ?? true}
		>
			<div
				className={`app plan-app mockup-app ${zen ? "zen-mode" : ""}`}
				ref={appRef}
				style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
			>
				{zen && (
					<>
						<div
							className="zen-edge zen-edge-top"
							onMouseEnter={() => setZenReveal("toolbar")}
						/>
						<div
							className="zen-edge zen-edge-left"
							onMouseEnter={() => setZenReveal("sidebar")}
						/>
						<div
							className="zen-edge zen-edge-right"
							onMouseEnter={() => setZenReveal("rail")}
						/>
					</>
				)}
				<div
					className="sidebar-resize-guide"
					ref={sidebarGuideRef}
					aria-hidden="true"
				/>

				<div
					className={`toolbar plan-app-toolbar ${zen ? (zenReveal === "toolbar" ? "zen-revealed" : "") : ""}`}
					ref={toolbarRef}
					onMouseEnter={zen ? () => setZenReveal("toolbar") : undefined}
					onMouseLeave={zen ? () => setZenReveal(null) : undefined}
				>
					<div className="toolbar-left">
						<button
							className="toolbar-mobile-toggle"
							onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
							aria-label="Toggle sidebar"
							title={sidebarCollapsed ? "Open sidebar" : "Close sidebar"}
						>
							<Menu size={18} />
						</button>
						<Tooltip content="Back to diff review" side="bottom">
							<button
								className="btn btn-sm plan-toolbar-back"
								onClick={() => navigate("/")}
								aria-label="Back to the diff review"
							>
								<ArrowLeft size={14} />
								<span className="btn-label">Diff</span>
							</button>
						</Tooltip>
						<div className="plan-toolbar-brand">
							<BrandMark size={18} className="plan-app-brand" />
							<div className="plan-toolbar-brand-text">
								<h1 className="toolbar-title plan-app-title">Mockups</h1>
								{active ? (
									<span className="plan-toolbar-active" title={active.title}>
										{active.title}
									</span>
								) : (
									<span className="plan-toolbar-count">
										{mockups.length} mockup{mockups.length === 1 ? "" : "s"}
									</span>
								)}
							</div>
						</div>
					</div>

					<div className="plan-view-toggle" role="group" aria-label="Selection tool">
						{TOOL_OPTIONS.map(({ id, label, icon: Icon, tip, key }) => (
							<Tooltip key={id} content={toolTip(id, tip, key)} side="bottom">
								<button
									type="button"
									className={`plan-view-toggle-btn ${tool === id ? "is-active" : ""}`}
									aria-pressed={tool === id}
									aria-label={toolTip(id, tip, key)}
									disabled={toolDisabled(id)}
									onClick={() => setTool(id)}
								>
									<Icon size={13} aria-hidden="true" />
									<span>{label}</span>
								</button>
							</Tooltip>
						))}
					</div>

					<div className="toolbar-right">
						<div
							className="plan-view-toggle mockup-viewport-toggle"
							role="group"
							aria-label="Viewport"
						>
							{VIEWPORT_OPTIONS.map(({ value: w, label, viewport: vp }) => (
								<Tooltip
									key={w}
									content={`${label} — comments on this view are scoped to ${vp}`}
									side="bottom"
								>
									<button
										type="button"
										className={`plan-view-toggle-btn ${viewport === w ? "is-active" : ""}`}
										aria-pressed={viewport === w}
										onClick={() => setViewport(w)}
									>
										{label === "Desktop" ? (
											<Monitor size={13} aria-hidden="true" />
										) : label === "Tablet" ? (
											<Tablet size={13} aria-hidden="true" />
										) : (
											<Smartphone size={13} aria-hidden="true" />
										)}
										<span className="mockup-viewport-full">{label}</span>
										<span className="mockup-viewport-short" aria-hidden="true">
											{label.slice(0, 1)}
										</span>
									</button>
								</Tooltip>
							))}
						</div>
						<Tooltip
							content={
								viewOnly
									? "Exit view-only mode (v)"
									: "View only — interactive mockup, no selection (v)"
							}
							side="bottom"
						>
							<button
								type="button"
								className={`btn btn-sm ${viewOnly ? "btn-active" : ""}`}
								aria-pressed={viewOnly}
								title="View only (v)"
								aria-label={viewOnly ? "Exit view-only mode" : "Enter view-only mode"}
								onClick={() => setViewOnly((v) => !v)}
							>
								<Eye size={14} />
								<span className="btn-label">{viewOnly ? "Review" : "View only"}</span>
							</button>
						</Tooltip>
						<Tooltip
							content={
								zen
									? "Exit zen mode (z / Esc)"
									: "Zen mode — full-bleed mockup, auto-hide chrome (z)"
							}
							side="bottom"
						>
							<button
								type="button"
								className={`btn btn-sm ${zen ? "btn-active" : ""}`}
								aria-pressed={zen}
								title="Zen mode (z)"
								aria-label={zen ? "Exit zen mode" : "Enter zen mode"}
								onClick={() => {
									const next = !zen;
									setZen(next);
									if (next)
										setToast("Zen mode — hover the edges to reveal panels, Esc to exit");
								}}
							>
								{zen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
								<span className="btn-label">{zen ? "Exit zen" : "Zen"}</span>
							</button>
						</Tooltip>
						<Popover
							open={settingsOpen}
							onOpenChange={setSettingsOpen}
							ariaLabel="Settings"
							className="settings-popover"
							trigger={
								<button
									className={`btn btn-sm settings-btn ${settingsOpen ? "btn-active" : ""}`}
									title="Settings (⌘,)"
									aria-label="Settings"
								>
									<Settings size={14} />
									<span className="btn-label">Settings</span>
								</button>
							}
						>
							<div className="popover-scroll settings-panel">
								<div className="settings-section-label">Appearance</div>
								<div className="settings-item settings-item-spaced">
									<span>Theme</span>
									<button
										className="btn btn-sm settings-btn"
										onClick={() => {
											setThemeModalOpen(true);
											setSettingsOpen(false);
										}}
									>
										<Palette size={13} />
										Theme
									</button>
								</div>
								<div className="settings-item settings-item-spaced">
									<span>Comments rail</span>
									<button
										className="btn btn-sm"
										onClick={() => setCommentsRailOpen((v) => !v)}
									>
										{commentsRailOpen ? "Hide" : "Show"}
									</button>
								</div>
							</div>
						</Popover>
						{active && (
							<SubmitPlanReviewPopover
								kind="mockup"
								openCommentCount={totalOpenCount}
								scopedOpenCount={scopedOpenCount}
								submitting={submitting}
								agentWaiting={agentWaiting}
								currentDecision={active.decision}
								onSubmit={async (verdict, comment, mode) => {
									await submitDecision({
										mockupId: active.id,
										decision: verdict,
										comment,
										mode,
										screen: currentScreenId ?? undefined,
										viewport: viewportLabel,
									});
									setToast("Review sent · agent released");
								}}
							/>
						)}
					</div>
				</div>

				<div className="app-body">
					<aside
						ref={sidebarRef}
						className={`sidebar plan-sidebar ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${zen ? (zenReveal === "sidebar" ? "zen-revealed" : "") : ""}`}
						onMouseEnter={zen ? () => setZenReveal("sidebar") : undefined}
						onMouseLeave={zen ? () => setZenReveal(null) : undefined}
					>
						<MockupList
							mockups={mockups}
							activeId={active?.id ?? null}
							collapsed={sidebarCollapsed}
							onToggle={() => setSidebarCollapsed((v) => !v)}
							onSelect={(id) => {
								navigate(`/mockup/${id}`);
								setScreenId(null);
								setViewVersion(null);
								setPending(null);
							}}
							onDelete={removeMockup}
						/>
					</aside>
					{!zen && !sidebarCollapsed && (
						<div
							className="sidebar-resize-handle"
							onMouseDown={handleSidebarResizeStart}
						/>
					)}

					<main className="main plan-main">
						{active ? (
							<div className="plan-review">
								<header className="plan-review-head">
									<div className="plan-review-head-main">
										<div className="plan-review-title-row">
											<h2 className="plan-review-title" title={active.title}>
												{active.title}
											</h2>
											{decision && (
												<span className={`plan-badge ${decision.className}`}>
													<DecisionIcon size={12} aria-hidden="true" />
													{decision.label}
												</span>
											)}
										</div>
										<div className="plan-review-meta">
											{active.versions.length <= 1 ? (
												<span className="plan-review-chip">v{active.version}</span>
											) : (
												<div
													className={`plan-review-version-switcher ${historical ? "is-historical" : ""}`}
												>
													<History
														size={12}
														aria-hidden="true"
														className="plan-review-version-switcher-icon"
													/>
													<Select
														value={String(viewVersion ?? active.version)}
														onValueChange={(v) => setViewVersion(Number(v))}
														options={active.versions.map((ver) => ({
															value: String(ver.version),
															label: `v${ver.version}`,
														}))}
														ariaLabel="Mockup version"
													/>
												</div>
											)}
											{active.model && (
												<span
													className="plan-review-chip plan-review-chip-model"
													title={active.model}
												>
													<Bot size={11} aria-hidden="true" />
													{active.model}
												</span>
											)}
											<span className="plan-review-meta-stat">
												{screens.length} screen{screens.length === 1 ? "" : "s"}
												{" · "}
												{scopedOpenCount} open in this view
												{totalOpenCount !== scopedOpenCount && (
													<>
														{" · "}
														{totalOpenCount} open total
													</>
												)}
												{" · "}
												{timeAgo(active.updatedAt)}
											</span>
										</div>
									</div>
									<div
										className="plan-review-head-actions"
										role="toolbar"
										aria-label="Mockup actions"
									>
										<MockupScreenTabs
											screens={screens}
											activeScreenId={currentScreenId}
											openCounts={screenOpenCounts}
											onSelect={setScreenId}
										/>
										<button
											type="button"
											className={`btn btn-sm ${commentsRailOpen ? "btn-active" : ""}`}
											onClick={() => setCommentsRailOpen((v) => !v)}
											title="Toggle comments map (c)"
										>
											Comments
										</button>
									</div>
								</header>
								{historical && (
									<div className="plan-review-historical-banner">
										Viewing v{viewVersion} — comments stay on v{active.version}
									</div>
								)}
								<MockupCanvas
									title={active.title}
									srcdoc={srcdoc}
									viewport={viewport}
									viewOnly={viewOnly}
									zen={zen}
									staleIds={staleIds}
									comments={comments}
									frameRef={frameRef}
									iframeRef={iframeRef}
									onIframeLoad={pushTool}
									hover={hover}
									pending={pending}
									selected={selected}
									selectedId={selectedId}
									selectedIndex={selectedIndex}
									composerDraftKey={
										pending && currentScreenId
											? `mockup:${active.id}:${currentScreenId}:${viewportLabel}:${pending.kind}:${pending.selector ?? pending.x}`
											: ""
									}
									onPinToggle={(id) => {
										setPending(null);
										setSelectedId((cur) => (cur === id ? null : id));
									}}
									onDismissThread={() => setSelectedId(null)}
									onCancelPending={() => setPending(null)}
									onPostComment={postComment}
									onThreadResolve={() =>
										withSelected(
											(mockupId, c) =>
												void updateComment({
													mockupId,
													commentId: c.id,
													status: "resolved",
												}),
										)
									}
									onThreadUnresolve={() =>
										withSelected(
											(mockupId, c) =>
												void updateComment({
													mockupId,
													commentId: c.id,
													status: "open",
												}),
										)
									}
									onThreadDelete={() => {
										withSelected((mockupId, c) => {
											setSelectedId(null);
											void removeComment({ mockupId, commentId: c.id });
										});
									}}
									onThreadEdit={(body) =>
										withSelected(
											(mockupId, c) =>
												void updateComment({ mockupId, commentId: c.id, body }),
										)
									}
									onThreadReply={(body) =>
										withSelected(
											(mockupId, c) => void addReply({ mockupId, commentId: c.id, body }),
										)
									}
									onThreadEditReply={(replyId, body) =>
										withSelected(
											(mockupId, c) =>
												void updateReply({
													mockupId,
													commentId: c.id,
													replyId,
													body,
												}),
										)
									}
									onThreadDeleteReply={(replyId) =>
										withSelected(
											(mockupId, c) =>
												void removeReply({
													mockupId,
													commentId: c.id,
													replyId,
												}),
										)
									}
								/>
							</div>
						) : (
							<div className="plan-review-empty empty-state">
								<p className="empty-state-title">No mockup selected</p>
								<p className="empty-state-hint">
									Submit one with submit_mockup or `diffing mockup submit -`.
								</p>
							</div>
						)}
					</main>

					{!zen && commentsRailOpen && active && commentsRailSheet && (
						<div
							className="plan-comments-sheet-backdrop"
							onClick={() => setCommentsRailOpen(false)}
							aria-hidden="true"
						/>
					)}
					{active && (zen || commentsRailOpen) && (
						<div
							className={`mockup-rail-slot ${zen ? (zenReveal === "rail" ? "zen-revealed" : "") : ""}`}
							onMouseEnter={zen ? () => setZenReveal("rail") : undefined}
							onMouseLeave={zen ? () => setZenReveal(null) : undefined}
						>
							<MockupCommentsRail
								comments={comments}
								priorVersionOpen={priorVersionOpen}
								otherViewportOpen={otherViewportOpen}
								scopedOpenCount={scopedOpenCount}
								totalOpenCount={totalOpenCount}
								selectedId={selectedId}
								staleIds={staleIds}
								disabled={viewOnly}
								onSelect={(id) => {
									setPending(null);
									setSelectedId(id);
								}}
								onJumpToComment={(c) => {
									pendingSelectRef.current = c.id;
									setViewVersion(c.createdAtMockupVersion);
								}}
								onJumpToViewport={(c) => {
									pendingSelectRef.current = c.id;
									setViewport(VIEWPORT_PX[commentViewport(c)]);
								}}
								onClose={() => (zen ? setZenReveal(null) : setCommentsRailOpen(false))}
								sheet={zen ? false : commentsRailSheet}
							/>
						</div>
					)}
				</div>

				<ThemeModal
					open={themeModalOpen}
					onClose={() => setThemeModalOpen(false)}
					activeTheme={settings.theme || "rose-pine"}
					onThemeChange={(theme) => updateSettings({ theme })}
				/>
				{toast && (
					<div className="mockup-toast" role="status">
						{toast}
					</div>
				)}
			</div>
		</HapticsProvider>
	);
}
