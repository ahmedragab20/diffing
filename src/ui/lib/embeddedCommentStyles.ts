/**
 * Comment containment rules injected into Pierre's shadow root.
 *
 * The normal Gridline stylesheet cannot cross that boundary. Keeping this
 * fragment shared prevents plan-source and code-diff comments from drifting
 * when their wrapping or responsive geometry changes.
 */
export const EMBEDDED_COMMENT_STYLES = `
    .comment-bubble-canvas {
      width: min(720px, calc(100% - 40px), calc(100vw - 80px)) !important;
      max-width: calc(100vw - 80px) !important;
      margin: 14px 20px !important;
      min-width: 0 !important;
      box-sizing: border-box !important;
      overflow: hidden !important;
    }
    .comment-collapsed-bar {
      width: min(720px, calc(100% - 40px), calc(100vw - 80px)) !important;
      max-width: calc(100vw - 80px) !important;
      margin: 14px 20px !important;
      min-width: 0 !important;
      box-sizing: border-box !important;
    }
    .comment-replies {
      min-width: 0 !important;
    }
    .comment-node {
      width: 100% !important;
      min-width: 0 !important;
      box-sizing: border-box !important;
    }
    .comment-content-col {
      flex: 1 1 0 !important;
      width: 0 !important;
      min-width: 0 !important;
      max-width: 100% !important;
    }
    .comment-node-header {
      flex-wrap: wrap !important;
      min-width: 0 !important;
    }
    .comment-node-body {
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      white-space: normal !important;
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
    }
    .comment-node-body :where(p, li, blockquote, code, a),
    .plan-comment-source,
    .plan-comment-quote {
      max-width: 100% !important;
      white-space: normal !important;
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
    }
    .comment-node-body :where(.md-code-block, pre, table, img, svg) {
      max-width: 100% !important;
    }
    .comment-node-body pre {
      overflow-x: auto !important;
      white-space: pre !important;
      overflow-wrap: normal !important;
      word-break: normal !important;
    }
    .comment-node-body pre code {
      white-space: inherit !important;
      overflow-wrap: inherit !important;
      word-break: inherit !important;
    }
    .plan-comment-source {
      white-space: pre-wrap !important;
    }
    .comment-canvas-footer-row {
      flex-wrap: wrap !important;
      gap: 8px !important;
      min-width: 0 !important;
    }
    .comment-canvas-footer-row .comment-reply-trigger {
      flex: 1 1 240px !important;
      width: auto !important;
      max-width: none !important;
      min-width: 0 !important;
    }
    .comment-canvas-footer-actions {
      margin-left: 0 !important;
      flex-wrap: wrap !important;
    }
`
