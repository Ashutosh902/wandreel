import "dotenv/config";
import { cleanupOperationalData, type CleanupCategory } from "../server/db/cleanup";
import { getPostgresDatabase, isPostgresConfigured } from "../server/auth/postgresAuth";

function readArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function parseOnly(): CleanupCategory[] | undefined {
  const raw = readArg("--only");
  if (!raw) return undefined;
  const categories = raw.split(",").map((value) => value.trim()).filter(Boolean);
  const valid = new Set<CleanupCategory>(["auth-sessions", "product-events", "failures", "location", "operation-payloads"]);
  const normalized = categories.filter((value): value is CleanupCategory => valid.has(value as CleanupCategory));
  if (!normalized.length) {
    throw new Error(`Unknown cleanup category: ${raw}`);
  }
  return normalized;
}

async function main() {
  if (!isPostgresConfigured()) {
    throw new Error("DATABASE_URL is required for db cleanup");
  }

  const batchSizeRaw = readArg("--batch-size");
  const batchSize = batchSizeRaw ? Number(batchSizeRaw) : 500;
  if (!Number.isFinite(batchSize) || batchSize < 1) {
    throw new Error("Batch size must be a positive integer");
  }

  const result = await cleanupOperationalData(getPostgresDatabase() as any, {
    dryRun: hasFlag("--dry-run"),
    batchSize,
    only: parseOnly(),
  });

  console.log(JSON.stringify(result, null, 2));
  if (result.categories.some((category) => category.failed > 0)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("db_cleanup_failed", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
