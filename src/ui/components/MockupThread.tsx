import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Pencil,
  Reply,
  Trash2,
  User,
} from "lucide-react";
import type { MockupComment } from "../../lib/mockup-types";
import type { AiMockupContext } from "../../lib/ai/types";
import { extractSuggestion } from "../../lib/mockup-suggestion";
import { timeAgo } from "../utils";
import { Markdown } from "./Markdown";
import { CommentForm } from "./CommentForm";
import { MockupLocationChips } from "./MockupLocationChips";

function AvatarIcon({
  role,
  size = 16,
}: {
  role: "user" | "agent";
  size?: number;
}) {
  if (role === "agent") {
    return (
      <div
        className={`comment-avatar-circle comment-avatar-agent comment-avatar-size-${size}`}
      >
        <Bot size={size} aria-hidden="true" />
      </div>
    );
  }
  return (
    <div
      className={`comment-avatar-circle comment-avatar-user comment-avatar-size-${size}`}
    >
      <User size={size} aria-hidden="true" />
    </div>
  );
}

export interface MockupThreadProps {
  /** Display number of the thread within the current scope (1-based). */
  index: number;
  comment: MockupComment;
  onClose: () => void;
  onResolve: () => void;
  onUnresolve: () => void;
  onDelete: () => void;
  onEdit: (body: string) => void;
  onReply: (body: string) => void;
  onEditReply: (replyId: string, body: string) => void;
  onDeleteReply: (replyId: string) => void;
  onApplySuggestion?: () => void | Promise<void>;
  aiContext?: AiMockupContext | null;
}

/**
 * An existing mockup comment thread, rendered with the shared diff/plan
 * thread surface (comment-bubble-canvas / comment-node) so the two review
 * flows look identical. Drives the existing mockup endpoints: resolve via
 * updateComment status, edit via updateComment body, delete via removeComment,
 * and reply edit/delete via the reply endpoints.
 */
export function MockupThread({
  index,
  comment,
  onClose,
  onResolve,
  onUnresolve,
  onDelete,
  onEdit,
  onReply,
  onEditReply,
  onDeleteReply,
  onApplySuggestion,
  aiContext,
}: MockupThreadProps) {
  const threadAiContext = aiContext
    ? {
        ...aiContext,
        kind: "mockup-thread" as const,
        commentBody: comment.body,
        replies: comment.replies?.map((reply) => reply.body),
        selectedHtml: comment.html ?? comment.snapshot,
        region: comment.target,
      }
    : undefined;
  const threadSnippet = comment.html ?? comment.snapshot;
  const isResolved = comment.status === "resolved";
  const [collapsed, setCollapsed] = useState(isResolved);
  const [isReplying, setIsReplying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [applyingSuggestion, setApplyingSuggestion] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const suggestion = extractSuggestion(comment.body);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteReplyId, setDeleteReplyId] = useState<string | null>(null);
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);

  useEffect(() => {
    if (comment.status === "resolved") setCollapsed(true);
  }, [comment.status]);

  const bodyPreview = comment.body.replace(/\s+/g, " ").trim().slice(0, 72);
  const replyCount = comment.replies?.length ?? 0;
  const chips = <MockupLocationChips comment={comment} />;

  const deleteConfirmControls = (
    <div className="comment-delete-confirm">
      <button
        type="button"
        className="comment-node-btn comment-node-btn-delete comment-delete-confirm-yes"
        onClick={() => {
          setDeleteConfirming(false);
          onDelete();
        }}
        title="Confirm delete"
        aria-label="Confirm delete comment"
      >
        <AlertTriangle size={11} />
        Delete?
      </button>
      <button
        type="button"
        className="comment-node-btn comment-delete-confirm-cancel"
        onClick={() => setDeleteConfirming(false)}
        title="Cancel delete"
        aria-label="Cancel delete"
      >
        Cancel
      </button>
    </div>
  );

  if (collapsed && !isEditing) {
    return (
      <div
        className={`comment-collapsed-bar ${isResolved ? "comment-collapsed-bar-resolved" : ""}`}
        role="article"
      >
        <button
          type="button"
          className="comment-collapsed-toggle"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          aria-label="Expand comment thread"
          title="Expand"
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <div className="comment-collapsed-main">
          {isResolved ? (
            <CheckCircle2
              size={14}
              className="comment-collapsed-resolved-icon"
              aria-hidden="true"
            />
          ) : (
            <AvatarIcon role="user" size={11} />
          )}
          <span className="comment-collapsed-label">
            {isResolved ? "Resolved" : "User"}
          </span>
          {chips}
          <span className="comment-collapsed-preview" title={comment.body}>
            {bodyPreview}
            {comment.body.length > 72 ? "…" : ""}
          </span>
          <span className="comment-collapsed-meta">
            #{index} ·{" "}
            {replyCount > 0 ? `${replyCount + 1} comments` : "1 comment"}
          </span>
        </div>
        <div className="comment-collapsed-actions">
          {deleteConfirming ? (
            deleteConfirmControls
          ) : (
            <button
              type="button"
              className="comment-node-btn comment-node-btn-delete"
              onClick={() => setDeleteConfirming(true)}
              title="Delete comment"
              aria-label="Delete comment"
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="comment-collapsed-expand-btn"
            onClick={() => setCollapsed(false)}
          >
            Expand
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`comment-bubble-canvas ${isResolved ? "comment-bubble-canvas-resolved" : ""}`}
      role="article"
    >
      <div
        className={`comment-node ${isResolved ? "comment-node-resolved" : ""}`}
      >
        <div className="comment-avatar-col">
          <AvatarIcon role="user" size={16} />
        </div>
        <div className="comment-content-col">
          <div className="comment-node-header">
            <button
              type="button"
              className="comment-collapse-btn"
              onClick={() => setCollapsed(true)}
              aria-expanded={true}
              aria-label="Collapse comment thread"
              title="Collapse"
            >
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <span className="comment-node-author">User</span>
            <span className="comment-node-badge comment-node-badge-user">
              User
            </span>
            <span className="comment-node-time comment-node-meta">
              {timeAgo(comment.createdAt)}
              {chips}
            </span>
            {isResolved && (
              <span className="comment-canvas-resolved-banner comment-resolved-inline">
                <CheckCircle2 size={13} />
                Resolved
              </span>
            )}
            {!isEditing && (
              <div className="comment-node-actions">
                {!isResolved && (
                  <button
                    type="button"
                    className="comment-node-btn"
                    onClick={() => setIsEditing(true)}
                    title="Edit comment"
                    aria-label="Edit comment"
                  >
                    <Pencil size={13} aria-hidden="true" />
                  </button>
                )}
                {deleteConfirming ? (
                  deleteConfirmControls
                ) : (
                  <button
                    type="button"
                    className="comment-node-btn comment-node-btn-delete"
                    onClick={() => setDeleteConfirming(true)}
                    title="Delete comment"
                    aria-label="Delete comment"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </div>

          {isEditing ? (
            <div className="comment-edit-form-wrap">
              <CommentForm
                draftKey={`mockup-edit:${comment.id}`}
                initialBody={comment.body}
                lineContent={threadSnippet}
                aiSurface={threadAiContext ? "mockup" : undefined}
                aiContext={threadAiContext}
                onSubmit={(newBody) => {
                  onEdit(newBody);
                  setIsEditing(false);
                }}
                onCancel={() => setIsEditing(false)}
              />
            </div>
          ) : (
            <Markdown
              content={comment.body}
              className={`comment-node-body markdown-body ${isResolved ? "comment-resolved-line" : ""}`}
            />
          )}
          {suggestion && (
            <div className="suggestion-card comment-suggestion-card">
              <div className="suggestion-header">
                <span className="suggestion-header-label">
                  Suggested Change
                </span>
                {isResolved ? (
                  <span className="suggestion-applied">
                    <CheckCircle2 size={12} /> Applied
                  </span>
                ) : onApplySuggestion ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={applyingSuggestion}
                    onClick={async () => {
                      setApplyingSuggestion(true);
                      setSuggestionError(null);
                      try {
                        await onApplySuggestion();
                      } catch (err) {
                        setSuggestionError(
                          err instanceof Error
                            ? err.message
                            : "The suggestion could not be applied.",
                        );
                      } finally {
                        setApplyingSuggestion(false);
                      }
                    }}
                  >
                    {applyingSuggestion ? "Applying…" : "Apply Suggestion"}
                  </button>
                ) : null}
              </div>
              <pre className="suggestion-diff">
                <code>{suggestion}</code>
              </pre>
              {suggestionError && (
                <p className="comment-suggestion-error" role="alert">
                  {suggestionError}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {comment.replies?.length > 0 && (
        <div className="comment-replies" role="list" aria-label="Replies">
          {comment.replies.map((reply, idx) => {
            const isAgent = reply.role === "agent";
            const isEditingThis = editingReplyId === reply.id;
            return (
              <div
                key={reply.id}
                className={`comment-node ${isAgent ? "comment-node-agent" : "comment-node-user"} ${isResolved ? "comment-node-resolved" : ""}`}
                role="listitem"
                aria-label={`${isAgent ? "Agent" : "User"} reply ${idx + 1}`}
              >
                <div className="comment-avatar-col">
                  <AvatarIcon role={isAgent ? "agent" : "user"} size={14} />
                </div>
                <div className="comment-content-col">
                  <div className="comment-node-header">
                    <span className="comment-node-author">
                      {isAgent ? "Agent" : "User"}
                    </span>
                    <span
                      className={`comment-node-badge ${isAgent ? "comment-node-badge-agent" : "comment-node-badge-user"}`}
                    >
                      {isAgent ? "Agent" : "User"}
                    </span>
                    {isAgent && reply.model && (
                      <span className="comment-model-chip">{reply.model}</span>
                    )}
                    <span className="comment-node-time">
                      {timeAgo(reply.createdAt)}
                    </span>
                    <div className="comment-node-actions">
                      {!isResolved && (
                        <button
                          type="button"
                          className="comment-node-btn"
                          onClick={() => setEditingReplyId(reply.id)}
                          title="Edit reply"
                          aria-label="Edit reply"
                        >
                          <Pencil size={12} aria-hidden="true" />
                        </button>
                      )}
                      {deleteReplyId === reply.id ? (
                        <div className="comment-delete-confirm">
                          <button
                            type="button"
                            className="comment-node-btn comment-node-btn-delete comment-delete-confirm-yes"
                            onClick={() => {
                              setDeleteReplyId(null);
                              onDeleteReply(reply.id);
                            }}
                            title="Confirm delete reply"
                            aria-label="Confirm delete reply"
                          >
                            <AlertTriangle size={11} />
                            Delete?
                          </button>
                          <button
                            type="button"
                            className="comment-node-btn comment-delete-confirm-cancel"
                            onClick={() => setDeleteReplyId(null)}
                            title="Cancel delete"
                            aria-label="Cancel delete reply"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="comment-node-btn comment-node-btn-delete"
                          onClick={() => setDeleteReplyId(reply.id)}
                          title="Delete reply"
                          aria-label="Delete reply"
                        >
                          <Trash2 size={12} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                  {isEditingThis ? (
                    <div className="comment-reply-editor">
                      <CommentForm
                        draftKey={`mockup-reply-edit:${comment.id}:${reply.id}`}
                        initialBody={reply.body}
                        lineContent={threadSnippet}
                        showSeverity={false}
                        aiSurface={threadAiContext ? "mockup" : undefined}
                        aiContext={threadAiContext}
                        onSubmit={(body) => {
                          onEditReply(reply.id, body);
                          setEditingReplyId(null);
                        }}
                        onCancel={() => setEditingReplyId(null)}
                      />
                    </div>
                  ) : (
                    <Markdown
                      content={reply.body}
                      className="comment-node-body markdown-body"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="comment-canvas-footer">
        {!isReplying && (
          <div className="comment-canvas-footer-row">
            <button
              onClick={() => setIsReplying(true)}
              className="comment-reply-trigger"
            >
              <Reply size={14} aria-hidden="true" />
              Reply...
            </button>
            {isResolved ? (
              <div className="comment-canvas-footer-actions">
                <button className="btn btn-secondary btn-sm" onClick={onClose}>
                  Close
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={onUnresolve}
                >
                  Unresolve
                </button>
              </div>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={onResolve}>
                Resolve
              </button>
            )}
          </div>
        )}
        {isReplying && (
          <div className="comment-reply-composer">
            <CommentForm
              draftKey={`mockup-reply:${comment.id}`}
              lineContent={threadSnippet}
              showSeverity={false}
              aiSurface={threadAiContext ? "mockup" : undefined}
              aiContext={threadAiContext}
              onSubmit={(body) => {
                onReply(body);
                setIsReplying(false);
              }}
              onCancel={() => setIsReplying(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
