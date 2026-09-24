import { reviewProtocolDocument } from "./review-protocol.js";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { ReviewCore, ReviewCoreError } from "./review-core.js";
import { ReviewAuthorityError, reviewIdentitySchema } from "./review-authority.js";
import { REVIEW_STORE_LIMITS, ReviewStoreError } from "./review-store.js";
import { SourceAnchorError } from "./source-anchor.js";
import { InspectCaptureError } from "./inspect-capture.js";
import { REVIEW_CREDENTIAL_HEADER, reviewAcknowledgementSchema, reviewEventsSchema, reviewHandoffPayloadSchema, reviewLegacySourcePageSchema, reviewStateSchema } from "./review-core-contract.js";
import { LEGACY_CHUNK_BYTES, LEGACY_FILES } from "./review-legacy-contract.js";
import { reviewBatchRequestSchema, reviewBatchResultSchema, reviewRecovery } from "./review-operations.js";

export { REVIEW_CREDENTIAL_HEADER } from "./review-core-contract.js";
const count = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const cursorSchema = reviewIdentitySchema.extend({ after: count, limit: count.pipe(z.number().min(1).max(1000)).optional() }).strict();
const legacyPageQuerySchema = z.object({ offset: count.optional(), limit: count.pipe(z.number().min(1).max(LEGACY_CHUNK_BYTES)).optional() }).strict();

/**
 * Optional HTTP adapter for an already owned review. The trusted bootstrap
 * supplies the core and issues grants separately; this API never mints authority
 * from a client role, model label, browser cookie, or legacy session token.
 */
export function createReviewCoreApi(core: ReviewCore | Promise<ReviewCore>): Hono {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof ReviewAuthorityError) return c.json({ code: error.code }, error.code === "forbidden" ? 403 : 401);
    if (error instanceof ReviewCoreError) {
      if (error.code === "forbidden") return c.json({ code: error.code }, 403);
      if (error.code === "not_found") return c.json({ code: error.code }, 404);
      if (error.code === "snapshot_expired") return c.json({ code: error.code, recovery: "capture_source" }, 410);
      if (error.code === "corrupt_review") return c.json({ code: error.code, recovery: "read_only_recovery" }, 503);
      return c.json({ code: error.code }, ["invalid_request", "wrong_review"].includes(error.code) ? 400 : 409);
    }
    if (error instanceof ReviewStoreError) {
      if (error.code === "invalid_request") return c.json({ code: error.code }, 400);
      if (error.code === "store_limit") return c.json({ code: error.code }, 413);
      if (["version_conflict", "idempotency_conflict", "owner_busy", "unsupported_version", "migration_required"].includes(error.code)) return c.json({ code: error.code, ...(error.sequence === undefined ? {} : { sequence: error.sequence }) }, 409);
      return c.json({ code: error.code, recovery: error.code === "outcome_unknown" ? "retry_same_request" : "read_only_recovery" }, 503);
    }
    if (error instanceof SourceAnchorError) return c.json({ code: error.code }, 400);
    if (error instanceof InspectCaptureError) return c.json({ code: error.code }, error.code === "inconsistent_capture" ? 409 : error.code === "unsupported_capture" ? 422 : 503);
    return c.json({ code: "internal_error" }, 500);
  });
  app.use("*", async (c, next) => { c.header("Cache-Control", "no-store"); await next(); });
  app.use("*", bodyLimit({ maxSize: REVIEW_STORE_LIMITS.recordBytes, onError: (c) => c.json({ code: "request_too_large", ...(c.req.header("X-Diffing-Review-Protocol") === "1" ? { recovery: "fix_request" } : {}) }, 413) }));
  app.use("*", async (c, next) => {
    const version = c.req.header("X-Diffing-Review-Protocol");
    if (version !== undefined && version !== "1") return c.json({ code: "unsupported_version", recovery: "upgrade_client" }, 409);
    c.header("X-Diffing-Review-Protocol", "1");
    await next();
    if (version === "1" && c.res.status >= 400) {
      const error = await c.res.clone().json().catch(() => null);
      if (error && typeof error.code === "string" && !error.recovery) {
        c.res = new Response(JSON.stringify({ ...error, recovery: reviewRecovery(error.code) }), { status: c.res.status, headers: c.res.headers });
      }
    }
  });
  app.get("/contract", async (c) => { (await core).capabilities(c.req.header(REVIEW_CREDENTIAL_HEADER) ?? ""); return c.json(reviewProtocolDocument()); });
  app.get("/capabilities", async (c) => c.json((await core).capabilities(c.req.header(REVIEW_CREDENTIAL_HEADER) ?? "")));
  app.get("/next-actions", async (c) => c.json((await core).nextActions(c.req.header(REVIEW_CREDENTIAL_HEADER) ?? "")));
  app.get("/source", async (c) => {
    const query: Record<string, unknown> = c.req.query();
    if (Object.values(c.req.queries()).some((values) => values.length !== 1)) return c.json({ code: "invalid_request", recovery: "fix_request" }, 400);
    for (const name of ["fileIndex", "offset", "limit"]) {
      if (name in query) {
        if (!/^\d+$/.test(String(query[name]))) return c.json({ code: "invalid_request", recovery: "fix_request" }, 400);
        query[name] = Number(query[name]);
      }
    }
    return c.json((await core).source(c.req.header(REVIEW_CREDENTIAL_HEADER) ?? "", query));
  });
  app.get("/state", async (c) => {
    const state = reviewStateSchema.parse((await core).state(c.req.header(REVIEW_CREDENTIAL_HEADER) ?? ""));
    const body = JSON.stringify(state);
    if (Buffer.byteLength(body) > REVIEW_STORE_LIMITS.replayBytes) return c.json({ code: "response_too_large", recovery: "read_events" }, 413);
    return c.body(body, 200, { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" });
  });
  app.get("/handoffs/:id", async (c) => {
    const handoff = reviewHandoffPayloadSchema.parse((await core).handoff(c.req.header(REVIEW_CREDENTIAL_HEADER) ?? "", c.req.param("id")));
    const body = JSON.stringify(handoff);
    if (Buffer.byteLength(body) > REVIEW_STORE_LIMITS.replayBytes) return c.json({ code: "response_too_large", recovery: "read_events" }, 413);
    return c.body(body, 200, { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" });
  });
  app.get("/legacy/sources/:name", async (c) => {
    const archive = (await core).exportLegacy(c.req.header(REVIEW_CREDENTIAL_HEADER) ?? "");
    const query = legacyPageQuerySchema.safeParse(c.req.query());
    const name = z.enum(LEGACY_FILES).safeParse(c.req.param("name"));
    if (!query.success || !name.success || Object.values(c.req.queries()).some((values) => values.length !== 1)) return c.json({ code: "invalid_request" }, 400);
    const source = archive?.sources.find((entry) => entry.name === name.data);
    if (!source) return c.json({ code: "not_found" }, 404);
    const offset = query.data.offset ?? 0;
    if (offset > source.bytes) return c.json({ code: "invalid_request" }, 400);
    const end = Math.min(source.bytes, offset + (query.data.limit ?? LEGACY_CHUNK_BYTES));
    const { base64, ...metadata } = source;
    return c.json(reviewLegacySourcePageSchema.parse({
      identity: (await core).identity, provenance: "legacy-unverified", source: metadata, offset,
      next: end < source.bytes ? end : null,
      base64: Buffer.from(base64, "base64").subarray(offset, end).toString("base64"),
    }));
  });
  app.get("/events", async (c) => {
    const queries = c.req.queries();
    if (Object.values(queries).some((values) => values.length !== 1)) return c.json({ code: "invalid_request" }, 400);
    const parsed = cursorSchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ code: "invalid_request" }, 400);
    const { limit, ...cursor } = parsed.data;
    return c.json(reviewEventsSchema.parse((await core).events(c.req.header(REVIEW_CREDENTIAL_HEADER) ?? "", cursor, limit)), 200, { "Cache-Control": "no-store" });
  });
  app.post("/operations", async (c) => {
    let input: unknown;
    try { input = await c.req.json(); } catch (error) {
      if (error instanceof SyntaxError) return c.json({ code: "invalid_request" }, 400);
      throw error;
    }
    const committed = await (await core).execute(c.req.header(REVIEW_CREDENTIAL_HEADER) ?? "", input);
    return c.json(reviewAcknowledgementSchema.parse({ version: 1, sequence: committed.sequence, result: committed.result }), 200, { "Cache-Control": "no-store" });
  });
  app.post("/batch", async (c) => {
    const owned = await core;
    const credential = c.req.header(REVIEW_CREDENTIAL_HEADER) ?? "";
    owned.capabilities(credential);
    const input = reviewBatchRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ code: "invalid_request", recovery: "fix_request" }, 400);
    const results = [];
    for (const request of input.data.requests) {
      try {
        const committed = await owned.execute(credential, request);
        results.push({ requestId: request.requestId, ok: true as const, acknowledgement: reviewAcknowledgementSchema.parse({ version: 1, sequence: committed.sequence, result: committed.result }) });
      } catch (error) {
        const code = error instanceof ReviewCoreError || error instanceof ReviewAuthorityError || error instanceof ReviewStoreError || error instanceof SourceAnchorError || error instanceof InspectCaptureError ? error.code : "outcome_unknown";
        results.push({ requestId: request.requestId, ok: false as const, error: { code, recovery: reviewRecovery(code), ...(error instanceof ReviewStoreError && error.sequence !== undefined ? { sequence: error.sequence } : {}) } });
      }
    }
    return c.json(reviewBatchResultSchema.parse({ version: 1, mode: "per-item", results }));
  });
  return app;
}
