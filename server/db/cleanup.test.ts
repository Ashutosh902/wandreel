import test from "node:test";
import assert from "node:assert/strict";
import { cleanupOperationalData, type CleanupDatabase } from "./cleanup";

function createCleanupMock(initial: {
  authSessions?: number;
  productEvents?: number;
  failures?: number;
  location?: number;
  operationPayloads?: number;
} = {}): CleanupDatabase {
  const state = {
    authSessions: initial.authSessions ?? 0,
    productEvents: initial.productEvents ?? 0,
    failures: initial.failures ?? 0,
    location: initial.location ?? 0,
    operationPayloads: initial.operationPayloads ?? 0,
  };

  const query = async <T = any>(sql: string, params?: unknown[]) => {
    if (/select count\(\*\)::text as count\s+from auth_sessions/i.test(sql)) {
      return { rows: [{ count: String(state.authSessions) }] as T[], rowCount: 1 };
    }
    if (/select count\(\*\)::text as count\s+from app_usage_events/i.test(sql)) {
      return { rows: [{ count: String(state.productEvents) }] as T[], rowCount: 1 };
    }
    if (/select count\(\*\)::text as count\s+from failure_events/i.test(sql)) {
      return { rows: [{ count: String(state.failures) }] as T[], rowCount: 1 };
    }
    if (/select count\(\*\)::text as count\s+from user_location_contexts/i.test(sql)) {
      return { rows: [{ count: String(state.location) }] as T[], rowCount: 1 };
    }
    if (/select count\(\*\)::text as count\s+from operation_runs/i.test(sql)) {
      return { rows: [{ count: String(state.operationPayloads) }] as T[], rowCount: 1 };
    }
    if (/delete from auth_sessions/i.test(sql)) {
      const batchSize = Number(params?.at(-1) ?? 0);
      const affected = Math.min(batchSize, state.authSessions);
      state.authSessions -= affected;
      return { rows: [] as T[], rowCount: affected };
    }
    if (/delete from app_usage_events/i.test(sql)) {
      const batchSize = Number(params?.at(-1) ?? 0);
      const affected = Math.min(batchSize, state.productEvents);
      state.productEvents -= affected;
      return { rows: [] as T[], rowCount: affected };
    }
    if (/delete from failure_events/i.test(sql)) {
      const batchSize = Number(params?.at(-1) ?? 0);
      const affected = Math.min(batchSize, state.failures);
      state.failures -= affected;
      return { rows: [] as T[], rowCount: affected };
    }
    if (/update user_location_contexts ulc/i.test(sql)) {
      const batchSize = Number(params?.[0] ?? 0);
      const affected = Math.min(batchSize, state.location);
      state.location -= affected;
      return { rows: [] as T[], rowCount: affected };
    }
    if (/update operation_runs as target/i.test(sql)) {
      const batchSize = Number(params?.[1] ?? 0);
      const affected = Math.min(batchSize, state.operationPayloads);
      state.operationPayloads -= affected;
      return { rows: [] as T[], rowCount: affected };
    }
    return { rows: [] as T[], rowCount: 0 };
  };

  return {
    query,
    connect: async () => ({
      query: async <T = any>(sql: string, params?: unknown[]) => {
        if (sql === "begin" || sql === "commit" || sql === "rollback") {
          return { rows: [] as T[], rowCount: 0 };
        }
        return query<T>(sql, params);
      },
      release: () => undefined,
    }),
  };
}

test("cleanup dry-run reports only requested categories without mutating state", async () => {
  const database = createCleanupMock({ location: 14, productEvents: 22 });
  const result = await cleanupOperationalData(database, {
    dryRun: true,
    only: ["location"],
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.categories.length, 1);
  assert.equal(result.categories[0]?.category, "location");
  assert.equal(result.categories[0]?.examined, 14);
  assert.equal(result.categories[0]?.anonymized, 0);
});

test("cleanup batches location anonymization and payload scrubbing until exhausted", async () => {
  const database = createCleanupMock({ location: 1200, operationPayloads: 2 });
  const result = await cleanupOperationalData(database, {
    batchSize: 500,
    only: ["location", "operation-payloads"],
  });

  const location = result.categories.find((category) => category.category === "location");
  const payloads = result.categories.find((category) => category.category === "operation-payloads");
  assert.equal(location?.anonymized, 1200);
  assert.equal(location?.batches, 3);
  assert.equal(payloads?.updated, 2);
  assert.equal(payloads?.batches, 1);
  assert.equal(result.totals.anonymized, 1200);
  assert.equal(result.totals.updated, 2);
});
