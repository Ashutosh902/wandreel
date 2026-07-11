import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPostgresDatabase, type PostgresDatabase } from "../auth/postgresAuth";

type MigrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }>;
  release: () => void;
};

export type DatabaseMigration = {
  version: string;
  name: string;
  sql: string;
};

const MIGRATION_TABLE_SQL = `
create table if not exists schema_migrations (
  version text primary key,
  name text not null,
  checksum text,
  applied_at timestamptz not null default now()
)
`;

const MIGRATION_LOCK_KEY = "wandreel_schema_migrations";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultMigrationsDir = path.resolve(moduleDir, "../../database/migrations");

export function parseMigrationFilename(filename: string) {
  const match = /^(\d{4})_(.+)\.sql$/.exec(filename);
  if (!match) return null;
  return {
    version: match[1],
    name: match[2],
  };
}

export async function loadDatabaseMigrations(migrationsDir = defaultMigrationsDir): Promise<DatabaseMigration[]> {
  const filenames = (await readdir(migrationsDir)).filter((filename) => parseMigrationFilename(filename));
  filenames.sort();

  return Promise.all(
    filenames.map(async (filename) => {
      const parsed = parseMigrationFilename(filename);
      if (!parsed) {
        throw new Error(`Invalid migration filename: ${filename}`);
      }
      return {
        version: parsed.version,
        name: parsed.name,
        sql: await readFile(path.join(migrationsDir, filename), "utf8"),
      };
    }),
  );
}

export function calculateMigrationChecksum(sql: string) {
  return createHash("sha256").update(sql).digest("hex");
}

async function applyMigration(database: PostgresDatabase, migration: DatabaseMigration, checksum: string) {
  const client = (await database.connect()) as MigrationClient;
  try {
    await client.query("begin");
    await client.query(migration.sql);
    await client.query("insert into schema_migrations (version, name, checksum) values ($1, $2, $3)", [
      migration.version,
      migration.name,
      checksum,
    ]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function runDatabaseMigrations(options: {
  database?: PostgresDatabase;
  migrations?: DatabaseMigration[];
  migrationsDir?: string;
} = {}) {
  const database = options.database ?? getPostgresDatabase();
  const migrations = options.migrations ?? (await loadDatabaseMigrations(options.migrationsDir));

  await database.query(MIGRATION_TABLE_SQL);
  await database.query("alter table schema_migrations add column if not exists checksum text");

  await database.query("select pg_advisory_lock(hashtext($1))", [MIGRATION_LOCK_KEY]);
  try {
    for (const migration of migrations) {
      const checksum = calculateMigrationChecksum(migration.sql);
      const applied = await database.query<{ version: string; checksum: string | null }>(
        "select version, checksum from schema_migrations where version = $1",
        [migration.version],
      );
      const appliedRow = applied.rows[0];
      if (appliedRow) {
        if (appliedRow.checksum && appliedRow.checksum !== checksum) {
          throw new Error(`Migration checksum mismatch for ${migration.version}_${migration.name}`);
        }
        if (!appliedRow.checksum) {
          await database.query("update schema_migrations set checksum = $2 where version = $1", [
            migration.version,
            checksum,
          ]);
        }
        continue;
      }
      await applyMigration(database, migration, checksum);
    }
  } finally {
    await database.query("select pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK_KEY]).catch(() => undefined);
  }
}
