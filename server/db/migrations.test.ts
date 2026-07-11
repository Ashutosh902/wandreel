import test from "node:test";
import assert from "node:assert/strict";
import { parseMigrationFilename, runDatabaseMigrations, type DatabaseMigration } from "./migrations";
import type { PostgresDatabase } from "../auth/postgresAuth";

type QueryCall = {
  sql: string;
  params: unknown[] | undefined;
};

function createMigrationMock(appliedVersions: string[] = []) {
  const calls: QueryCall[] = [];
  const clientCalls: QueryCall[] = [];
  let released = false;

  const database = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (/select version from schema_migrations/i.test(sql)) {
        const version = String(params?.[0] || "");
        return {
          rows: appliedVersions.includes(version) ? [{ version }] : [],
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
  assert.match(mock.calls[1]?.sql || "", /select version from schema_migrations/i);
  assert.equal(mock.clientCalls[0]?.sql, "begin");
  assert.match(mock.clientCalls[1]?.sql || "", /create table if not exists strolls/i);
  assert.match(mock.clientCalls[2]?.sql || "", /insert into schema_migrations/i);
  assert.deepEqual(mock.clientCalls[2]?.params, ["0001", "stroll_foundation"]);
  assert.equal(mock.clientCalls[3]?.sql, "commit");
  assert.equal(mock.wasReleased(), true);
});

test("runDatabaseMigrations skips already recorded migrations", async () => {
  const mock = createMigrationMock(["0001"]);

  await runDatabaseMigrations({
    database: mock.database,
    migrations: [strollMigration],
  });

  assert.equal(mock.clientCalls.length, 0);
});
