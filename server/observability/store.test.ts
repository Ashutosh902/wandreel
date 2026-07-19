import test from "node:test";
import assert from "node:assert/strict";
import {
  completeOperationRun,
  createOperationRun,
  isAllowedProductEventType,
  recordFailureEvent,
  recordLocationContext,
  recordProductEvent,
  touchSession,
} from "./store";

type QueryCall = {
  sql: string;
  params: unknown[] | undefined;
};

function createDatabaseMock() {
  const calls: QueryCall[] = [];
  return {
    calls,
    db: {
      query: async <T = any>(sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        if (/returning id/i.test(sql)) {
          return { rows: [{ id: "00000000-0000-4000-8000-000000000001" } as T], rowCount: 1 };
        }
        return { rows: [] as T[], rowCount: 1 };
      },
    },
  };
}

test("product event allowlist accepts meaningful events and rejects arbitrary names", () => {
  assert.equal(isAllowedProductEventType("screen_viewed"), true);
  assert.equal(isAllowedProductEventType("mouse_moved"), false);
});

test("recordProductEvent writes server-scoped event columns without trusting arbitrary metadata size", async () => {
  const mock = createDatabaseMock();
  const id = await recordProductEvent(mock.db, {
    eventType: "place_save_succeeded",
    userId: "00000000-0000-4000-8000-000000000011",
    sessionId: "00000000-0000-4000-8000-000000000012",
    anonymousId: "anon-1",
    requestId: "req-1",
    operationRunId: "00000000-0000-4000-8000-000000000013",
    entityType: "place",
    entityId: "place-1",
    routeName: "add",
    sourceSurface: "add",
    outcome: "succeeded",
    durationMs: 123,
    metadata: { safe: true },
  });

  assert.equal(id, "00000000-0000-4000-8000-000000000001");
  assert.match(mock.calls[0]?.sql || "", /insert into app_usage_events/i);
  assert.equal(mock.calls[0]?.params?.[1], "place_save_succeeded");
  assert.equal(mock.calls[0]?.params?.[12], 123);
  assert.equal(mock.calls[0]?.params?.[14], JSON.stringify({ safe: true }));

  await assert.rejects(
    () => recordProductEvent(mock.db, {
      eventType: "screen_viewed",
      metadata: { large: "x".repeat(9000) },
    }),
    /metadata_json exceeds observability size limit/,
  );
});

test("operation runs can be created and completed with database-calculated duration", async () => {
  const mock = createDatabaseMock();
  const operationRunId = await createOperationRun(mock.db, {
    operationType: "add_extraction",
    userId: "00000000-0000-4000-8000-000000000011",
    requestId: "req-1",
    correlationId: "corr-1",
    entityType: "submitted_link",
    entityId: "hash-1",
    attemptCount: 2,
    inputSummary: { route: "stream" },
  });
  await completeOperationRun(mock.db, {
    operationRunId: operationRunId!,
    status: "succeeded",
    outputSummary: { totalMs: 250 },
  });

  assert.match(mock.calls[0]?.sql || "", /insert into operation_runs/i);
  assert.equal(mock.calls[0]?.params?.[1], "add_extraction");
  assert.equal(mock.calls[0]?.params?.[9], 2);
  assert.match(mock.calls[1]?.sql || "", /duration_ms = greatest/i);
  assert.equal(mock.calls[1]?.params?.[1], "succeeded");
});

test("failure events persist customer and operation correlation", async () => {
  const mock = createDatabaseMock();
  await recordFailureEvent(mock.db, {
    scope: "customer",
    severity: "error",
    errorCode: "extraction_failed",
    errorCategory: "add_extraction",
    userId: "00000000-0000-4000-8000-000000000011",
    requestId: "req-1",
    operationRunId: "00000000-0000-4000-8000-000000000013",
    publicMessage: "Extraction failed",
    internalMessage: "provider timeout",
    retryable: true,
    attemptNumber: 3,
  });

  assert.match(mock.calls[0]?.sql || "", /insert into failure_events/i);
  assert.equal(mock.calls[0]?.params?.[1], "customer");
  assert.equal(mock.calls[0]?.params?.[3], "extraction_failed");
  assert.equal(mock.calls[0]?.params?.[16], true);
});

test("location contexts set short expiry for precise feature location", async () => {
  const mock = createDatabaseMock();
  await recordLocationContext(mock.db, {
    userId: "00000000-0000-4000-8000-000000000011",
    source: "stroll_start",
    latitude: 25.61,
    longitude: 85.14,
    accuracyMeters: 20,
    city: "Patna",
    permissionStatus: "granted",
    consentSource: "stroll_create_form",
  });

  assert.match(mock.calls[0]?.sql || "", /insert into user_location_contexts/i);
  assert.equal(mock.calls[0]?.params?.[3], "stroll_start");
  assert.equal(mock.calls[0]?.params?.[4], 25.61);
  assert.equal(typeof mock.calls[0]?.params?.[12], "string");
});

test("touchSession records last seen and bounded device hints", async () => {
  const mock = createDatabaseMock();
  await touchSession(mock.db, {
    sessionId: "00000000-0000-4000-8000-000000000012",
    clientPlatform: "web",
    appVersion: "1.0.0",
    deviceMetadata: { userAgentFamily: "test" },
  });

  assert.match(mock.calls[0]?.sql || "", /update auth_sessions/i);
  assert.equal(mock.calls[0]?.params?.[1], "web");
  assert.equal(mock.calls[0]?.params?.[3], JSON.stringify({ userAgentFamily: "test" }));
});
