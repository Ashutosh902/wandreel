import test from "node:test";
import assert from "node:assert/strict";
import { getDatabaseHealthReport, getStuckOperationThresholds } from "./health";

function createHealthMock(options: {
  stuckAddExtraction?: number;
  unresolvedCriticalFailures?: number;
  walletMismatch?: boolean;
  retentionCandidates?: { authSessions?: number; productEvents?: number; failures?: number; location?: number; operationPayloads?: number };
} = {}) {
  const retention = {
    authSessions: options.retentionCandidates?.authSessions ?? 0,
    productEvents: options.retentionCandidates?.productEvents ?? 0,
    failures: options.retentionCandidates?.failures ?? 0,
    location: options.retentionCandidates?.location ?? 0,
    operationPayloads: options.retentionCandidates?.operationPayloads ?? 0,
  };

  return {
    query: async <T = any>(sql: string, params?: unknown[]) => {
      if (sql === "select 1") return { rows: [] as T[], rowCount: 1 };
      if (/select version from schema_migrations/i.test(sql)) {
        return { rows: [{ version: "0008" }] as T[], rowCount: 1 };
      }
      if (/with thresholds\(operation_type, timeout_minutes\)/i.test(sql)) {
        return {
          rows: options.stuckAddExtraction
            ? [{ operation_type: "add_extraction", count: String(options.stuckAddExtraction) }] as T[]
            : [] as T[],
          rowCount: options.stuckAddExtraction ? 1 : 0,
        };
      }
      if (/with tx as \(/i.test(sql) && /from coin_transactions/i.test(sql) && /from coin_wallets/i.test(sql)) {
        return {
          rows: [{
            wallet_liabilities_millis: options.walletMismatch ? "100" : "0",
            reward_pool_balance_millis: "0",
            signup_grants_millis: "0",
            user_charges_millis: "0",
            recommender_rewards_millis: "0",
            platform_retention_millis: "0",
            refunds_millis: "0",
            adjustments_millis: "0",
            wallet_ledger_balance_millis: "0",
          }] as T[],
          rowCount: 1,
        };
      }
      if (/from pg_class c/i.test(sql)) {
        const names = (params?.[0] as string[]) ?? [];
        return {
          rows: names.map((tableName) => ({
            table_name: tableName,
            estimated_row_count: "0",
            total_bytes: "0",
            index_bytes: "0",
            dead_tuple_estimate: "0",
          })) as T[],
          rowCount: names.length,
        };
      }
      if (/select min\(/i.test(sql) && /from /i.test(sql)) {
        return { rows: [{ oldest: null, newest: null }] as T[], rowCount: 1 };
      }
      if (/select count\(\*\)::text as count\s+from auth_sessions/i.test(sql)) {
        if (/revoked_at is not null or ended_at is not null/i.test(sql)) return { rows: [{ count: String(retention.authSessions) }] as T[], rowCount: 1 };
        return { rows: [{ count: "0" }] as T[], rowCount: 1 };
      }
      if (/select count\(\*\)::text as count\s+from app_usage_events/i.test(sql)) {
        if (/where created_at < /i.test(sql)) return { rows: [{ count: String(retention.productEvents) }] as T[], rowCount: 1 };
        return { rows: [{ count: "0" }] as T[], rowCount: 1 };
      }
      if (/select count\(\*\)::text as count\s+from failure_events/i.test(sql)) {
        if (/resolved_at is not null/i.test(sql)) return { rows: [{ count: String(retention.failures) }] as T[], rowCount: 1 };
        if (/severity = 'critical'/i.test(sql)) return { rows: [{ count: String(options.unresolvedCriticalFailures ?? 0) }] as T[], rowCount: 1 };
        return { rows: [{ count: "0" }] as T[], rowCount: 1 };
      }
      if (/select count\(\*\)::text as count\s+from user_location_contexts/i.test(sql)) {
        if (/anonymized_at is null/i.test(sql)) return { rows: [{ count: String(retention.location) }] as T[], rowCount: 1 };
        if (/expires_at is not null/i.test(sql)) return { rows: [{ count: "0" }] as T[], rowCount: 1 };
      }
      if (/select count\(\*\)::text as count\s+from operation_runs/i.test(sql)) {
        if (/input_summary_json <>/i.test(sql)) return { rows: [{ count: String(retention.operationPayloads) }] as T[], rowCount: 1 };
        return { rows: [{ count: "0" }] as T[], rowCount: 1 };
      }
      return { rows: [{ count: "0" }] as T[], rowCount: 1 };
    },
  };
}

test("stuck operation thresholds honor environment overrides", () => {
  const previous = process.env.DB_TIMEOUT_PLACE_SAVE_MINUTES;
  process.env.DB_TIMEOUT_PLACE_SAVE_MINUTES = "7";
  try {
    assert.equal(getStuckOperationThresholds().place_save, 7);
  } finally {
    if (previous === undefined) delete process.env.DB_TIMEOUT_PLACE_SAVE_MINUTES;
    else process.env.DB_TIMEOUT_PLACE_SAVE_MINUTES = previous;
  }
});

test("database health report stays healthy when counters are zero", async () => {
  const report = await getDatabaseHealthReport(createHealthMock() as any);
  assert.equal(report.status, "healthy");
  assert.equal(report.database.migrationVersion, "0008");
  assert.equal(report.retention.cleanupCandidates, 0);
});

test("database health report becomes critical for wallet mismatches and critical failures", async () => {
  const report = await getDatabaseHealthReport(createHealthMock({
    stuckAddExtraction: 2,
    unresolvedCriticalFailures: 1,
    walletMismatch: true,
    retentionCandidates: { productEvents: 5 },
  }) as any);

  assert.equal(report.status, "critical");
  assert.equal(report.wallet.status, "critical");
  assert.equal(report.observability.status, "critical");
  assert.equal(report.retention.status, "warning");
  assert.equal(report.observability.stuckOperations, 2);
});
