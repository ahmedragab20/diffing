import type { CommentSeverity } from "../../lib/types";
import type { AiMockupContext } from "../../lib/ai/types";
import { CommentForm } from "./CommentForm";
import { MockupFloatCard } from "./MockupFloatCard";
import { hitLabel, pinPercent, type MockupPinSource } from "./MockupAnchors";

export interface MockupComposerProps {
  pending: MockupPinSource & {
    kind: "section" | "block" | "point";
    selector?: string;
    snapshot?: string;
    html?: string;
    target?: string;
    x?: number;
    y?: number;
  };
  frameRef: React.RefObject<HTMLDivElement | null>;
  draftKey: string;
  onSubmit: (body: string, severity?: CommentSeverity) => void;
  onCancel: () => void;
  aiContext?: AiMockupContext | null;
  onRewriteRegion?: () => void;
  rewriting?: boolean;
}

/**
 * Floating composer for a new mockup comment, anchored next to the click/pin
 * position and clamped with the PlanFloatComposers helpers. The draft survives
 * closing (draftKey), so cancelling is lossless.
 */
export function MockupComposer({
  pending,
  frameRef,
  draftKey,
  onSubmit,
  onCancel,
  aiContext,
  onRewriteRegion,
  rewriting = false,
}: MockupComposerProps) {
  const regionContext = aiContext
    ? {
        ...aiContext,
        kind: "mockup-region" as const,
        selectedHtml: pending.html ?? pending.snapshot,
        region: pending.target,
      }
    : undefined;
  return (
    <MockupFloatCard
      anchor={pinPercent(pending)}
      frameRef={frameRef}
      title={`Commenting on ${hitLabel(pending)}`}
      onClose={onCancel}
      className="mockup-composer-card"
    >
      <div className="mockup-composer-form">
        {onRewriteRegion && pending.target && (
          <div className="mockup-composer-ai-row">
            <button
              type="button"
              className="btn btn-sm"
              disabled={rewriting}
              onClick={onRewriteRegion}
            >
              {rewriting ? "Rewriting…" : "Rewrite region"}
            </button>
          </div>
        )}
        <CommentForm
          draftKey={draftKey}
          lineLabel={hitLabel(pending)}
          lineContent={pending.html ?? pending.snapshot}
          showSeverity
          autoFocus
          aiSurface={regionContext ? "mockup" : undefined}
          aiContext={regionContext}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      </div>
    </MockupFloatCard>
  );
}
