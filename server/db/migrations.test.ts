import test from "node:test";
import assert from "node:assert/strict";
import { calculateMigrationChecksum, loadDatabaseMigrations, parseMigrationFilename, runDatabaseMigrations, type DatabaseMigration } from "./migrations";
import type { PostgresDatabase } from "../auth/postgresAuth";

type QueryCall = {
  sql: string;
  params: unknown[] | undefined;
};

function createMigrationMock(appliedVersions: string[] = [], appliedChecksums: Record<string, string | null> = {}) {
  const calls: QueryCall[] = [];
  const clientCalls: QueryCall[] = [];
  let released = false;

  const database = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (/select version.*from schema_migrations/i.test(sql)) {
        const version = String(params?.[0] || "");
        return {
          rows: appliedVersions.includes(version) ? [{ version, checksum: appliedChecksums[version] ?? null }] : [],
          rowCount: appliedVersions.includes(version) ? 1 : 0,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => {
        clientCalls.push({ sql, params });
        return { rows: [], rowCount: 1 };
      },
      release: () => {
        released = true;
      },
    }),
  } as unknown as PostgresDatabase;

  return {
    calls,
    clientCalls,
    database,
    wasReleased: () => released,
  };
}

const strollMigration: DatabaseMigration = {
  version: "0001",
  name: "stroll_foundation",
  sql: "create table if not exists strolls (id uuid primary key)",
};

test("parseMigrationFilename accepts ordered sql migrations", () => {
  assert.deepEqual(parseMigrationFilename("0001_stroll_foundation.sql"), {
    version: "0001",
    name: "stroll_foundation",
  });
  assert.equal(parseMigrationFilename("stroll_foundation.sql"), null);
});

test("runDatabaseMigrations applies unapplied migrations and records version", async () => {
  const mock = createMigrationMock();

  await runDatabaseMigrations({
    database: mock.database,
    migrations: [strollMigration],
  });

  assert.match(mock.calls[0]?.sql || "", /create table if not exists schema_migrations/i);
  assert.match(mock.calls[1]?.sql || "", /alter table schema_migrations add column if not exists checksum/i);
  assert.match(mock.calls[2]?.sql || "", /pg_advisory_lock/i);
  assert.match(mock.calls[3]?.sql || "", /select version, checksum from schema_migrations/i);
  assert.match(mock.calls[4]?.sql || "", /pg_advisory_unlock/i);
  assert.equal(mock.clientCalls[0]?.sql, "begin");
  assert.match(mock.clientCalls[1]?.sql || "", /create table if not exists strolls/i);
  assert.match(mock.clientCalls[2]?.sql || "", /insert into schema_migrations/i);
  assert.deepEqual(mock.clientCalls[2]?.params, ["0001", "stroll_foundation", calculateMigrationChecksum(strollMigration.sql)]);
  assert.equal(mock.clientCalls[3]?.sql, "commit");
  assert.equal(mock.wasReleased(), true);
});

test("runDatabaseMigrations skips already recorded migrations", async () => {
  const mock = createMigrationMock(["0001"]);

  await runDatabaseMigrations({
    database: mock.database,
    migrations: [strollMigration],
  });

  assert.match(mock.calls[2]?.sql || "", /pg_advisory_lock/i);
  assert.match(mock.calls.at(-1)?.sql || "", /pg_advisory_unlock/i);
  assert.equal(mock.clientCalls.length, 0);
});

test("runDatabaseMigrations rejects changed applied migration checksums", async () => {
  const mock = createMigrationMock(["0001"], { "0001": "old-checksum" });

  await assert.rejects(
    () => runDatabaseMigrations({
      database: mock.database,
      migrations: [strollMigration],
    }),
    /Migration checksum mismatch/,
  );

  assert.match(mock.calls.at(-1)?.sql || "", /pg_advisory_unlock/i);
});

test("runDatabaseMigrations backfills missing checksums for already applied migrations", async () => {
  const mock = createMigrationMock(["0001"], { "0001": null });

  await runDatabaseMigrations({
    database: mock.database,
    migrations: [strollMigration],
  });

  const updateCall = mock.calls.find((call) => /update schema_migrations set checksum/i.test(call.sql));
  assert.deepEqual(updateCall?.params, ["0001", calculateMigrationChecksum(strollMigration.sql)]);
});

test("loadDatabaseMigrations verifies the production migration manifest order", async () => {
  const migrations = await loadDatabaseMigrations();
  const versions = migrations.map((migration) => migration.version);

  assert.deepEqual(versions, ["0000", "0001", "0002", "0003", "0004"]);
  assert.deepEqual(new Set(versions).size, versions.length);
  assert.ok(migrations.every((migration) => migration.sql.trim().length > 0));
});
