import "dotenv/config";
import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { __resetPostgresTestConfig, __setPostgresTestConfig } from "../auth/postgresAuth";
import { runDatabaseMigrations } from "../db/migrations";
import { generatePersistedStrollStopsFromSavedPlaces } from "./store";
import {
  backfillStrollInformationFoundation,
  resolveCanonicalPlace,
  writePlaceEvidence,
} from "./informationFoundation";
import type { SavedPlaceForStrollCuration } from "./curation";

type PgPool = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>;
  connect: () => Promise<{
    query: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>;
    release: () => void;
  }>;
};

const baseDatabaseUrl = process.env.STROLL_INFO_TEST_DATABASE_URL || process.env.DATABASE_URL || "";
const shouldRun = Boolean(baseDatabaseUrl && process.env.STROLL_INFO_REAL_PG === "1");
const schemaName = `stroll_info_test_${process.pid}_${Date.now()}`.toLowerCase();

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

async function createUser(id = randomUUID()) {
  await requirePool().query(
    `insert into users (id, email, email_verified, display_name, auth_provider, created_at, updated_at)
     values ($1, $2, true, $3, 'EMAIL', now(), now())`,
    [id, `${id}@example.test`, `User ${id.slice(0, 8)}`],
  );
  return id;
}

function savedPlace(row: {
  id: string;
  placeId: string;
  title: string;
  city?: string;
  locality?: string;
  lat?: number;
  lng?: number;
  googlePlaceId?: string;
  sourceRecordId?: string;
}): SavedPlaceForStrollCuration {
  return {
    id: row.id,
    placeId: row.placeId,
    title: row.title,
    category: "Taste",
    metadata: {
      city: row.city ?? "Patna",
      locality: row.locality ?? "Patna",
      lat: row.lat ?? 25.5945,
      lng: row.lng ?? 85.1379,
      confidence: 0.91,
      description: `${row.title} from a real PostgreSQL test.`,
      imageUrl: "https://example.test/place.jpg",
      googlePlaceId: row.googlePlaceId,
      sourcePlatform: "instagram",
      sourceUrl: "https://instagram.test/reel/1",
      sourceRecordId: row.sourceRecordId ?? row.placeId,
      extractionVersion: "real-pg-test",
      intelligenceVersion: "real-pg-test",
    },
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:00:00.000Z",
  };
}

async function insertSavedPlace(userId: string, place: SavedPlaceForStrollCuration, global = false) {
  const metadata = {
    ...(place.metadata as Record<string, unknown>),
    sharedVisibility: global ? "global" : "private",
    isGlobal: global,
  };
  await requirePool().query(
    `insert into user_saved_places (id, user_id, place_id, title, category, metadata_json, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [place.id, userId, place.placeId, place.title, place.category, JSON.stringify(metadata), place.createdAt, place.updatedAt],
  );
}

async function countRows(table: string, whereSql = "true", params: unknown[] = []) {
  const result = await requirePool().query<{ count: string }>(`select count(*)::text as count from ${table} where ${whereSql}`, params);
  return Number(result.rows[0]?.count ?? 0);
}

test.before(async () => {
  if (!shouldRun) return;
  adminPool = new Pool({
    connectionString: baseDatabaseUrl,
    ssl: baseDatabaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });
  await adminPool.query(`create schema ${quoteIdentifier(schemaName)}`);
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
    await adminPool.query(`drop schema if exists ${quoteIdentifier(schemaName)} cascade`).catch(() => undefined);
    await adminPool.end();
  }
});

test("real PostgreSQL foundation migration creates required tables", { skip: !shouldRun }, async () => {
  assert.match(postgresVersion, /PostgreSQL/i);
  assert.equal(await countRows("schema_migrations", "version = '0006'"), 1);
  for (const table of ["places", "place_source_evidence", "user_place_interactions", "stroll_generation_snapshots", "stroll_candidate_snapshots"]) {
    const result = await requirePool().query<{ to_regclass: string | null }>("select to_regclass($1) as to_regclass", [table]);
    assert.equal(result.rows[0]?.to_regclass, table);
  }
});

test("concurrent canonical resolution creates one Google-backed place", { skip: !shouldRun }, async () => {
  const userId = await createUser();
  const source = savedPlace({
    id: randomUUID(),
    placeId: "legacy-google-1",
    title: "Concurrent Cafe",
    googlePlaceId: `google-${randomUUID()}`,
  });
  await insertSavedPlace(userId, source);

  await Promise.all(Array.from({ length: 20 }, async () => {
    const client = await requirePool().connect();
    try {
      await client.query("begin");
      const resolution = await resolveCanonicalPlace(client, source);
      if (resolution.canonicalPlaceId) {
        await writePlaceEvidence(client, resolution.canonicalPlaceId, source);
        await client.query(
          "update user_saved_places set canonical_place_id = $2 where id = $1 and canonical_place_id is null",
          [source.id, resolution.canonicalPlaceId],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }));

  const canonical = await requirePool().query<{ canonical_place_id: string }>(
    "select canonical_place_id::text from user_saved_places where id = $1",
    [source.id],
  );
  assert.ok(canonical.rows[0]?.canonical_place_id);
  assert.equal(await countRows("places", "google_place_id = $1", [(source.metadata as Record<string, unknown>).googlePlaceId]), 1);
  assert.ok(await countRows("place_source_evidence", "place_id = $1", [canonical.rows[0].canonical_place_id]) >= 6);
});

test("shadow Stroll generation persists snapshots without changing visible stops", { skip: !shouldRun }, async () => {
  const userId = await createUser();
  await requirePool().query(
    `insert into user_stroll_preferences (
       user_id, onboarding_decision, onboarding_decision_at, default_traveller_count,
       default_interests_json, default_start_time, created_at, updated_at
     )
     values ($1, 'accepted', now(), 2, '["Food"]'::jsonb, '10:00', now(), now())`,
    [userId],
  );
  const places = [
    savedPlace({ id: randomUUID(), placeId: "shadow-food", title: "Shadow Cafe", lat: 25.5945, lng: 85.1379 }),
    savedPlace({ id: randomUUID(), placeId: "shadow-heritage", title: "Shadow Museum", lat: 25.613, lng: 85.123 }),
    savedPlace({ id: randomUUID(), placeId: "shadow-wrong-city", title: "Wrong City", city: "Delhi", locality: "Delhi", lat: 28.61, lng: 77.2 }),
  ];
  for (const place of places) {
    await insertSavedPlace(userId, place, place.placeId === "shadow-heritage");
  }
  const strollId = randomUUID();
  await requirePool().query(
    `insert into strolls (id, user_id, name, city, status, source, requested_start_time, traveller_count, interests_json, latitude, longitude, created_at, updated_at)
     values ($1, $2, 'Shadow Stroll', 'Patna', 'curating', 'manual', '10:00', 2, '["Food","Heritage"]'::jsonb, 25.5941, 85.1376, now(), now())`,
    [strollId, userId],
  );

  await generatePersistedStrollStopsFromSavedPlaces(userId, strollId);

  const stops = await requirePool().query<{ place_id: string }>("select place_id from stroll_stops where stroll_id = $1 order by sequence", [strollId]);
  assert.deepEqual(stops.rows.map((row) => row.place_id).sort(), ["shadow-food", "shadow-heritage"]);
  assert.equal(await countRows("stroll_generation_snapshots", "stroll_id = $1", [strollId]), 1);
  assert.equal(await countRows("stroll_candidate_snapshots scs join stroll_generation_snapshots sgs on sgs.id = scs.snapshot_id", "sgs.stroll_id = $1", [strollId]), 3);
  assert.equal(await countRows("user_place_interactions", "user_id = $1 and interaction_type = 'selected_for_stroll'", [userId]), 2);

  const diagnostics = await requirePool().query<{ diagnostics_json: any }>(
    "select diagnostics_json from stroll_generation_snapshots where stroll_id = $1",
    [strollId],
  );
  assert.equal(Number(diagnostics.rows[0]?.diagnostics_json?.selectedPlaceOverlap), 2);
  const userSnapshot = await requirePool().query<{ user_context_snapshot_json: any }>(
    "select user_context_snapshot_json from stroll_generation_snapshots where stroll_id = $1",
    [strollId],
  );
  assert.equal(userSnapshot.rows[0]?.user_context_snapshot_json?.preferences?.onboardingDecision, "accepted");
});

test("generation and candidate snapshots are immutable in PostgreSQL", { skip: !shouldRun }, async () => {
  const userId = await createUser();
  const strollId = randomUUID();
  await requirePool().query(
    `insert into strolls (id, user_id, name, city, status, source, interests_json, created_at, updated_at)
     values ($1, $2, 'Immutable Stroll', 'Patna', 'curating', 'manual', '[]'::jsonb, now(), now())`,
    [strollId, userId],
  );
  const snapshot = await requirePool().query<{ id: string }>(
    `insert into stroll_generation_snapshots (
       stroll_id, user_id, generation_attempt, context_schema_version, curation_version,
       request_context_json, user_context_snapshot_json, environment_context_snapshot_json,
       source_freshness_summary_json, diagnostics_json
     )
     values ($1, $2, 1, 'stroll_context_v1', 'deterministic_saved_places_v1', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)
     returning id`,
    [strollId, userId],
  );
  await requirePool().query(
    `insert into stroll_candidate_snapshots (snapshot_id, legacy_place_id, eligible, selected)
     values ($1, 'legacy-immutable', true, false)`,
    [snapshot.rows[0].id],
  );

  await assert.rejects(
    () => requirePool().query("update stroll_generation_snapshots set diagnostics_json = '{}'::jsonb where id = $1", [snapshot.rows[0].id]),
    /immutable/i,
  );
  await assert.rejects(
    () => requirePool().query("delete from stroll_candidate_snapshots where snapshot_id = $1", [snapshot.rows[0].id]),
    /immutable/i,
  );
});

test("real backfill is idempotent and restartable", { skip: !shouldRun }, async () => {
  const userId = await createUser();
  const first = savedPlace({ id: randomUUID(), placeId: `backfill-${randomUUID()}`, title: "Backfill Cafe" });
  const second = savedPlace({ id: randomUUID(), placeId: `backfill-${randomUUID()}`, title: "Backfill Museum", lat: 25.613, lng: 85.123 });
  await insertSavedPlace(userId, first);
  await insertSavedPlace(userId, second);

  const firstSummary = await backfillStrollInformationFoundation({ database: requirePool() as any, batchSize: 10 });
  const secondSummary = await backfillStrollInformationFoundation({ database: requirePool() as any, batchSize: 10 });

  assert.equal(firstSummary.processed, 2);
  assert.equal(secondSummary.processed, 0);
  assert.equal(await countRows("user_saved_places", "user_id = $1 and canonical_place_id is not null", [userId]), 2);
  assert.ok(await countRows("place_source_evidence", "source_record_id in ($1, $2)", [first.placeId, second.placeId]) >= 2);
});
