import "dotenv/config";
import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runDatabaseMigrations } from "../db/migrations";
import { createSession, __resetPostgresTestConfig, __setPostgresTestConfig } from "../auth/postgresAuth";
import { chargeSavedPlaceCoins, grantFirstLoginCoins } from "./store";
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
