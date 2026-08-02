import { randomUUID } from "node:crypto";
import { completeOperationRun, createOperationRun, recordFailureEvent, recordLocationContext } from "../observability/store";
import { reconcileCoinEconomy } from "../economy/reconciliation";
import { persistStrollGenerationSnapshot, type StrollGenerationContext, STROLL_CONTEXT_SCHEMA_VERSION } from "../stroll/informationFoundation";
import { STROLL_CURATION_VERSION, type SavedPlaceForStrollCuration } from "../stroll/curation";
import { resolveCanonicalPlace, writePlaceEvidence } from "../stroll/informationFoundation";

type SmokeQueryable = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

type SmokeClient = SmokeQueryable & {
  release: () => void;
};

export type SmokeDatabase = SmokeQueryable & {
  connect: () => Promise<SmokeClient>;
};

export type DatabaseSmokeResult = {
  checkedAt: string;
  migrationVersion: string | null;
  assertions: Array<{ name: string; ok: boolean; detail?: string | null }>;
};

function requireProductionConfirmation() {
  const environment = String(process.env.NODE_ENV || "").trim().toLowerCase();
  const confirmation = String(process.env.DB_SMOKE_ALLOW_PRODUCTION || "").trim();
  if (environment === "production" && confirmation !== "1") {
    throw new Error("Refusing production smoke test without DB_SMOKE_ALLOW_PRODUCTION=1");
  }
}

async function getMigrationVersion(database: SmokeQueryable) {
  const result = await database.query<{ version: string }>(
    "select version from schema_migrations order by version desc limit 1",
  );
  return result.rows[0]?.version ?? null;
}

export async function runDatabaseFoundationSmokeTest(database: SmokeDatabase): Promise<DatabaseSmokeResult> {
  requireProductionConfirmation();
  const checkedAt = new Date().toISOString();
  const migrationVersion = await getMigrationVersion(database);
  const assertions: DatabaseSmokeResult["assertions"] = [];
  const client = await database.connect();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const strollId = randomUUID();

  try {
    await client.query("begin");

    await client.query(
      `insert into users (id, email, email_verified, display_name, auth_provider, created_at, updated_at)
       values ($1, $2, true, $3, 'EMAIL', now(), now())`,
      [userId, `db-smoke-${userId}@example.test`, "Database Smoke"],
    );
    await client.query(
      `insert into auth_sessions (id, user_id, token_hash, expires_at, created_at)
       values ($1, $2, $3, now() + interval '30 days', now())`,
      [sessionId, userId, `smoke-${sessionId}`],
    );
    assertions.push({ name: "connection_and_basic_writes", ok: true, detail: "Inserted smoke user and session inside rollback transaction." });

    const operationRunId = await createOperationRun(client, {
      operationType: "place_save",
      userId,
      sessionId,
      correlationId: strollId,
      entityType: "place",
      entityId: "smoke-place",
      inputSummary: { source: "smoke" },
    });
    if (!operationRunId) throw new Error("Could not create operation run");
    await completeOperationRun(client, {
      operationRunId,
      status: "succeeded",
      outputSummary: { completedBy: "smoke" },
    });
    assertions.push({ name: "operation_completion", ok: true, detail: operationRunId });

    const failureId = await recordFailureEvent(client, {
      scope: "system",
      severity: "warning",
      errorCode: "SMOKE_FAILURE",
      userId,
      sessionId,
      operationRunId,
      entityType: "place",
      entityId: "smoke-place",
      publicMessage: "Smoke failure event",
      internalMessage: "Smoke failure event",
      metadata: { smoke: true },
    });
    assertions.push({ name: "failure_event_persistence", ok: Boolean(failureId), detail: failureId });

    const locationId = await recordLocationContext(client, {
      userId,
      sessionId,
      source: "device",
      latitude: 25.5941,
      longitude: 85.1376,
      accuracyMeters: 12,
      city: "Patna",
      locality: "Patna",
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    await client.query(
      `update user_location_contexts
       set latitude = null,
           longitude = null,
           accuracy_meters = null,
           anonymized_at = now()
       where id = $1`,
      [locationId],
    );
    assertions.push({ name: "location_insert_and_anonymize", ok: Boolean(locationId), detail: locationId });

    const place: SavedPlaceForStrollCuration = {
      id: randomUUID(),
      placeId: "smoke-legacy-place",
      title: "Smoke Place",
      category: "Taste",
      metadata: {
        city: "Patna",
        locality: "Patna",
        lat: 25.5941,
        lng: 85.1376,
        sourcePlatform: "smoke",
        sourceRecordId: "smoke-record",
        sourceUrl: "https://example.test/smoke",
      },
      createdAt: checkedAt,
      updatedAt: checkedAt,
    };
    await client.query(
      `insert into user_saved_places (id, user_id, place_id, title, category, metadata_json, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, now(), now())`,
      [place.id, userId, place.placeId, place.title, place.category, JSON.stringify(place.metadata)],
    );
    const resolution = await resolveCanonicalPlace(client, place);
    if (!resolution.canonicalPlaceId) throw new Error("Could not resolve canonical place");
    await writePlaceEvidence(client, resolution.canonicalPlaceId, place);
    assertions.push({ name: "canonical_place_resolution", ok: true, detail: resolution.strategy });

    await client.query(
      `insert into strolls (id, user_id, name, city, status, source, interests_json, created_at, updated_at)
       values ($1, $2, 'Smoke Stroll', 'Patna', 'curating', 'manual', '[]'::jsonb, now(), now())`,
      [strollId, userId],
    );
    const context: StrollGenerationContext = {
      contextSchemaVersion: STROLL_CONTEXT_SCHEMA_VERSION,
      curationVersion: STROLL_CURATION_VERSION,
      generatedAt: checkedAt,
      request: {
        strollId,
        userId,
        city: "Patna",
        source: "manual",
        startDate: null,
        requestedStartTime: null,
        travellerCount: null,
        interests: [],
        coordinates: null,
      },
      user: {
        savedPlaceCount: 1,
        preferences: null,
        recentInteractions: [],
      },
      environment: {
        sharedCandidateCount: 0,
      },
      candidates: [],
      sourceFreshness: {
        missingEvidenceCount: 0,
        staleEvidenceCount: 0,
      },
      diagnostics: {
        candidateOverlap: 0,
        selectedPlaceOverlap: 0,
        canonicalResolutionRate: 1,
        excludedCandidateCounts: {},
        missingEvidenceCount: 0,
        staleEvidenceCount: 0,
        builderDurationMs: 1,
        snapshotFailures: 0,
      },
    };
    const snapshotId = await persistStrollGenerationSnapshot({ client, context });
    assertions.push({ name: "stroll_snapshot_persistence", ok: Boolean(snapshotId), detail: snapshotId });

    const reconciliation = await reconcileCoinEconomy(client);
    assertions.push({
      name: "wallet_reconciliation_query",
      ok: Number.isFinite(reconciliation.walletDiscrepancyMillis),
      detail: String(reconciliation.walletDiscrepancyMillis),
    });

    await client.query("rollback");
    return { checkedAt, migrationVersion, assertions };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
