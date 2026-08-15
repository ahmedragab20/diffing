/**
 * Token constants shared by server and client code.
 *
 * This module MUST NOT import any Node-only built-ins (e.g. `node:crypto`) so it
 * is safe to bundle into the browser UI. Server-only helpers live in
 * `server-auth.ts` and re-export these values for existing Node importers.
 */

/** Header, HttpOnly cookie, or SSE query param carrying the per-session review API token. */
export const SESSION_TOKEN_HEADER = 'x-diffing-token'
export const SESSION_TOKEN_QUERY = 'token'
export const SESSION_TOKEN_COOKIE = 'diffing-token'