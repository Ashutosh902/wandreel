import "dotenv/config";
import { getDatabaseHealthReport } from "../server/db/health";
import { getPostgresDatabase, isPostgresConfigured } from "../server/auth/postgresAuth";

async function main() {
  if (!isPostgresConfigured()) {
    throw new Error("DATABASE_URL is required for db health");
  }
  const report = await getDatabaseHealthReport(getPostgresDatabase());
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error("db_health_failed", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
