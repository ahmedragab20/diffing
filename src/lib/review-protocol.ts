import { REVIEW_STORE_LIMITS } from "./review-store-contract.js";
import { z } from "zod";
import { reviewRequestSchema, reviewAcknowledgementSchema, reviewStateSchema, reviewEventsSchema, reviewHandoffPayloadSchema, reviewLegacySourcePageSchema } from "./review-core-contract.js";
import { reviewCapabilitiesSchema, reviewNextActionsSchema, reviewBatchRequestSchema, reviewBatchResultSchema, reviewFailureSchema, reviewOperations, REVIEW_PROTOCOL_VERSION, REVIEW_BATCH_LIMIT } from "./review-operations.js";
import { reviewSourceQuerySchema, reviewSourcePageSchema, REVIEW_SOURCE_LIMITS } from "./review-source-contract.js";
import { reviewConnectionSchema } from "./review-connection-contract.js";

/** Runtime schemas are the source of truth for HTTP, CLI and MCP bindings.
 * The checked-in JSON Schema document is generated from these same objects. */
export function reviewProtocolDocument() {
  const schemas = {
    connection: reviewConnectionSchema, request: reviewRequestSchema, acknowledgement: reviewAcknowledgementSchema,
    failure: reviewFailureSchema, state: reviewStateSchema, events: reviewEventsSchema,
    handoff: reviewHandoffPayloadSchema, legacySource: reviewLegacySourcePageSchema,
    capabilities: reviewCapabilitiesSchema, nextActions: reviewNextActionsSchema,
    batchRequest: reviewBatchRequestSchema, batchResult: reviewBatchResultSchema,
    sourceQuery: reviewSourceQuerySchema, sourcePage: reviewSourcePageSchema,
  };
  return {
    version: REVIEW_PROTOCOL_VERSION,
    negotiation: { requestHeader: "X-Diffing-Review-Protocol", responseHeader: "X-Diffing-Review-Protocol", value: "1" },
    limits: { requestBytes: REVIEW_STORE_LIMITS.recordBytes, responseBytes: REVIEW_STORE_LIMITS.replayBytes, sourcePageBytes: REVIEW_SOURCE_LIMITS.pageBytes, sourceEntries: REVIEW_SOURCE_LIMITS.entries, batchItems: REVIEW_BATCH_LIMIT },
    mutations: Object.values(reviewOperations).map(({ input: _input, output: _output, ...metadata }) => metadata),
    reads: ["capabilities", "state", "next-actions", "source", "events", "handoffs/:id", "legacy/sources/:name", "contract"],
    nativeSubset: { reads: ["capabilities", "state", "next-actions", "source"], mutations: [], classicFallback: false },
    schemas: Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, z.toJSONSchema(schema, { unrepresentable: "any" })])),
  };
}
