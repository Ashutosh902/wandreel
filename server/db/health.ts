import { reconcileCoinEconomy } from "../economy/reconciliation";
import { collectCleanupCandidates } from "./cleanup";

export type HealthQueryable = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

export type HealthStatus = "healthy" | "warning" | "critical";

export type StuckOperationThresholds = Record<string, number>;

export type DatabaseHealthReport = {
  status: HealthStatus;
  checkedAt: string;
  database: {
    migrationVersion: string | null;
    connectionHealthy: boolean;
  };
  wallet: {
    status: HealthStatus;
    walletDiscrepancyMillis: number;
    rewardPoolBalanceMillis: number;
    mismatchedWallets: number;
    negativeBalances: number;
    duplicateIdempotencyKeys: number;
    chargedSavesMissingEvents: number;
    orphanTransactions: number;
  };
  stroll: {
    status: HealthStatus;
    stopsWithoutStroll: number;
    selectedSnapshotsWithoutCanonicalPlace: number;
    succeededJobsMissingReadyStroll: number;
    failedJobsMissingFailureDetail: number;
    shadowFailuresWithoutFailureEvents: number;
  };
  places: {
    status: HealthStatus;
    unresolvedSavedPlaces: number;
    duplicateGooglePlaceIds: number;
    possibleDuplicates: number;
    ambiguousCanonicalPlaces: number;
    evidenceRowsWithoutSourceRecord: number;
  };
  observability: {
    status: HealthStatus;
    stuckOperations: number;
    completedWithoutCompletedAt: number;
    invalidCompletedDurations: number;
    failedOperationsMissingFailureEvents: number;
    mismatchedAuthenticatedEvents: number;
    unresolvedCriticalFailures: number;
    expiredLocationContexts: number;
    criticalFlowsMissingCorrelationIds: number;
    stuckOperationThresholdsMinutes: Record<string, number>;
  };
  auth: {
    status: HealthStatus;
    expiredActiveSessions: number;
    revokedWithoutEndedAt: number;
    endedWithoutReason: number;
    staleSessionsMissingLastSeenAt: number;
  };
  retention: {
    status: HealthStatus;
    cleanupCandidates: number;
    authSessions: number;
    productEvents: number;
    failures: number;
    locationContexts: number;
    operationPayloads: number;
  };
  dataVolume: {
    status: HealthStatus;
    tables: Array<{
      tableName: string;
      estimatedRowCount: number;
      totalBytes: number;
      indexBytes: number;
      deadTupleEstimate: number;
      oldestTimestamp: string | null;
      newestTimestamp: string | null;
    }>;
  };
};

type TableVolumeSpec = {
  tableName: string;
  timestampColumn: string;
};

const DEFAULT_STUCK_THRESHOLDS_MINUTES: Record<string, number> = {
  add_extraction: 10,
  place_save: 2,
  stroll_generation: 15,
  stroll_context_build: 5,
  stroll_snapshot_persistence: 5,
  wallet_debit_reward: 2,
};

const VOLUME_TABLES: TableVolumeSpec[] = [
  { tableName: "app_usage_events", timestampColumn: "created_at" },
  { tableName: "operation_runs", timestampColumn: "started_at" },
  { tableName: "failure_events", timestampColumn: "occurred_at" },
  { tableName: "user_location_contexts", timestampColumn: "captured_at" },
  { tableName: "place_source_evidence", timestampColumn: "observed_at" },
  { tableName: "reel_analytics_attempts", timestampColumn: "created_at" },
  { tableName: "attempt_stage_runs", timestampColumn: "created_at" },
  { tableName: "attempt_evidence", timestampColumn: "created_at" },
];

function toCount(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function toBytes(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function severityFromCounts(criticalCount: number, warningCount = 0): HealthStatus {
  if (criticalCount > 0) return "critical";
  if (warningCount > 0) return "warning";
  return "healthy";
}

function summarizeOverallStatus(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("warning")) return "warning";
  return "healthy";
}

function readThresholdMinutes(name: string, fallback: number) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getStuckOperationThresholds() {
  return {
    add_extraction: readThresholdMinutes("DB_TIMEOUT_ADD_EXTRACTION_MINUTES", DEFAULT_STUCK_THRESHOLDS_MINUTES.add_extraction),
    place_save: readThresholdMinutes("DB_TIMEOUT_PLACE_SAVE_MINUTES", DEFAULT_STUCK_THRESHOLDS_MINUTES.place_save),
    stroll_generation: readThresholdMinutes("DB_TIMEOUT_STROLL_GENERATION_MINUTES", DEFAULT_STUCK_THRESHOLDS_MINUTES.stroll_generation),
    stroll_context_build: readThresholdMinutes("DB_TIMEOUT_STROLL_CONTEXT_BUILD_MINUTES", DEFAULT_STUCK_THRESHOLDS_MINUTES.stroll_context_build),
    stroll_snapshot_persistence: readThresholdMinutes("DB_TIMEOUT_STROLL_SNAPSHOT_PERSISTENCE_MINUTES", DEFAULT_STUCK_THRESHOLDS_MINUTES.stroll_snapshot_persistence),
    wallet_debit_reward: readThresholdMinutes("DB_TIMEOUT_WALLET_OPERATION_MINUTES", DEFAULT_STUCK_THRESHOLDS_MINUTES.wallet_debit_reward),
  } satisfies StuckOperationThresholds;
}

export async function detectStuckOperations(
  database: HealthQueryable,
  thresholds = getStuckOperationThresholds(),
) {
  const operations = Object.entries(thresholds);
  const valuesSql = operations
    .map((_, index) => `($${index * 2 + 1}::text, $${index * 2 + 2}::integer)`)
    .join(", ");
  const params = operations.flatMap(([operationType, minutes]) => [operationType, minutes]);
  const result = await database.query<{
    operation_type: string;
    count: string;
  }>(
    `with thresholds(operation_type, timeout_minutes) as (
       values ${valuesSql}
     )
     select t.operation_type, count(*)::text as count
     from thresholds t
     join operation_runs o
       on o.operation_type = t.operation_type
      and o.status = 'running'
      and o.completed_at is null
      and o.started_at < now() - make_interval(mins => t.timeout_minutes)
     group by t.operation_type`,
    params,
  );
  const counts = Object.fromEntries(operations.map(([operationType]) => [operationType, 0])) as Record<string, number>;
  for (const row of result.rows) counts[row.operation_type] = toCount(row.count);
  return counts;
}

async function getSingleCount(database: HealthQueryable, sql: string, params?: unknown[]) {
  const result = await database.query<{ count: string }>(sql, params);
  return toCount(result.rows[0]?.count);
}

async function getMigrationVersion(database: HealthQueryable) {
  const result = await database.query<{ version: string }>(
    "select version from schema_migrations order by version desc limit 1",
  );
  return result.rows[0]?.version ?? null;
}

async function getDataVolumeReport(database: HealthQueryable) {
  const stats = await database.query<{
    table_name: string;
    estimated_row_count: string;
    total_bytes: string;
    index_bytes: string;
    dead_tuple_estimate: string;
  }>(
    `select
       c.relname as table_name,
       coalesce(s.n_live_tup, 0)::text as estimated_row_count,
       pg_total_relation_size(c.oid)::text as total_bytes,
       pg_indexes_size(c.oid)::text as index_bytes,
       coalesce(s.n_dead_tup, 0)::text as dead_tuple_estimate
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     left join pg_stat_user_tables s on s.relid = c.oid
     where n.nspname = current_schema()
       and c.relname = any($1::text[])`,
    [VOLUME_TABLES.map((table) => table.tableName)],
  );

  const volumes = [];
  for (const table of VOLUME_TABLES) {
    const stat = stats.rows.find((row) => row.table_name === table.tableName);
    const timestampRange = await database.query<{ oldest: string | null; newest: string | null }>(
      `select min(${table.timestampColumn})::text as oldest, max(${table.timestampColumn})::text as newest
       from ${table.tableName}`,
    );
    volumes.push({
      tableName: table.tableName,
      estimatedRowCount: toCount(stat?.estimated_row_count),
      totalBytes: toBytes(stat?.total_bytes),
      indexBytes: toBytes(stat?.index_bytes),
      deadTupleEstimate: toCount(stat?.dead_tuple_estimate),
      oldestTimestamp: timestampRange.rows[0]?.oldest ?? null,
      newestTimestamp: timestampRange.rows[0]?.newest ?? null,
    });
  }

  return {
    status: volumes.some((table) => table.deadTupleEstimate > 100_000 || table.totalBytes > 512 * 1024 * 1024)
      ? "warning" as const
      : "healthy" as const,
    tables: volumes,
  };
}

export async function getDatabaseHealthReport(database: HealthQueryable): Promise<DatabaseHealthReport> {
  await database.query("select 1");

  const checkedAt = new Date().toISOString();
  const migrationVersion = await getMigrationVersion(database);
  const retentionCandidates = await collectCleanupCandidates(database);
  const stuckCounts = await detectStuckOperations(database);
  const stuckOperations = Object.values(stuckCounts).reduce((sum, count) => sum + count, 0);

  const walletReconciliation = await reconcileCoinEconomy(database);
  const [
    mismatchedWallets,
    negativeBalances,
    duplicateIdempotencyKeys,
    chargedSavesMissingEvents,
    orphanTransactions,
    stopsWithoutStroll,
    selectedSnapshotsWithoutCanonicalPlace,
    succeededJobsMissingReadyStroll,
    failedJobsMissingFailureDetail,
    shadowFailuresWithoutFailureEvents,
    unresolvedSavedPlaces,
    duplicateGooglePlaceIds,
    possibleDuplicates,
    ambiguousCanonicalPlaces,
    evidenceRowsWithoutSourceRecord,
    completedWithoutCompletedAt,
    invalidCompletedDurations,
    failedOperationsMissingFailureEvents,
    mismatchedAuthenticatedEvents,
    unresolvedCriticalFailures,
    expiredLocationContexts,
    criticalFlowsMissingCorrelationIds,
    expiredActiveSessions,
    revokedWithoutEndedAt,
    endedWithoutReason,
    staleSessionsMissingLastSeenAt,
  ] = await Promise.all([
    getSingleCount(
      database,
      `with wallet_ledger as (
         select wallet_user_id, coalesce(sum(
           case
             when direction = 'credit' then amount_millis
             when direction = 'debit' then -amount_millis
             else 0
           end
         ), 0)::bigint as ledger_balance
         from coin_transactions
         where wallet_user_id is not null
         group by wallet_user_id
       )
       select count(*)::text as count
       from coin_wallets cw
       left join wallet_ledger wl on wl.wallet_user_id = cw.user_id
       where cw.balance_millis <> coalesce(wl.ledger_balance, 0)`,
    ),
    getSingleCount(database, "select count(*)::text as count from coin_wallets where balance_millis < 0"),
    getSingleCount(
      database,
      `select count(*)::text as count
       from (
         select idempotency_key
         from coin_transactions
         where idempotency_key is not null
         group by idempotency_key
         having count(*) > 1
       ) duplicate_keys`,
    ),
    getSingleCount(
      database,
      `select count(*)::text as count
       from coin_transactions ct
       where ct.type in ('external_save_charge', 'discover_save_charge')
         and (ct.save_event_id is null or not exists (
           select 1 from coin_save_events cse where cse.id = ct.save_event_id
         ))`,
    ),
    getSingleCount(
      database,
      `select count(*)::text as count
       from coin_transactions ct
       where ct.wallet_user_id is not null
         and not exists (
           select 1 from coin_wallets cw where cw.user_id = ct.wallet_user_id
         )`,
    ),
    getSingleCount(
      database,
      `select count(*)::text as count
       from stroll_stops ss
       left join strolls s on s.id = ss.stroll_id
       where s.id is null`,
    ),
    getSingleCount(
      database,
      `select count(*)::text as count
       from stroll_candidate_snapshots
       where selected = true and canonical_place_id is null`,
    ),
    getSingleCount(
      database,
      `select count(*)::text as count
       from stroll_curation_jobs scj
       join strolls s on s.id = scj.stroll_id
       where scj.status = 'succeeded'
         and s.status <> 'ready'`,
    ),
    getSingleCount(
      database,
      `select count(*)::text as count
       from stroll_curation_jobs
       where status = 'failed'
         and (failure_code is null or failure_message is null)`,
    ),
    getSingleCount(
      database,
      `select count(*)::text as count
       from app_usage_events a
       where a.event_type = 'stroll_context_shadow_failed'
         and not exists (
           select 1
           from failure_events f
           where f.error_code = 'stroll_context_shadow_failed'
             and f.entity_type = 'stroll'
             and (
               (f.entity_id is not null and f.entity_id = a.metadata_json->>'strollId')
               or f.user_id = a.user_id
             )
         )`,
    ),
    getSingleCount(database, "select count(*)::text as count from user_saved_places where canonical_place_id is null"),
    getSingleCount(
      database,
      `select count(*)::text as count
       from (
         select google_place_id
         from places
         where google_place_id is not null
         group by google_place_id
         having count(*) > 1
       ) duplicates`,
    ),
    getSingleCount(
      database,
      `select count(*)::text as count
       from (
         select normalized_name,
                round(latitude::numeric, 3) as rounded_latitude,
                round(longitude::numeric, 3) as rounded_longitude
         from places
         where latitude is not null and longitude is not null
         group by normalized_name, round(latitude::numeric, 3), round(longitude::numeric, 3)
         having count(*) > 1
       ) duplicates`,
    ),
    getSingleCount(database, "select count(*)::text as count from places where canonical_status = 'ambiguous'"),
    getSingleCount(
      database,
      `select count(*)::text as count
       from place_source_evidence
       where source_record_id is null`,
    ),
    getSingleCount(
      database,
      `select count(*)::text as count
       from operation_runs
       where status in ('succeeded', 'failed', 'cancelled')
         and completed_at is null`,
    ),
    getSingleCount(
      database,
      `select count(*)::text as count
       from operation_runs
       where status in ('succeeded', 'failed', 'cancelled')
         and duration_ms is not null
         and duration_ms < 0`,
    ),
    getSingleCount(
      database,
      `select count(*)::text as count
       from operation_runs o
       where o.status = 'failed'
         and not exists (
           select 1 from failure_events f where f.operation_run_id = o.id
         )`,
    ),
    getSingleCount(
      database,
      `select count(*)::text as count
       from app_usage_events e
       join auth_sessions s on s.id = e.session_id
       where e.user_id is not null
         and s.user_id <> e.user_id`,
    ),
    getSingleCount(
      database,
      `select count(*)::text as count
       from failure_events
       where resolved_at is null
         and severity = 'critical'`,
    ),
    getSingleCount(
      database,
      `select count(*)::text as count
       from user_location_contexts
       where expires_at is not null
         and expires_at < now()`,
    ),
    getSingleCount(
      database,
      `select count(*)::text as count
       from operation_runs
       where operation_type in (
         'add_extraction',
         'place_save',
         'stroll_generation',
         'stroll_context_build',
         'stroll_snapshot_persistence',
         'wallet_debit_reward'
       )
         and correlation_id is null`,
    ),
    getSingleCount(
      database,
      `select count(*)::text as count
       from auth_sessions
       where expires_at < now()
         and revoked_at is null
         and ended_at is null`,
    ),
    getSingleCount(
      database,
      `select count(*)::text as count
       from auth_sessions
       where revoked_at is not null
         and ended_at is null`,
    ),
    getSingleCount(
      database,
      `select count(*)::text as count
       from auth_sessions
       where ended_at is not null
         and coalesce(end_reason, '') = ''`,
    ),
    getSingleCount(
      database,
      `select count(*)::text as count
       from auth_sessions
       where coalesce(last_seen_at, created_at) < now() - interval '7 days'
         and ended_at is null`,
    ),
  ]);

  const walletStatus = severityFromCounts(
    Number(walletReconciliation.walletDiscrepancyMillis !== 0) + mismatchedWallets + negativeBalances + chargedSavesMissingEvents + orphanTransactions,
    duplicateIdempotencyKeys,
  );
  const strollStatus = severityFromCounts(
    stopsWithoutStroll + selectedSnapshotsWithoutCanonicalPlace + succeededJobsMissingReadyStroll,
    failedJobsMissingFailureDetail + shadowFailuresWithoutFailureEvents,
  );
  const placesStatus = severityFromCounts(
    duplicateGooglePlaceIds,
    unresolvedSavedPlaces + possibleDuplicates + ambiguousCanonicalPlaces + evidenceRowsWithoutSourceRecord,
  );
  const observabilityStatus = severityFromCounts(
    unresolvedCriticalFailures + failedOperationsMissingFailureEvents,
    stuckOperations + completedWithoutCompletedAt + invalidCompletedDurations + mismatchedAuthenticatedEvents + expiredLocationContexts + criticalFlowsMissingCorrelationIds,
  );
  const authStatus = severityFromCounts(
    revokedWithoutEndedAt,
    expiredActiveSessions + endedWithoutReason + staleSessionsMissingLastSeenAt,
  );
  const retentionStatus = severityFromCounts(
    0,
    Object.values(retentionCandidates).reduce((sum, count) => sum + count, 0) > 0 ? 1 : 0,
  );
  const dataVolume = await getDataVolumeReport(database);

  return {
    status: summarizeOverallStatus([walletStatus, strollStatus, placesStatus, observabilityStatus, authStatus, retentionStatus, dataVolume.status]),
    checkedAt,
    database: {
      migrationVersion,
      connectionHealthy: true,
    },
    wallet: {
      status: walletStatus,
      walletDiscrepancyMillis: walletReconciliation.walletDiscrepancyMillis,
      rewardPoolBalanceMillis: walletReconciliation.rewardPoolBalanceMillis,
      mismatchedWallets,
      negativeBalances,
      duplicateIdempotencyKeys,
      chargedSavesMissingEvents,
      orphanTransactions,
    },
    stroll: {
      status: strollStatus,
      stopsWithoutStroll,
      selectedSnapshotsWithoutCanonicalPlace,
      succeededJobsMissingReadyStroll,
      failedJobsMissingFailureDetail,
      shadowFailuresWithoutFailureEvents,
    },
    places: {
      status: placesStatus,
      unresolvedSavedPlaces,
      duplicateGooglePlaceIds,
      possibleDuplicates,
      ambiguousCanonicalPlaces,
      evidenceRowsWithoutSourceRecord,
    },
    observability: {
      status: observabilityStatus,
      stuckOperations,
      completedWithoutCompletedAt,
      invalidCompletedDurations,
      failedOperationsMissingFailureEvents,
      mismatchedAuthenticatedEvents,
      unresolvedCriticalFailures,
      expiredLocationContexts,
      criticalFlowsMissingCorrelationIds,
      stuckOperationThresholdsMinutes: getStuckOperationThresholds(),
    },
    auth: {
      status: authStatus,
      expiredActiveSessions,
      revokedWithoutEndedAt,
      endedWithoutReason,
      staleSessionsMissingLastSeenAt,
    },
    retention: {
      status: retentionStatus,
      cleanupCandidates: Object.values(retentionCandidates).reduce((sum, count) => sum + count, 0),
      authSessions: retentionCandidates["auth-sessions"],
      productEvents: retentionCandidates["product-events"],
      failures: retentionCandidates.failures,
      locationContexts: retentionCandidates.location,
      operationPayloads: retentionCandidates["operation-payloads"],
    },
    dataVolume,
  };
}
