import { AlertTriangle, RotateCcw, History, X } from 'lucide-react'
import { Modal } from '../primitives/Modal'

export type PlanDiscardChoice = 'recent' | 'original'

export interface PlanDiscardEditsDialogProps {
  open: boolean
  /** Current edit session has changes vs when this session started. */
  canDiscardRecent: boolean
  /**
   * Plan has drifted from the pre-edit original for this version
   * (typically after exit + re-enter with autosaved work).
   */
  canRollbackOriginal: boolean
  /**
   * When both are true, show two distinct actions. When only one, a single
   * primary discard/rollback button.
   */
  onChoose: (choice: PlanDiscardChoice) => void
  onCancel: () => void
  busy?: boolean
}

/**
 * Discard UI for live plan editing. One action when only recent or only
 * original rollback is available; two stacked choices when the user re-entered
 * edit after prior autosaves and also has newer session edits.
 */
export function PlanDiscardEditsDialog({
  open,
  canDiscardRecent,
  canRollbackOriginal,
  onChoose,
  onCancel,
  busy = false,
}: PlanDiscardEditsDialogProps) {
  const dual = canDiscardRecent && canRollbackOriginal
  const onlyRecent = canDiscardRecent && !canRollbackOriginal
  const onlyOriginal = canRollbackOriginal && !canDiscardRecent

  return (
    <Modal open={open} onClose={onCancel} className="confirm-dialog plan-discard-dialog" ariaLabel="Discard plan edits">
      <div className="confirm-dialog-header">
        <span className="confirm-dialog-icon confirm-dialog-icon-danger" aria-hidden="true">
          <AlertTriangle size={18} />
        </span>
        <h2 className="confirm-dialog-title">
          {dual ? 'Discard which edits?' : onlyOriginal ? 'Roll back to original?' : 'Discard edits?'}
        </h2>
      </div>

      {dual ? (
        <>
          <p className="confirm-dialog-desc">
            You have edits from this session, and earlier changes already saved on this version.
            Choose how far to roll back. This cannot be undone.
          </p>
          <div className="plan-discard-choices" role="group" aria-label="Discard options">
            <button
              type="button"
              className="plan-discard-choice"
              disabled={busy}
              onClick={() => onChoose('recent')}
              autoFocus
            >
              <span className="plan-discard-choice-icon" aria-hidden="true">
                <RotateCcw size={16} />
              </span>
              <span className="plan-discard-choice-text">
                <span className="plan-discard-choice-title">Discard recent edits</span>
                <span className="plan-discard-choice-desc">
                  Restore to when you started this edit session. Keeps earlier saved edits.
                </span>
              </span>
            </button>
            <button
              type="button"
              className="plan-discard-choice plan-discard-choice-danger"
              disabled={busy}
              onClick={() => onChoose('original')}
            >
              <span className="plan-discard-choice-icon" aria-hidden="true">
                <History size={16} />
              </span>
              <span className="plan-discard-choice-text">
                <span className="plan-discard-choice-title">Roll back to original</span>
                <span className="plan-discard-choice-desc">
                  Restore the plan to before you started editing this version at all.
                </span>
              </span>
            </button>
          </div>
        </>
      ) : onlyOriginal ? (
        <p className="confirm-dialog-desc">
          Earlier edits from a previous session were saved into this version. Roll back to the
          plan as it was before you started editing? This cannot be undone.
        </p>
      ) : (
        <p className="confirm-dialog-desc">
          Restore the plan body and title to when you started this edit session. This undoes
          unsaved changes and any autosaves from this session. This cannot be undone.
        </p>
      )}

      <div className="confirm-dialog-footer plan-discard-footer">
        <button
          type="button"
          className="btn btn-sm confirm-dialog-cancel"
          onClick={onCancel}
          disabled={busy}
        >
          <X size={13} aria-hidden="true" />
          Keep editing
        </button>
        {!dual && (
          <button
            type="button"
            className="btn btn-sm confirm-dialog-confirm confirm-dialog-confirm-danger"
            onClick={() => onChoose(onlyOriginal ? 'original' : 'recent')}
            disabled={busy || (!onlyRecent && !onlyOriginal)}
            autoFocus
          >
            {onlyOriginal ? 'Roll back to original' : 'Discard all edits'}
          </button>
        )}
      </div>
    </Modal>
  )
}
