export type CleanupQueryable = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

type CleanupClient = CleanupQueryable & {
  release: () => void;
};

export type CleanupDatabase = CleanupQueryable & {
  connect: () => Promise<CleanupClient>;
};

export type CleanupCategory =
  | "auth-sessions"
  | "product-events"
  | "failures"
  | "location"
  | "operation-payloads";

export type CleanupRetentionPolicy = {
  authSessionDays: number;
  productEventDays: number;
  resolvedFailureDays: number;
  preciseLocationDays: number;
  operationPayloadDays: number;
};

export type CleanupBucketResult = {
  category: CleanupCategory;
  examined: number;
  deleted: number;
  anonymized: number;
  updated: number;
  skipped: number;
  failed: number;
  batches: number;
};

export type CleanupRunResult = {
  dryRun: boolean;
  batchSize: number;
  categories: CleanupBucketResult[];
  totals: Omit<CleanupBucketResult, "category">;
};

type CleanupOptions = {
  dryRun?: boolean;
  batchSize?: number;
  only?: CleanupCategory[];
  now?: Date;
};

type CleanupCandidateSummary = Record<CleanupCategory, number>;

function readPositiveIntegerEnv(name: string, fallback: number) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function toCount(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function createBucket(category: CleanupCategory): CleanupBucketResult {
  return {
    category,
    examined: 0,
    deleted: 0,
    anonymized: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    batches: 0,
  };
}

export function getCleanupRetentionPolicy(now = new Date()): CleanupRetentionPolicy & { now: Date } {
  return {
    now,
    authSessionDays: readPositiveIntegerEnv("DB_RETENTION_AUTH_SESSION_DAYS", 180),
    productEventDays: readPositiveIntegerEnv("DB_RETENTION_PRODUCT_EVENT_DAYS", 365),
    resolvedFailureDays: readPositiveIntegerEnv("DB_RETENTION_RESOLVED_FAILURE_DAYS", 365),
    preciseLocationDays: readPositiveIntegerEnv("DB_RETENTION_PRECISE_LOCATION_DAYS", 30),
    operationPayloadDays: readPositiveIntegerEnv("DB_RETENTION_OPERATION_PAYLOAD_DAYS", 180),
  };
}

function cutoffIso(now: Date, days: number) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function collectCleanupCandidates(
  database: CleanupQueryable,
  now = new Date(),
): Promise<CleanupCandidateSummary> {
  const policy = getCleanupRetentionPolicy(now);
  const authCutoff = cutoffIso(policy.now, policy.authSessionDays);
  const productCutoff = cutoffIso(policy.now, policy.productEventDays);
  const failureCutoff = cutoffIso(policy.now, policy.resolvedFailureDays);
  const payloadCutoff = cutoffIso(policy.now, policy.operationPayloadDays);

  const [authSessions, productEvents, failures, location, operationPayloads] = await Promise.all([
    database.query<{ count: string }>(
      `select count(*)::text as count
       from auth_sessions
       where expires_at < $1::timestamptz
         and (revoked_at is not null or ended_at is not null or expires_at < now())`,
      [authCutoff],
    ),
    database.query<{ count: string }>(
      `select count(*)::text as count
       from app_usage_events
       where created_at < $1::timestamptz`,
      [productCutoff],
    ),
    database.query<{ count: string }>(
      `select count(*)::text as count
       from failure_events
       where resolved_at is not null
         and resolved_at < $1::timestamptz
         and severity in ('info', 'warning')`,
      [failureCutoff],
    ),
    database.query<{ count: string }>(
      `select count(*)::text as count
       from user_location_contexts
       where expires_at is not null
         and expires_at < now()
         and anonymized_at is null
         and (
           latitude is not null
           or longitude is not null
           or accuracy_meters is not null
         )`,
    ),
    database.query<{ count: string }>(
      `select count(*)::text as count
       from operation_runs
       where completed_at is not null
         and completed_at < $1::timestamptz
         and (
           input_summary_json <> '{}'::jsonb
           or output_summary_json <> '{}'::jsonb
         )`,
      [payloadCutoff],
    ),
  ]);

  return {
    "auth-sessions": toCount(authSessions.rows[0]?.count),
    "product-events": toCount(productEvents.rows[0]?.count),
    failures: toCount(failures.rows[0]?.count),
    location: toCount(location.rows[0]?.count),
    "operation-payloads": toCount(operationPayloads.rows[0]?.count),
  };
}

async function runDeleteBatch(
  client: CleanupClient,
  tableName: string,
  whereSql: string,
  orderBySql: string,
  params: unknown[],
  batchSize: number,
) {
  const result = await client.query<{ id: string }>(
    `with candidates as (
       select id
       from ${tableName}
       where ${whereSql}
       order by ${orderBySql}
       limit $${params.length + 1}
       for update skip locked
     )
     delete from ${tableName} target
     using candidates
     where target.id = candidates.id
     returning target.id`,
    [...params, batchSize],
  );
  return toCount(result.rowCount);
}

async function runUpdateBatch(
  client: CleanupClient,
  sql: string,
  params: unknown[],
) {
  const result = await client.query(sql, params);
  return toCount(result.rowCount);
}

async function executeCategory(
  database: CleanupDatabase,
  category: CleanupCategory,
  batchSize: number,
  now: Date,
  dryRun: boolean,
): Promise<CleanupBucketResult> {
  const bucket = createBucket(category);
  const policy = getCleanupRetentionPolicy(now);
  const authCutoff = cutoffIso(policy.now, policy.authSessionDays);
  const productCutoff = cutoffIso(policy.now, policy.productEventDays);
  const failureCutoff = cutoffIso(policy.now, policy.resolvedFailureDays);
  const payloadCutoff = cutoffIso(policy.now, policy.operationPayloadDays);

  if (dryRun) {
    const candidates = await collectCleanupCandidates(database, now);
    bucket.examined = candidates[category];
    return bucket;
  }

  while (true) {
    const client = await database.connect();
    try {
      await client.query("begin");
      let affected = 0;
      if (category === "auth-sessions") {
        affected = await runDeleteBatch(
          client,
          "auth_sessions",
          "expires_at < $1::timestamptz and (revoked_at is not null or ended_at is not null or expires_at < now())",
          "expires_at asc",
          [authCutoff],
          batchSize,
        );
        bucket.deleted += affected;
      } else if (category === "product-events") {
        affected = await runDeleteBatch(
          client,
          "app_usage_events",
          "created_at < $1::timestamptz",
          "created_at asc",
          [productCutoff],
          batchSize,
        );
        bucket.deleted += affected;
      } else if (category === "failures") {
        affected = await runDeleteBatch(
          client,
          "failure_events",
          "resolved_at is not null and resolved_at < $1::timestamptz and severity in ('info', 'warning')",
          "resolved_at asc",
          [failureCutoff],
          batchSize,
        );
        bucket.deleted += affected;
      } else if (category === "location") {
        affected = await runUpdateBatch(
          client,
          `with candidates as (
             select id
             from user_location_contexts
             where expires_at is not null
               and expires_at < now()
               and anonymized_at is null
               and (
                 latitude is not null
                 or longitude is not null
                 or accuracy_meters is not null
               )
             order by expires_at asc
             limit $1
             for update skip locked
           )
           update user_location_contexts ulc
           set latitude = null,
               longitude = null,
               accuracy_meters = null,
               anonymized_at = now(),
               retention_class = case
                 when retention_class = 'city_level' then retention_class
                 else 'city_level'
               end
           from candidates
           where ulc.id = candidates.id`,
          [batchSize],
        );
        bucket.anonymized += affected;
      } else if (category === "operation-payloads") {
        affected = await runUpdateBatch(
          client,
          `with candidates as (
             select id
             from operation_runs
             where completed_at is not null
               and completed_at < $1::timestamptz
               and (
                 input_summary_json <> '{}'::jsonb
                 or output_summary_json <> '{}'::jsonb
               )
             order by completed_at asc
             limit $2
             for update skip locked
           )
           update operation_runs as target
           set input_summary_json = '{}'::jsonb,
               output_summary_json = '{}'::jsonb
           from candidates
           where target.id = candidates.id`,
          [payloadCutoff, batchSize],
        );
        bucket.updated += affected;
      }

      await client.query("commit");
      if (affected === 0) break;
      bucket.examined += affected;
      bucket.batches += 1;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      bucket.failed += 1;
      throw error;
    } finally {
      client.release();
    }
  }

  return bucket;
}

export async function cleanupOperationalData(
  database: CleanupDatabase,
  options: CleanupOptions = {},
): Promise<CleanupRunResult> {
  const batchSize = Math.max(1, Math.min(5_000, options.batchSize ?? 500));
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const categories = (options.only?.length
    ? options.only
    : (["auth-sessions", "product-events", "failures", "location", "operation-payloads"] as CleanupCategory[]));

  const results: CleanupBucketResult[] = [];
  for (const category of categories) {
    results.push(await executeCategory(database, category, batchSize, now, dryRun));
  }

  return {
    dryRun,
    batchSize,
    categories: results,
    totals: results.reduce(
      (totals, result) => ({
        examined: totals.examined + result.examined,
        deleted: totals.deleted + result.deleted,
        anonymized: totals.anonymized + result.anonymized,
        updated: totals.updated + result.updated,
        skipped: totals.skipped + result.skipped,
        failed: totals.failed + result.failed,
        batches: totals.batches + result.batches,
      }),
      {
        examined: 0,
        deleted: 0,
        anonymized: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        batches: 0,
      },
    ),
  };
}
