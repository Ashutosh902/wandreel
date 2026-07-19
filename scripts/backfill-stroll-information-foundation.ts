import { getPostgresDatabase, isPostgresConfigured } from "../server/auth/postgresAuth";
import { runDatabaseMigrations } from "../server/db/migrations";
import { backfillStrollInformationFoundation } from "../server/stroll/informationFoundation";

function argValue(name: string) {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg === name || arg.startsWith(prefix));
  if (!match) return null;
  if (match === name) return "true";
  return match.slice(prefix.length);
}

function readBatchSize() {
  const raw = argValue("--batch-size") || process.env.STROLL_FOUNDATION_BACKFILL_BATCH_SIZE || "100";
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid --batch-size value: ${raw}`);
  }
  return parsed;
}

async function main() {
  if (!isPostgresConfigured()) {
    throw new Error("DATABASE_URL is required for the Stroll information foundation backfill.");
  }

  const batchSize = readBatchSize();
  const loop = argValue("--loop") === "true";
  const database = getPostgresDatabase();
  await runDatabaseMigrations({ database });

  let total = {
    processed: 0,
    resolved: 0,
    created: 0,
    skipped: 0,
    ambiguous: 0,
    failed: 0,
  };

  do {
    const summary = await backfillStrollInformationFoundation({ database, batchSize });
    total = {
      processed: total.processed + summary.processed,
      resolved: total.resolved + summary.resolved,
      created: total.created + summary.created,
      skipped: total.skipped + summary.skipped,
      ambiguous: total.ambiguous + summary.ambiguous,
      failed: total.failed + summary.failed,
    };
    console.log(JSON.stringify({ batch: summary, total }, null, 2));
    if (summary.processed < batchSize) break;
  } while (loop);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
