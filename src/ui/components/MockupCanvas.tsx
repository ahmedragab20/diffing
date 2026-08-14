import type { CommentSeverity } from "../../lib/types";
import type { MockupComment } from "../../lib/mockup-types";
import { commentViewport } from "../../lib/mockup-types";
import { MockupComposer } from "./MockupComposer";
import { MockupFloatCard } from "./MockupFloatCard";
import { MockupThread } from "./MockupThread";
import {
        hitLabel,
        pinPercent,
        pinStackOffset,
        VIEWPORT_LABEL,
        type MockupPinSource,
        type ViewportPx,
} from "./MockupAnchors";

export interface ProbeHit extends MockupPinSource {
        kind: "section" | "block" | "point";
        target?: string;
        selector?: string;
        html?: string;
        contextHtml?: string;
        snapshot?: string;
        sectionX?: number;
        sectionY?: number;
        rect?: { x: number; y: number; w: number; h: number };
        x: number;
        y: number;
        fingerprint?: string;
}

export interface MockupCanvasProps {
        title: string;
        srcdoc: string;
        viewport: ViewportPx;
        /** View-only: interactive mockup (no selection shield) — pins stay, outlines don't. */
        viewOnly?: boolean;
        /** Zen: full-bleed frame (no padding / max-width). */
        zen?: boolean;
        /** Comment ids whose anchor element is no longer present in the screen. */
        staleIds?: Set<string>;
        /** Comments scoped to the current version + screen + viewport (canvas pins). */
        comments: MockupComment[];
        frameRef: React.RefObject<HTMLDivElement | null>;
        iframeRef: React.RefObject<HTMLIFrameElement | null>;
        onIframeLoad: () => void;
        hover: ProbeHit | null;
        pending: ProbeHit | null;
        selected: MockupComment | null;
        selectedId: string | null;
        selectedIndex: number;
        /** Draft storage key for the pending composer (scoped by mockup/screen/viewport). */
        composerDraftKey: string;
        onPinToggle: (id: string) => void;
        onDismissThread: () => void;
        onCancelPending: () => void;
        onPostComment: (body: string, severity?: CommentSeverity) => void;
        onThreadResolve: () => void;
        onThreadUnresolve: () => void;
        onThreadDelete: () => void;
        onThreadEdit: (body: string) => void;
        onThreadReply: (body: string) => void;
        onThreadEditReply: (replyId: string, body: string) => void;
        onThreadDeleteReply: (replyId: string) => void;
}

function CanvasPin({
        comment,
        index,
        offset,
        open,
        onClick,
}: {
        comment: MockupComment;
        index: number;
        offset: number;
        open: boolean;
        onClick: () => void;
}) {
        const pin = pinPercent(comment);
        return (
                <button
                        type="button"
                        className={`mockup-pin ${comment.status} ${open ? "is-open" : ""}`}
                        style={{
                                left: `${pin.x}%`,
                                top: `${pin.y}%`,
                                transform: `translate(calc(-50% + ${offset * 18}px), -50%)`,
                        }}
                        aria-label={`Comment ${index + 1}: ${hitLabel(comment)} · v${comment.createdAtMockupVersion} · ${commentViewport(comment)}`}
                        title={`${hitLabel(comment)} · v${comment.createdAtMockupVersion} · ${commentViewport(comment)}`}
                        onClick={(e) => {
                                e.stopPropagation();
                                onClick();
                        }}
                >
                        {index + 1}
                </button>
        );
}

/**
 * The mockup canvas: framed iframe (framed at the current viewport width) with
 * the probe overlay, hover/selection outlines, numbered pins for the scoped
 * comments, and the clamped floating thread + composer.
 */
export function MockupCanvas({
        title,
        srcdoc,
        viewport,
        viewOnly = false,
        zen = false,
        staleIds,
        comments,
        frameRef,
        iframeRef,
        onIframeLoad,
        hover,
        pending,
        selected,
        selectedId,
        selectedIndex,
        composerDraftKey,
        onPinToggle,
        onDismissThread,
        onCancelPending,
        onPostComment,
        onThreadResolve,
        onThreadUnresolve,
        onThreadDelete,
        onThreadEdit,
        onThreadReply,
        onThreadEditReply,
        onThreadDeleteReply,
}: MockupCanvasProps) {
        const pinnedComments = comments.filter((c) => !staleIds?.has(c.id));
        return (
                <div className="mockup-stage">
                        <div
                                ref={frameRef}
                                className="mockup-frame"
                                style={{
                                        width: zen
                                                ? "100%"
                                                : Math.min(viewport, 1600),
                                }}
                        >
                                {srcdoc ? (
                                        <iframe
                                                ref={iframeRef}
                                                className="mockup-iframe"
                                                title={`${title} — ${VIEWPORT_LABEL[viewport]} (${viewport}px)`}
                                                sandbox={
                                                        viewOnly
                                                                ? "allow-scripts allow-forms allow-modals allow-popups"
                                                                : "allow-scripts"
                                                }
                                                srcDoc={srcdoc}
                                                onLoad={onIframeLoad}
                                        />
                                ) : (
                                        <div className="empty-state">
                                                <p className="empty-state-hint">
                                                        Loading screen…
                                                </p>
                                        </div>
                                )}
                                <div className="mockup-overlays">
                                        {!viewOnly &&
                                                hover?.rect &&
                                                !pending &&
                                                !selectedId && (
                                                        <div
                                                                className={`mockup-outline kind-${hover.kind}`}
                                                                style={{
                                                                        left: `${hover.rect.x}%`,
                                                                        top: `${hover.rect.y}%`,
                                                                        width: `${hover.rect.w}%`,
                                                                        height: `${hover.rect.h}%`,
                                                                }}
                                                        >
                                                                <span>
                                                                        {hitLabel(
                                                                                hover,
                                                                        )}
                                                                </span>
                                                        </div>
                                                )}
                                        {!viewOnly &&
                                                selected?.rect &&
                                                !staleIds?.has(selected.id) && (
                                                        <div
                                                                className="mockup-outline mockup-outline-selected"
                                                                style={{
                                                                        left: `${selected.rect.x}%`,
                                                                        top: `${selected.rect.y}%`,
                                                                        width: `${selected.rect.w}%`,
                                                                        height: `${selected.rect.h}%`,
                                                                }}
                                                        />
                                                )}
                                        {!viewOnly &&
                                                pinnedComments.map((c, i) => (
                                                        <CanvasPin
                                                                key={c.id}
                                                                comment={c}
                                                                index={i}
                                                                offset={pinStackOffset(
                                                                        pinnedComments,
                                                                        i,
                                                                )}
                                                                open={
                                                                        selectedId ===
                                                                        c.id
                                                                }
                                                                onClick={() =>
                                                                        onPinToggle(
                                                                                c.id,
                                                                        )
                                                                }
                                                        />
                                                ))}
                                </div>
                        </div>

                        {!viewOnly && selected && (
                                <MockupFloatCard
                                        anchor={pinPercent(selected)}
                                        frameRef={frameRef}
                                        title={`Comment ${selectedIndex + 1}`}
                                        onClose={onDismissThread}
                                        className="mockup-thread-card"
                                >
                                        <MockupThread
                                                index={selectedIndex}
                                                comment={selected}
                                                onClose={onDismissThread}
                                                onResolve={onThreadResolve}
                                                onUnresolve={onThreadUnresolve}
                                                onDelete={onThreadDelete}
                                                onEdit={onThreadEdit}
                                                onReply={onThreadReply}
                                                onEditReply={onThreadEditReply}
                                                onDeleteReply={
                                                        onThreadDeleteReply
                                                }
                                        />
                                </MockupFloatCard>
                        )}
                        {!viewOnly && pending && (
                                <MockupComposer
                                        pending={pending}
                                        frameRef={frameRef}
                                        draftKey={composerDraftKey}
                                        onSubmit={onPostComment}
                                        onCancel={onCancelPending}
                                />
                        )}
                </div>
        );
}
