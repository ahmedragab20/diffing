import type { CommentSeverity } from "../../lib/types";
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
}: MockupComposerProps) {
  return (
    <MockupFloatCard
      anchor={pinPercent(pending)}
      frameRef={frameRef}
      title={`Commenting on ${hitLabel(pending)}`}
      onClose={onCancel}
      className="mockup-composer-card"
      width={400}
      height={420}
    >
      <div className="mockup-composer-form">
        <CommentForm
          draftKey={draftKey}
          lineLabel={hitLabel(pending)}
          lineContent={pending.html ?? pending.snapshot}
          showSeverity
          autoFocus
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      </div>
    </MockupFloatCard>
  );
}
