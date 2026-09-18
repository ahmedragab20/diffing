import { z } from "zod";
import {
  REVIEW_CREDENTIAL_HEADER, reviewAcknowledgementSchema, reviewEventsSchema,
  reviewHandoffPayloadSchema, reviewLegacySourcePageSchema, reviewRequestSchema, reviewStateSchema,
  type ReviewCommand, type ReviewRequest, type ReviewState,
} from "./review-core-contract.js";
import { reviewIdentitySchema, type ReviewIdentity } from "./review-identity.js";
import { REVIEW_STORE_LIMITS } from "./review-store-contract.js";
import { LEGACY_CHUNK_BYTES, LEGACY_FILES } from "./review-legacy-contract.js";

const sameIdentity = (a: ReviewIdentity, b: ReviewIdentity) => a.reviewId === b.reviewId && a.workspaceId === b.workspaceId && a.repositoryId === b.repositoryId;
const errorSchema = z.object({ code: z.string().regex(/^[a-z_]+$/).max(80), recovery: z.string().regex(/^[a-z_]+$/).max(80).optional(), sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() });

export class ReviewClientError extends Error {
  constructor(readonly code: string, readonly recovery?: string, readonly status?: number, readonly sequence?: number) { super(code); }
}

/** No credential issuance or implicit retry. Retain the returned request and
 * send that same envelope again when an acknowledgement is lost. */
export function prepareReviewRequest(state: Pick<ReviewState, "identity" | "version" | "currentSnapshotId">, command: ReviewCommand, options: { requestId?: string; snapshotId?: string | null } = {}): ReviewRequest {
  return reviewRequestSchema.parse({
    ...state.identity, version: 1, requestId: options.requestId ?? globalThis.crypto.randomUUID(), expectedVersion: state.version,
    snapshotId: command.op === "capture" ? null : options.snapshotId !== undefined ? options.snapshotId : state.currentSnapshotId, command,
  });
}

/** Browser/CLI transport over the same runtime-validated contract. Credentials
 * come from a trusted connection and never from role/model fields. */
export class ReviewClient {
  private readonly origin: string;
  private readonly fetcher: typeof fetch;
  private readonly headers: Headers;
  private identity?: ReviewIdentity;

  constructor(options: { origin: string; credential: string; identity?: ReviewIdentity; headers?: HeadersInit; fetch?: typeof fetch }) {
    const url = new URL(options.origin);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new ReviewClientError("invalid_origin");
    this.origin = url.origin;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.headers = new Headers(options.headers);
    this.headers.set(REVIEW_CREDENTIAL_HEADER, options.credential);
    this.identity = options.identity ? reviewIdentitySchema.parse(options.identity) : undefined;
  }

  private bind(identity: ReviewIdentity) {
    if (this.identity && !sameIdentity(identity, this.identity)) throw new ReviewClientError("wrong_review");
    this.identity = { ...identity };
  }

  async state() {
    const state = await this.read("/state", reviewStateSchema);
    this.bind(state.identity);
    return state;
  }

  async handoff(id: string) {
    const payload = await this.read(`/handoffs/${encodeURIComponent(id)}`, reviewHandoffPayloadSchema);
    this.bind(payload.identity);
    if (payload.handoff.id !== id || payload.sent.handoff.id !== id || payload.sent.sequence > payload.version || payload.sent.snapshot.manifest.snapshotId !== payload.sent.handoff.snapshotId) throw new ReviewClientError("invalid_response");
    return payload;
  }

  async legacySource(name: typeof LEGACY_FILES[number], offset = 0, limit = LEGACY_CHUNK_BYTES) {
    if (!LEGACY_FILES.includes(name) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > LEGACY_CHUNK_BYTES) throw new ReviewClientError("invalid_request");
    const page = await this.read(`/legacy/sources/${name}?offset=${offset}&limit=${limit}`, reviewLegacySourcePageSchema);
    this.bind(page.identity);
    let decoded: string;
    try { decoded = atob(page.base64); } catch { throw new ReviewClientError("invalid_response"); }
    const end = Math.min(offset + limit, page.source.bytes);
    if (page.source.name !== name || page.offset !== offset || offset > page.source.bytes || decoded.length !== end - offset || btoa(decoded) !== page.base64 || page.next !== (end < page.source.bytes ? end : null)) throw new ReviewClientError("invalid_response");
    return page;
  }

  /** Recover an original file, with a bounded allocation and verified digest.
   * Reading an old approval does not create a decision in this review. */
  async exportLegacySource(name: typeof LEGACY_FILES[number]) {
    let page = await this.legacySource(name);
    const source = page.source;
    const bytes = new Uint8Array(source.bytes);
    for (;;) {
      if (page.source.sha256 !== source.sha256 || page.source.bytes !== source.bytes) throw new ReviewClientError("invalid_response");
      const chunk = atob(page.base64);
      for (let i = 0; i < chunk.length; i++) bytes[page.offset + i] = chunk.charCodeAt(i);
      if (page.next === null) break;
      page = await this.legacySource(name, page.next);
    }
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
    if (sha256 !== source.sha256) throw new ReviewClientError("invalid_response");
    return { identity: page.identity, provenance: page.provenance, source, bytes };
  }

  async events(cursor: ReviewIdentity & { after: number }, limit = 100) {
    const identity = reviewIdentitySchema.parse({ reviewId: cursor.reviewId, workspaceId: cursor.workspaceId, repositoryId: cursor.repositoryId });
    if (!Number.isSafeInteger(cursor.after) || cursor.after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new ReviewClientError("invalid_request");
    this.bind(identity);
    const query = new URLSearchParams({ ...identity, after: String(cursor.after), limit: String(limit) });
    const page = await this.read(`/events?${query}`, reviewEventsSchema);
    if (!sameIdentity(page.identity, identity) || page.latest < cursor.after) throw new ReviewClientError("invalid_response");
    const end = cursor.after + page.records.length;
    if (end > page.latest || page.next !== (end < page.latest ? end : null) || (page.next !== null && end === cursor.after)) throw new ReviewClientError("invalid_response");
    for (const [index, record] of page.records.entries()) {
      if (record.sequence !== cursor.after + index + 1 || record.events.some((event) => !sameIdentity(event.data.identity, identity))) throw new ReviewClientError("invalid_response");
    }
    return page;
  }

  async execute(input: ReviewRequest) {
    const request = reviewRequestSchema.parse(input);
    this.bind(request);
    const body = JSON.stringify(request);
    if (new TextEncoder().encode(body).byteLength > REVIEW_STORE_LIMITS.recordBytes) throw new ReviewClientError("request_too_large");
    const acknowledgement = await this.read("/operations", reviewAcknowledgementSchema, body);
    const result = acknowledgement.result;
    if (!sameIdentity(result.identity, request) || result.operation !== request.command.op || result.sequence !== request.expectedVersion + 1 ||
      (request.command.op === "capture" ? result.id !== result.snapshotId : result.snapshotId !== request.snapshotId)) {
      throw new ReviewClientError("outcome_unknown", "retry_same_request");
    }
    return acknowledgement;
  }

  private async read<T>(path: string, schema: z.ZodType<T>, body?: string): Promise<T> {
    const unknown = () => new ReviewClientError(body === undefined ? "invalid_response" : "outcome_unknown", body === undefined ? undefined : "retry_same_request");
    const headers = new Headers(this.headers);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await this.fetcher(`${this.origin}/api/review-core${path}`, { method: body === undefined ? "GET" : "POST", headers, body, cache: "no-store", redirect: "error" });
    } catch { throw new ReviewClientError(body === undefined ? "connection_failed" : "outcome_unknown", body === undefined ? "reconnect" : "retry_same_request"); }
    const reader = response.body?.getReader();
    if (!reader) throw unknown();
    let data: unknown;
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const chunks: string[] = [];
      let bytes = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > REVIEW_STORE_LIMITS.replayBytes) throw unknown();
        chunks.push(decoder.decode(chunk.value, { stream: true }));
      }
      chunks.push(decoder.decode());
      data = JSON.parse(chunks.join(""));
    } catch {
      await reader.cancel().catch(() => {});
      throw unknown();
    } finally { reader.releaseLock(); }
    if (!response.ok) {
      const error = errorSchema.safeParse(data);
      if (!error.success) throw unknown();
      // The adapter can fail while producing the response after committing.
      // A generic server failure cannot establish that the operation was rejected.
      if (body !== undefined && error.data.code === "internal_error") throw unknown();
      throw new ReviewClientError(error.data.code, error.data.recovery, response.status, error.data.sequence);
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw unknown();
    return parsed.data;
  }
}
