import { readdir, readFile } from "node:fs/promises";
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
  applied_at timestamptz not null default now()
)
`;

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

async function applyMigration(database: PostgresDatabase, migration: DatabaseMigration) {
  const client = (await database.connect()) as MigrationClient;
  try {
    await client.query("begin");
    await client.query(migration.sql);
    await client.query("insert into schema_migrations (version, name) values ($1, $2)", [
      migration.version,
      migration.name,
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

  for (const migration of migrations) {
    const applied = await database.query<{ version: string }>(
      "select version from schema_migrations where version = $1",
      [migration.version],
    );
    if (applied.rows.length > 0) continue;
    await applyMigration(database, migration);
  }
}
