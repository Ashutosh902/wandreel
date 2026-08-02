import "dotenv/config";
import { getPostgresDatabase, isPostgresConfigured } from "../server/auth/postgresAuth";
import { runDatabaseFoundationSmokeTest } from "../server/db/smoke";

async function main() {
  if (!isPostgresConfigured()) {
    throw new Error("DATABASE_URL is required for db smoke");
  }
  const result = await runDatabaseFoundationSmokeTest(getPostgresDatabase() as any);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("db_smoke_failed", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
