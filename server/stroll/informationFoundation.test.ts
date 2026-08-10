import test from "node:test";
import assert from "node:assert/strict";
import type { PostgresDatabase } from "../auth/postgresAuth";
import { generateDeterministicStrollPlan, type SavedPlaceForStrollCuration } from "./curation";
import {
  backfillStrollInformationFoundation,
  buildStrollContext,
  normalizeCanonicalPlaceName,
  persistStrollGenerationSnapshot,
  resolveCanonicalPlace,
  runStrollContextShadow,
  writePlaceEvidence,
} from "./informationFoundation";
import type { StrollSummary } from "./types";

type QueryCall = {
  sql: string;
  params: unknown[] | undefined;
};

function stroll(): StrollSummary {
  return {
    id: "stroll-1",
    name: "Patna Stroll",
    description: null,
    city: "Patna",
    status: "curating",
    source: "manual",
    startDate: "2026-07-12",
    endDate: "2026-07-12",
    requestedStartTime: "10:00",
    travellerCount: 2,
    interests: ["Food", "Heritage"],
    latitude: 25.5941,
    longitude: 85.1376,
    totalDistanceMeters: null,
    estimatedDurationMinutes: null,
    stopCount: 0,
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:00:00.000Z",
    curatedAt: null,
    archivedAt: null,
  };
}

function savedPlace(overrides: Partial<SavedPlaceForStrollCuration> = {}): SavedPlaceForStrollCuration {
  return {
    id: "saved-1",
    placeId: "legacy-1",
    title: "Patna Cafe",
    category: "Taste",
    metadata: {
      city: "Patna",
      locality: "Boring Road",
      lat: 25.5945,
      lng: 85.1379,
      confidence: 0.9,
      description: "A useful cafe.",
      imageUrl: "https://example.test/cafe.jpg",
      sourcePlatform: "instagram",
      sourceUrl: "https://instagram.test/reel/1",
      sourceRecordId: "reel-1",
    },
    createdAt: "2026-07-10T10:00:00.000Z",
    updatedAt: "2026-07-11T10:00:00.000Z",
    ...overrides,
  };
}

test("canonical name normalization is stable across punctuation and accents", () => {
  assert.equal(normalizeCanonicalPlaceName("  Café: Patna!!  "), "cafe patna");
});

test("resolver creates a canonical place and links source evidence on first resolution path", async () => {
  const calls: QueryCall[] = [];
  const client: any = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (/select canonical_place_id from user_saved_places/i.test(sql)) return { rows: [{ canonical_place_id: null }], rowCount: 1 };
      if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [], rowCount: 1 };
      if (/join place_source_evidence/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/from places/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/insert into places/i.test(sql)) return { rows: [{ id: "place-1" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };

  const result = await resolveCanonicalPlace(client, savedPlace());

  assert.equal(result.status, "created");
  assert.equal(result.canonicalPlaceId, "place-1");
  assert.equal(result.strategy, "created_new");
  assert.ok(calls.some((call) => /pg_advisory_xact_lock/i.test(call.sql)));
});

test("resolver avoids ambiguous normalized city matches", async () => {
  const client: any = {
    query: async (sql: string) => {
      if (/select canonical_place_id from user_saved_places/i.test(sql)) return { rows: [{ canonical_place_id: null }], rowCount: 1 };
      if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [], rowCount: 1 };
      if (/join place_source_evidence/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/abs\(latitude/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/coalesce\(city/i.test(sql)) return { rows: [{ id: "place-a" }, { id: "place-b" }], rowCount: 2 };
      return { rows: [], rowCount: 0 };
    },
  };

  const result = await resolveCanonicalPlace(client, savedPlace({ metadata: { city: "Patna", locality: "Boring Road" } }));

  assert.equal(result.status, "ambiguous");
  assert.equal(result.canonicalPlaceId, null);
});

test("writePlaceEvidence dedupes seed evidence across different saved rows for the same place source", async () => {
  const insertedFingerprints = new Set<string>();
  const client: any = {
    query: async (_sql: string, params?: unknown[]) => {
      const factType = String(params?.[1] ?? "");
      const fingerprint = String(params?.[11] ?? "");
      const key = `${factType}:${fingerprint}`;
      const inserted = insertedFingerprints.has(key) ? 0 : 1;
      insertedFingerprints.add(key);
      return { rows: [], rowCount: inserted };
    },
  };

  await writePlaceEvidence(client, "place-1", savedPlace({
    id: "saved-1",
    placeId: "legacy-1",
    metadata: {
      city: "Patna",
      locality: "Boring Road",
      sourcePlatform: "instagram",
      sourceUrl: "https://instagram.test/reel/1",
    },
  }));
  const afterFirstWrite = insertedFingerprints.size;

  await writePlaceEvidence(client, "place-1", savedPlace({
    id: "saved-2",
    placeId: "legacy-1",
    metadata: {
      city: "Patna",
      locality: "Boring Road",
      sourcePlatform: "instagram",
      sourceUrl: "https://instagram.test/reel/1",
    },
  }));

  assert.equal(afterFirstWrite, 7);
  assert.equal(insertedFingerprints.size, afterFirstWrite);
});

test("context builder resolves canonical identities and returns normalized candidate context", async () => {
  const savedPlaces = [
    savedPlace({ id: "saved-1", placeId: "legacy-1", title: "Patna Cafe", category: "Taste" }),
    savedPlace({ id: "saved-2", placeId: "legacy-2", title: "Golghar", category: "Explore", metadata: { city: "Patna", locality: "Patna", lat: 25.62, lng: 85.14 } }),
  ];
  const plan = generateDeterministicStrollPlan(stroll(), savedPlaces);
  let insertedPlace = 0;
  const client: any = {
    query: async (sql: string) => {
      if (/from user_saved_places/i.test(sql) && /user_id <>/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/select canonical_place_id from user_saved_places/i.test(sql)) return { rows: [{ canonical_place_id: null }], rowCount: 1 };
      if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [], rowCount: 1 };
      if (/join place_source_evidence/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/from places/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/insert into places/i.test(sql)) {
        insertedPlace += 1;
        return { rows: [{ id: `place-${insertedPlace}` }], rowCount: 1 };
      }
      if (/from user_stroll_preferences/i.test(sql)) {
        return {
          rows: [{
            onboarding_decision: "accepted",
            default_traveller_count: 2,
            default_interests_json: ["Food"],
            default_start_time: "10:00",
            updated_at: "2026-07-11T10:00:00.000Z",
          }],
          rowCount: 1,
        };
      }
      if (/from place_source_evidence/i.test(sql) && /count\(\*\)::bigint/i.test(sql)) {
        return {
          rows: [{ evidence_row_count: "6", latest_observed_at: "2026-07-11 10:00:00+00", expired_evidence_count: "0" }],
          rowCount: 1,
        };
      }
      if (/from user_place_interactions/i.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    },
  };

  const context = await buildStrollContext({ client, userId: "user-1", stroll: stroll(), savedPlaces, plan });

  assert.equal(context.contextSchemaVersion, "stroll_context_v1");
  assert.equal(context.candidates.length, 2);
  assert.equal(context.candidates.every((candidate) => candidate.canonicalPlaceId), true);
  assert.equal(context.candidates.every((candidate) => candidate.databaseEvidence.evidenceRowCount === 6), true);
  assert.equal(context.user.preferences?.onboardingDecision, "accepted");
  assert.equal(context.diagnostics.selectedPlaceOverlap, plan.stops.length);
  assert.equal(context.diagnostics.canonicalResolutionRate, 1);
});

test("snapshot persistence writes immutable generation and candidate records", async () => {
  const calls: QueryCall[] = [];
  const selectedPlace = savedPlace({ id: "saved-1" });
  const context = {
    contextSchemaVersion: "stroll_context_v1",
    curationVersion: "deterministic_saved_places_v1",
    generatedAt: "2026-07-11T10:00:00.000Z",
    request: {
      strollId: "stroll-1",
      userId: "user-1",
      city: "Patna",
      source: "manual",
      startDate: null,
      requestedStartTime: null,
      travellerCount: null,
      interests: [],
      coordinates: null,
    },
    user: { savedPlaceCount: 1, preferences: null, recentInteractions: [] },
    environment: { sharedCandidateCount: 0 },
    candidates: [{
      savedPlaceId: selectedPlace.id,
      legacyPlaceId: selectedPlace.placeId,
      title: selectedPlace.title,
      eligible: true,
      exclusionReason: null,
      deterministicScore: 0.8,
      candidateRank: 1,
      selected: true,
      scoringFactors: { interest: 1, category: 0.7, geography: 1, quality: 0.8, confidence: 0.9 },
      evidenceSummary: { hasCoordinates: true, hasDescription: true, hasImage: true, hasSource: true, confidence: 0.9 },
      sourceFreshness: { savedAt: selectedPlace.createdAt, updatedAt: selectedPlace.updatedAt, stale: false },
      canonicalPlaceId: "place-1",
      resolutionStatus: "created" as const,
      resolutionStrategy: "created_new",
      source: "user_saved" as const,
      databaseEvidence: { evidenceRowCount: 6, latestObservedAt: "2026-07-11 10:00:00+00", expiredEvidenceCount: 0 },
      placeKnowledge: null,
      knowledgeSelection: null,
      knowledgeRead: { status: "loaded" as const, lookupMs: 0, error: null },
    }],
    sourceFreshness: { missingEvidenceCount: 0, staleEvidenceCount: 0 },
    diagnostics: {
      candidateOverlap: 1,
      selectedPlaceOverlap: 1,
      canonicalResolutionRate: 1,
      excludedCandidateCounts: {},
      missingEvidenceCount: 0,
      staleEvidenceCount: 0,
      builderDurationMs: 3,
      snapshotFailures: 0,
      knowledgeLookupMs: 0,
      knowledgeReadFailures: 0,
    },
  };
  const client: any = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (/max\(generation_attempt\)/i.test(sql)) return { rows: [{ generation_attempt: 1 }], rowCount: 1 };
      if (/insert into stroll_generation_snapshots/i.test(sql)) return { rows: [{ id: "snapshot-1" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };

  const snapshotId = await persistStrollGenerationSnapshot({ client, context });

  assert.equal(snapshotId, "snapshot-1");
  assert.equal(calls.filter((call) => /insert into stroll_generation_snapshots/i.test(call.sql)).length, 1);
  assert.equal(calls.filter((call) => /insert into stroll_candidate_snapshots/i.test(call.sql)).length, 1);
});

test("shadow mode rolls back and returns diagnostics instead of throwing", async () => {
  const clientCalls: QueryCall[] = [];
  const database = {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => {
        clientCalls.push({ sql, params });
        if (/from user_saved_places/i.test(sql)) throw new Error("snapshot store unavailable");
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    }),
  } as unknown as PostgresDatabase;
  const savedPlaces = [
    savedPlace({ id: "saved-1", placeId: "legacy-1" }),
    savedPlace({ id: "saved-2", placeId: "legacy-2", title: "Golghar", category: "Explore", metadata: { city: "Patna", locality: "Patna", lat: 25.62, lng: 85.14 } }),
  ];
  const plan = generateDeterministicStrollPlan(stroll(), savedPlaces);

  const result = await runStrollContextShadow({ database, userId: "user-1", stroll: stroll(), savedPlaces, plan });

  assert.equal(result.snapshotId, null);
  assert.match(result.error || "", /snapshot store unavailable/);
  assert.ok(clientCalls.some((call) => call.sql === "rollback"));
});

test("backfill processes one locked batch and is restart safe for linked rows", async () => {
  const calls: QueryCall[] = [];
  const database = {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        if (/from user_saved_places/i.test(sql) && /for update skip locked/i.test(sql)) {
          return {
            rows: [{
              id: "saved-1",
              place_id: "legacy-1",
              title: "Patna Cafe",
              category: "Taste",
              metadata_json: savedPlace().metadata,
              created_at: "2026-07-10T10:00:00.000Z",
              updated_at: "2026-07-11T10:00:00.000Z",
            }],
            rowCount: 1,
          };
        }
        if (/select canonical_place_id from user_saved_places/i.test(sql)) return { rows: [{ canonical_place_id: "place-1" }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined,
    }),
  } as unknown as PostgresDatabase;

  const summary = await backfillStrollInformationFoundation({ database, batchSize: 10 });

  assert.equal(summary.processed, 1);
  assert.equal(summary.resolved, 1);
  assert.equal(summary.failed, 0);
  assert.equal(calls.some((call) => /for update skip locked/i.test(call.sql)), true);
});
