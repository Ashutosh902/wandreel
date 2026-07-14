import "dotenv/config";
import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runDatabaseMigrations } from "../db/migrations";
import { createSession, __resetPostgresTestConfig, __setPostgresTestConfig } from "../auth/postgresAuth";
import {
  chargeSavedPlaceCoins,
  completeCoinOnboarding,
  getCoinImpact,
  getCoinLedger,
  getCoinOnboardingState,
  grantFirstLoginCoins,
} from "./store";
import { reconcileCoinEconomy } from "./reconciliation";

type PgPool = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>;
  connect: () => Promise<{
    query: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>;
    release: () => void;
  }>;
};

const baseDatabaseUrl = process.env.COIN_ECONOMY_TEST_DATABASE_URL || process.env.DATABASE_URL || "";
const shouldRun = Boolean(baseDatabaseUrl && process.env.COIN_ECONOMY_REAL_PG === "1");
const schemaName = `coin_economy_test_${process.pid}_${Date.now()}`.toLowerCase();

let adminPool: Pool | null = null;
let rawTestPool: Pool | null = null;
let testPool: PgPool | null = null;
let postgresVersion = "";

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function withSchemaSearchPath(pool: Pool, schema: string): PgPool {
  const searchPathSql = `set search_path to ${quoteIdentifier(schema)}, public`;
  return {
    query: async (sql: string, params?: unknown[]) => {
      const client = await pool.connect();
      try {
        await client.query(searchPathSql);
        return await client.query(sql, params) as { rows: any[]; rowCount: number | null };
      } finally {
        client.release();
      }
    },
    connect: async () => {
      const client = await pool.connect();
      await client.query(searchPathSql);
      return {
        query: async (sql: string, params?: unknown[]) => {
          await client.query(searchPathSql);
          return await client.query(sql, params) as { rows: any[]; rowCount: number | null };
        },
        release: () => client.release(),
      };
    },
  };
}

function requirePool() {
  if (!testPool) throw new Error("test pool not initialized");
  return testPool;
}

async function createUser(id: string, email = `${id}@example.test`) {
  await requirePool().query(
    `
      insert into users (id, email, email_verified, display_name, auth_provider, created_at, updated_at)
      values ($1, $2, true, $3, 'EMAIL', now(), now())
      on conflict (id) do nothing
    `,
    [id, email, id],
  );
}

async function setWallet(userId: string, balanceMillis: number) {
  const pool = requirePool();
  await pool.query(
    `
      insert into coin_wallets (user_id, balance_millis, created_at, updated_at)
      values ($1, $2, now(), now())
      on conflict (user_id)
      do update set balance_millis = excluded.balance_millis, updated_at = now()
    `,
    [userId, balanceMillis],
  );
  await pool.query(
    `
      insert into coin_transactions (
        id, user_id, wallet_user_id, idempotency_key, type, direction,
        amount_millis, balance_after_millis, metadata_json, created_at
      )
      values (gen_random_uuid(), $1, $1, $2, 'adjustment', 'credit', $3, $3, $4::jsonb, now())
      on conflict (idempotency_key) do nothing
    `,
    [userId, `test-wallet-seed:${userId}:${balanceMillis}`, balanceMillis, JSON.stringify({ reason: "test_seed" })],
  );
}

async function countRows(table: string, whereSql = "true", params: unknown[] = []) {
  const result = await requirePool().query<{ count: string }>(`select count(*)::text as count from ${table} where ${whereSql}`, params);
  return Number(result.rows[0]?.count ?? 0);
}

async function savePlace(userId: string, placeId: string, global = false) {
  await requirePool().query(
    `
      insert into user_saved_places (id, user_id, place_id, title, category, metadata_json, created_at, updated_at)
      values (gen_random_uuid(), $1, $2, $3, 'Taste', $4::jsonb, now(), now())
      on conflict (user_id, place_id)
      do update set metadata_json = excluded.metadata_json, updated_at = now()
    `,
    [
      userId,
      placeId,
      `Place ${placeId}`,
      JSON.stringify({ locality: "Patna", fullAddress: "Patna", sharedVisibility: global ? "global" : "private", isGlobal: global }),
    ],
  );
}

async function chargeSave(input: {
  userId: string;
  placeId: string;
  source: "external_import" | "discover";
  idempotencyKey: string;
  failAfterPlaceInsert?: boolean;
  afterSnapshot?: (snapshot: string[]) => Promise<void>;
}) {
  return chargeSavedPlaceCoins({
    database: requirePool(),
    userId: input.userId,
    placeId: input.placeId,
    source: input.source,
    idempotencyKey: input.idempotencyKey,
    metadata: { test: true },
    afterSnapshot: input.afterSnapshot,
    commitWithCharge: async (client) => {
      await client.query(
        `
          insert into user_saved_places (id, user_id, place_id, title, category, metadata_json, created_at, updated_at)
          values (gen_random_uuid(), $1, $2, $3, 'Taste', '{}'::jsonb, now(), now())
        `,
        [input.userId, input.placeId, `Saved ${input.placeId}`],
      );
      if (input.failAfterPlaceInsert) {
        throw new Error("INJECTED_REWARD_FAILURE");
      }
    },
  });
}

test.before(async () => {
  if (!shouldRun) return;
  adminPool = new Pool({
    connectionString: baseDatabaseUrl,
    ssl: baseDatabaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });
  await adminPool.query(`create schema ${schemaName}`);
  const versionResult = await adminPool.query<{ version: string }>("select version()");
  postgresVersion = versionResult.rows[0]?.version || "";

  rawTestPool = new Pool({
    connectionString: baseDatabaseUrl,
    ssl: baseDatabaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
    max: 30,
  });
  testPool = withSchemaSearchPath(rawTestPool, schemaName);
  await runDatabaseMigrations({ database: testPool as any });
  __setPostgresTestConfig({
    databaseOverride: testPool as any,
    databaseUrlOverride: baseDatabaseUrl,
    schemaReadyOverride: true,
  });
});

test.after(async () => {
  __resetPostgresTestConfig();
  await rawTestPool?.end();
  if (adminPool) {
    await adminPool.query(`drop schema if exists ${schemaName} cascade`).catch(() => undefined);
    await adminPool.end();
  }
});

test("real PostgreSQL version is captured", { skip: !shouldRun }, async () => {
  assert.match(postgresVersion, /PostgreSQL/i);
  assert.match(schemaName, /^coin_economy_test_/);
});

test("20 simultaneous first-login grants create exactly one signup grant", { skip: !shouldRun }, async () => {
  const userId = randomUUID();
  await createUser(userId);
  await Promise.all(Array.from({ length: 20 }, () => grantFirstLoginCoins(requirePool(), userId)));

  const wallet = await requirePool().query<{ balance_millis: string }>("select balance_millis::text from coin_wallets where user_id = $1", [userId]);
  assert.equal(Number(wallet.rows[0]?.balance_millis), 500_000);
  assert.equal(await countRows("coin_transactions", "wallet_user_id = $1 and type = 'signup_grant'", [userId]), 1);

  await Promise.all(Array.from({ length: 20 }, () => createSession(userId)));
  assert.equal(await countRows("coin_transactions", "wallet_user_id = $1 and type = 'signup_grant'", [userId]), 1);
});

test("coin onboarding is created only by a successful first-login grant and completes idempotently", { skip: !shouldRun }, async () => {
  const userId = randomUUID();
  await createUser(userId);
  assert.deepEqual(await getCoinOnboardingState(requirePool(), userId), {
    completed: true,
    completedAt: null,
    eligible: false,
  });

  const beforeGrantTransactions = await countRows("coin_transactions", "wallet_user_id = $1", [userId]);
  await grantFirstLoginCoins(requirePool(), userId);
  const afterGrantState = await getCoinOnboardingState(requirePool(), userId);
  assert.equal(afterGrantState.completed, false);
  assert.equal(afterGrantState.completedAt, null);
  assert.equal(afterGrantState.eligible, true);

  const walletBeforeComplete = await requirePool().query<{ balance_millis: string }>(
    "select balance_millis::text from coin_wallets where user_id = $1",
    [userId],
  );
  const txBeforeComplete = await countRows("coin_transactions", "wallet_user_id = $1", [userId]);
  const firstComplete = await completeCoinOnboarding(requirePool(), userId);
  const secondComplete = await completeCoinOnboarding(requirePool(), userId);
  assert.equal(firstComplete.completed, true);
  assert.equal(secondComplete.completedAt, firstComplete.completedAt);
  const walletAfterComplete = await requirePool().query<{ balance_millis: string }>(
    "select balance_millis::text from coin_wallets where user_id = $1",
    [userId],
  );
  assert.equal(walletAfterComplete.rows[0]?.balance_millis, walletBeforeComplete.rows[0]?.balance_millis);
  assert.equal(await countRows("coin_transactions", "wallet_user_id = $1", [userId]), txBeforeComplete);
  assert.equal(txBeforeComplete, beforeGrantTransactions + 1);
});

test("rolled back onboarding preference write does not make a user eligible", { skip: !shouldRun }, async () => {
  const userId = randomUUID();
  await createUser(userId);
  const client = await requirePool().connect();
  try {
    await client.query("begin");
    await client.query(
      `
        insert into coin_onboarding_preferences (user_id, eligible, coin_onboarding_completed_at, created_at, updated_at)
        values ($1, true, null, now(), now())
      `,
      [userId],
    );
    await client.query("rollback");
  } finally {
    client.release();
  }
  const state = await getCoinOnboardingState(requirePool(), userId);
  assert.equal(state.eligible, false);
  assert.equal(state.completed, true);
});

test("20 simultaneous saves with same idempotency key produce one charge and one save event", { skip: !shouldRun }, async () => {
  const userId = randomUUID();
  await createUser(userId);
  await setWallet(userId, 10_000);
  const results = await Promise.all(Array.from({ length: 20 }, () => chargeSave({
    userId,
    placeId: "same-key-place",
    source: "external_import",
    idempotencyKey: "same-key",
  })));

  assert.equal(new Set(results.map((result) => result.saveEvent.id)).size, 1);
  assert.equal(await countRows("coin_save_events", "user_id = $1 and place_id = $2", [userId, "same-key-place"]), 1);
  assert.equal(await countRows("coin_transactions", "wallet_user_id = $1 and type = 'external_save_charge'", [userId]), 1);
  const wallet = await requirePool().query<{ balance_millis: string }>("select balance_millis::text from coin_wallets where user_id = $1", [userId]);
  assert.equal(Number(wallet.rows[0]?.balance_millis), 8_000);
});

test("different concurrent saves cannot overdraw a wallet", { skip: !shouldRun }, async () => {
  const userId = randomUUID();
  await createUser(userId);
  await setWallet(userId, 2_000);
  const settled = await Promise.allSettled(Array.from({ length: 20 }, (_unused, index) => chargeSave({
    userId,
    placeId: `limited-place-${index}`,
    source: "external_import",
    idempotencyKey: `limited-${index}`,
  })));

  assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(settled.filter((result) => result.status === "rejected").length, 19);
  const wallet = await requirePool().query<{ balance_millis: string }>("select balance_millis::text from coin_wallets where user_id = $1", [userId]);
  assert.equal(Number(wallet.rows[0]?.balance_millis), 0);
  assert.equal(await countRows("coin_wallets", "balance_millis < 0"), 0);
});

test("concurrent Discover saves use independent recommender snapshots and conserve millis", { skip: !shouldRun }, async () => {
  const placeId = "global-recommended-place";
  const recommenders = Array.from({ length: 5 }, () => randomUUID());
  for (const recommender of recommenders) {
    await createUser(recommender);
    await savePlace(recommender, placeId, true);
  }
  const savers = Array.from({ length: 10 }, () => randomUUID());
  for (const saver of savers) {
    await createUser(saver);
    await setWallet(saver, 1_000);
  }

  const results = await Promise.all(savers.map((saver) => chargeSave({
    userId: saver,
    placeId,
    source: "discover",
    idempotencyKey: `discover-${saver}`,
  })));

  assert.ok(results.every((result) => result.saveEvent.recommenderSnapshot.length === 5));
  assert.ok(results.every((result) => result.saveEvent.rewardDistribution.reduce((sum, reward) => sum + reward.amountMillis, 0) === 500));
  const reconciliation = await reconcileCoinEconomy(requirePool());
  assert.equal(reconciliation.walletDiscrepancyMillis, 0);
});

test("impact dashboard aggregates from real snapshots and ledger rows", { skip: !shouldRun }, async () => {
  const owner = randomUUID();
  const otherRecommender = randomUUID();
  const saverOne = randomUUID();
  const saverTwo = randomUUID();
  await createUser(owner);
  await createUser(otherRecommender);
  await createUser(saverOne);
  await createUser(saverTwo);
  await setWallet(owner, 5_000);
  await setWallet(saverOne, 2_000);
  await setWallet(saverTwo, 2_000);
  await savePlace(owner, "impact-top-one", true);
  await savePlace(owner, "impact-top-two", true);
  await savePlace(otherRecommender, "impact-other-place", true);

  await chargeSave({
    userId: saverOne,
    placeId: "impact-top-one",
    source: "discover",
    idempotencyKey: "impact-saver-one",
  });
  await chargeSave({
    userId: saverTwo,
    placeId: "impact-top-one",
    source: "discover",
    idempotencyKey: "impact-saver-two",
  });
  await chargeSave({
    userId: owner,
    placeId: "impact-external-own",
    source: "external_import",
    idempotencyKey: "impact-owner-external",
  });
  await chargeSave({
    userId: owner,
    placeId: "impact-other-place",
    source: "discover",
    idempotencyKey: "impact-owner-discover",
  });

  const impact = await getCoinImpact(requirePool(), owner);

  assert.equal(impact.wallet.balanceMillis, 3_000);
  assert.equal(impact.month.earnedMillis, 1_000);
  assert.equal(impact.month.spentMillis, 3_000);
  assert.equal(impact.month.netMillis, -2_000);
  assert.equal(impact.impact.travelersHelped, 2);
  assert.equal(impact.impact.communitySaves, 2);
  assert.equal(impact.impact.placesRecommended, 2);
  assert.equal(impact.impact.placesAdded, 4);
  assert.equal(impact.impact.coinsEarnedMillis, 1_000);
  assert.equal(impact.impact.coinsSavedMillis, 1_000);
  assert.equal(impact.summary30Days.recommendations, 2);
  assert.equal(impact.summary30Days.communitySaves, 2);
  assert.equal(impact.summary30Days.coinsEarnedMillis, 1_000);
  assert.equal(impact.summary30Days.coinsSavedMillis, 1_000);
  assert.equal(impact.topRecommendations[0]?.placeId, "impact-top-one");
  assert.equal(impact.topRecommendations[0]?.communitySaves, 2);
  assert.equal(impact.topRecommendations[0]?.coinsEarnedMillis, 1_000);
  assert.equal(impact.monthlyTrend.length, 6);
  assert.ok(impact.contributionScore.score > 0);
  assert.equal(impact.cache.maxAgeSeconds, 60);
});

test("recommendations added during a save do not alter the captured snapshot", { skip: !shouldRun }, async () => {
  const userId = randomUUID();
  const early = randomUUID();
  const late = randomUUID();
  const placeId = "snapshot-place";
  await createUser(userId);
  await createUser(early);
  await createUser(late);
  await setWallet(userId, 1_000);
  await savePlace(early, placeId, true);

  let releaseSnapshot: () => void = () => undefined;
  let markSnapshotReached: () => void = () => undefined;
  const snapshotReached = new Promise<void>((resolve) => {
    markSnapshotReached = resolve;
  });
  const snapshotGate = new Promise<void>((resolve) => {
    releaseSnapshot = resolve;
  });
  const savePromise = chargeSave({
    userId,
    placeId,
    source: "discover",
    idempotencyKey: "snapshot-save",
    afterSnapshot: async () => {
      markSnapshotReached();
      await snapshotGate;
    },
  });
  await snapshotReached;
  await savePlace(late, placeId, true);
  releaseSnapshot();
  const result = await savePromise;

  assert.deepEqual(result.saveEvent.recommenderSnapshot, [early]);

  const futureUser = randomUUID();
  await createUser(futureUser);
  await setWallet(futureUser, 1_000);
  const futureResult = await chargeSave({
    userId: futureUser,
    placeId,
    source: "discover",
    idempotencyKey: "snapshot-future-save",
  });
  assert.deepEqual(futureResult.saveEvent.recommenderSnapshot.sort(), [early, late].sort());
});

test("injected failure rolls back charge, place, ledger, save event, and rewards", { skip: !shouldRun }, async () => {
  const userId = randomUUID();
  const recommender = randomUUID();
  const placeId = "rollback-place";
  await createUser(userId);
  await createUser(recommender);
  await setWallet(userId, 1_000);
  await savePlace(recommender, placeId, true);

  await assert.rejects(() => chargeSave({
    userId,
    placeId,
    source: "discover",
    idempotencyKey: "rollback-key",
    failAfterPlaceInsert: true,
  }), /INJECTED_REWARD_FAILURE/);

  const wallet = await requirePool().query<{ balance_millis: string }>("select balance_millis::text from coin_wallets where user_id = $1", [userId]);
  assert.equal(Number(wallet.rows[0]?.balance_millis), 1_000);
  assert.equal(await countRows("coin_save_events", "idempotency_key = $1", ["rollback-key"]), 0);
  assert.equal(await countRows("coin_transactions", "related_place_id = $1", [placeId]), 0);
  assert.equal(await countRows("user_saved_places", "user_id = $1 and place_id = $2", [userId, placeId]), 0);
});

test("insufficient balance prevents all related writes", { skip: !shouldRun }, async () => {
  const userId = randomUUID();
  await createUser(userId);
  await setWallet(userId, 999);

  await assert.rejects(() => chargeSave({
    userId,
    placeId: "too-expensive",
    source: "discover",
    idempotencyKey: "insufficient-key",
  }), /INSUFFICIENT_COINS/);

  assert.equal(await countRows("coin_save_events", "idempotency_key = $1", ["insufficient-key"]), 0);
  assert.equal(await countRows("coin_transactions", "wallet_user_id = $1 and type = 'discover_save_charge'", [userId]), 0);
  assert.equal(await countRows("user_saved_places", "user_id = $1 and place_id = $2", [userId, "too-expensive"]), 0);
});

test("ledger references are internally consistent and reconciliation balances", { skip: !shouldRun }, async () => {
  assert.equal(await countRows("coin_transactions", "save_event_id is not null and save_event_id not in (select id from coin_save_events)"), 0);
  assert.equal(await countRows("coin_save_events", "charge_millis <> reward_pool_millis + platform_retention_millis"), 0);
  assert.equal(await countRows("coin_wallets", "balance_millis < 0"), 0);
  const reconciliation = await reconcileCoinEconomy(requirePool());
  assert.equal(reconciliation.walletDiscrepancyMillis, 0);
  assert.equal(
    reconciliation.signupGrantsMillis + reconciliation.recommenderRewardsMillis + reconciliation.adjustmentsMillis - reconciliation.userChargesMillis,
    reconciliation.walletLiabilitiesMillis,
  );
});

test("real ledger query filters, sorts, and paginates wallet transactions", { skip: !shouldRun }, async () => {
  const userId = randomUUID();
  await createUser(userId);
  await requirePool().query(
    `
      insert into coin_wallets (user_id, balance_millis, created_at, updated_at)
      values ($1, 50000, now(), now())
    `,
    [userId],
  );
  for (let index = 1; index <= 51; index += 1) {
    const direction = index % 2 === 0 ? "debit" : "credit";
    await requirePool().query(
      `
        insert into coin_transactions (
          id, user_id, wallet_user_id, idempotency_key, type, direction,
          amount_millis, balance_after_millis, metadata_json, created_at
        )
        values (
          gen_random_uuid(), $1, $1, $2, 'adjustment', $3,
          $4, 50000, $5::jsonb, now() - ($6::text || ' minutes')::interval
        )
      `,
      [userId, `ledger-page:${userId}:${index}`, direction, index, JSON.stringify({ title: `Ledger ${index}` }), 52 - index],
    );
  }

  const firstPage = await getCoinLedger(requirePool(), userId, { page: 1, pageSize: 25, sort: "newest", datePreset: "6m" });
  assert.equal(firstPage.transactions.length, 25);
  assert.equal(firstPage.pagination.pageSize, 25);
  assert.equal(firstPage.pagination.totalCount, 51);
  assert.equal(firstPage.pagination.totalPages, 3);
  assert.equal(firstPage.transactions[0].amountMillis, 51);

  const thirdPage = await getCoinLedger(requirePool(), userId, { page: 3, pageSize: 25, sort: "newest", datePreset: "6m" });
  assert.equal(thirdPage.transactions.length, 1);
  assert.equal(thirdPage.transactions[0].amountMillis, 1);

  const credits = await getCoinLedger(requirePool(), userId, { type: "credit", page: 1, pageSize: 25, datePreset: "6m" });
  assert.equal(credits.pagination.totalCount, 26);
  assert.ok(credits.transactions.every((transaction) => transaction.direction === "credit"));

  const debits = await getCoinLedger(requirePool(), userId, { type: "debit", page: 1, pageSize: 25, datePreset: "6m" });
  assert.equal(debits.pagination.totalCount, 25);
  assert.ok(debits.transactions.every((transaction) => transaction.direction === "debit"));

  const oldest = await getCoinLedger(requirePool(), userId, { sort: "oldest", page: 1, pageSize: 25, datePreset: "6m" });
  assert.equal(oldest.transactions[0].amountMillis, 1);

  const amountDescending = await getCoinLedger(requirePool(), userId, { sort: "amount_desc", page: 1, pageSize: 25, datePreset: "6m" });
  assert.equal(amountDescending.transactions[0].amountMillis, 51);
  assert.equal(amountDescending.transactions[24].amountMillis, 27);

  const amountAscending = await getCoinLedger(requirePool(), userId, { sort: "amount_asc", page: 1, pageSize: 999, datePreset: "6m" });
  assert.equal(amountAscending.transactions.length, 25);
  assert.equal(amountAscending.pagination.pageSize, 25);
  assert.equal(amountAscending.transactions[0].amountMillis, 1);
  assert.equal(amountAscending.transactions[24].amountMillis, 25);

  const sevenDays = await getCoinLedger(requirePool(), userId, { datePreset: "7d", page: 1, pageSize: 25 });
  assert.equal(sevenDays.pagination.totalCount, 51);

  await requirePool().query(
    `
      insert into coin_transactions (
        id, user_id, wallet_user_id, idempotency_key, type, direction,
        amount_millis, balance_after_millis, metadata_json, created_at
      )
      values (
        gen_random_uuid(), $1, $1, $2, 'adjustment', 'credit',
        777, 50000, '{}'::jsonb, now() - interval '220 days'
      )
    `,
    [userId, `ledger-old:${userId}`],
  );
  const sixMonthsAfterOldInsert = await getCoinLedger(requirePool(), userId, { datePreset: "6m", page: 1 });
  assert.equal(sixMonthsAfterOldInsert.pagination.totalCount, 51);
  const customWithOld = await getCoinLedger(requirePool(), userId, {
    datePreset: "custom",
    from: new Date(Date.now() - 230 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
    page: 1,
  });
  assert.equal(customWithOld.pagination.totalCount, 52);

  await requirePool().query(
    `
      insert into coin_transactions (
        id, user_id, wallet_user_id, idempotency_key, type, direction,
        amount_millis, balance_after_millis, metadata_json, created_at
      )
      values (
        gen_random_uuid(), $1, null, $2, 'platform_retention', 'pool_credit',
        500, null, '{}'::jsonb, now()
      )
    `,
    [userId, `ledger-platform:${userId}`],
  );
  const afterInternalRow = await getCoinLedger(requirePool(), userId, { datePreset: "custom", from: customWithOld.filters.from, to: customWithOld.filters.to });
  assert.equal(afterInternalRow.pagination.totalCount, 52);

  await assert.rejects(
    () => getCoinLedger(requirePool(), userId, { datePreset: "custom", from: "2026-07-15", to: "2026-07-14" }),
    /End date must be on or after start date/,
  );
});
