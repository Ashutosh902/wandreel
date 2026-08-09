import { createHash } from "node:crypto";
import type { PostgresDatabase } from "../auth/postgresAuth";
import {
  completeOperationRun,
  createOperationRun,
} from "../observability/store";
import {
  analyzeDeterministicStrollCandidates,
  STROLL_CURATION_VERSION,
  type DeterministicCandidateDecision,
  type GeneratedStrollPlan,
  type SavedPlaceForStrollCuration,
} from "./curation";
import type { StrollSummary } from "./types";

export const STROLL_CONTEXT_SCHEMA_VERSION = "stroll_context_v1";

type Queryable = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

type TransactionClient = Queryable & {
  release: () => void;
};

type CanonicalResolutionStatus = "resolved" | "created" | "ambiguous" | "skipped";

type CanonicalResolution = {
  status: CanonicalResolutionStatus;
  canonicalPlaceId: string | null;
  strategy: string;
  matchedCount: number;
};

type PlaceRow = {
  id: string;
  inserted?: boolean;
};

type SavedPlaceCanonicalRow = {
  canonical_place_id: string | null;
};

type SnapshotRow = {
  id: string;
};

type StrollPreferenceSnapshot = {
  onboardingDecision: string;
  defaultTravellerCount: number | null;
  defaultInterests: string[];
  defaultStartTime: string | null;
  updatedAt: string | null;
} | null;

type DatabaseEvidenceSummary = {
  evidenceRowCount: number;
  latestObservedAt: string | null;
  expiredEvidenceCount: number;
};

export type StrollGenerationContext = {
  contextSchemaVersion: string;
  curationVersion: string;
  generatedAt: string;
  request: {
    strollId: string;
    userId: string;
    city: string;
    source: string;
    startDate: string | null;
    requestedStartTime: string | null;
    travellerCount: number | null;
    interests: string[];
    coordinates: { latitude: number; longitude: number } | null;
  };
  user: {
    savedPlaceCount: number;
    preferences: StrollPreferenceSnapshot;
    recentInteractions: Array<{
      canonicalPlaceId: string | null;
      legacyPlaceId: string | null;
      interactionType: string;
      occurredAt: string;
    }>;
  };
  environment: {
    sharedCandidateCount: number;
  };
  candidates: Array<DeterministicCandidateDecision & {
    canonicalPlaceId: string | null;
    resolutionStatus: CanonicalResolutionStatus;
    resolutionStrategy: string;
    source: "user_saved" | "global_shared";
    databaseEvidence: DatabaseEvidenceSummary;
  }>;
  sourceFreshness: {
    missingEvidenceCount: number;
    staleEvidenceCount: number;
  };
  diagnostics: {
    candidateOverlap: number;
    selectedPlaceOverlap: number;
    canonicalResolutionRate: number;
    excludedCandidateCounts: Record<string, number>;
    missingEvidenceCount: number;
    staleEvidenceCount: number;
    builderDurationMs: number;
    snapshotFailures: number;
  };
};

export type StrollContextShadowResult = {
  snapshotId: string | null;
  context: StrollGenerationContext | null;
  error: string | null;
};

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataNumber(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function normalizeCanonicalPlaceName(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampConfidence(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
  if (typeof value === "string" && Number.isFinite(Number(value))) {
    const numeric = Number(value);
    return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
  }
  return 0.55;
}

function readGooglePlaceId(metadata: Record<string, unknown>, place: SavedPlaceForStrollCuration) {
  return metadataString(metadata, "googlePlaceId") ||
    metadataString(metadata, "google_place_id") ||
    metadataString(metadata, "googleMapsPlaceId") ||
    (metadataString(metadata, "sourceType") === "google" ? place.placeId : null);
}

function readExternalSourceId(metadata: Record<string, unknown>, place: SavedPlaceForStrollCuration) {
  const sourceType = metadataString(metadata, "sourcePlatform") ||
    metadataString(metadata, "sourceType") ||
    metadataString(metadata, "provider");
  const sourceRecordId = metadataString(metadata, "sourceRecordId") ||
    metadataString(metadata, "sourceEntityId") ||
    metadataString(metadata, "canonicalUrl") ||
    metadataString(metadata, "sourceUrl") ||
    metadataString(metadata, "videoUrl");
  if (!sourceType || !sourceRecordId) return null;
  return `${sourceType}:${sourceRecordId || place.placeId}`;
}

function readCity(metadata: Record<string, unknown>) {
  return metadataString(metadata, "city") ||
    metadataString(metadata, "resolvedCity") ||
    metadataString(metadata, "placeCity");
}

function readLocality(metadata: Record<string, unknown>) {
  return metadataString(metadata, "locality") ||
    metadataString(metadata, "neighborhood") ||
    metadataString(metadata, "neighbourhood");
}

function evidenceFingerprint(input: {
  factType: string;
  factValue: unknown;
  sourceType: string;
  sourceUrl: string | null;
  sourceRecordId: string | null;
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function sourceDescriptor(metadata: Record<string, unknown>, place: SavedPlaceForStrollCuration) {
  const sourceType = metadataString(metadata, "sourcePlatform") ||
    metadataString(metadata, "sourceType") ||
    metadataString(metadata, "provider") ||
    "user_saved_places";
  const sourceUrl = metadataString(metadata, "sourceUrl") ||
    metadataString(metadata, "videoUrl") ||
    metadataString(metadata, "canonicalUrl");
  const stableFallbackSourceRecordId = metadataString(metadata, "externalSourceId") ||
    metadataString(metadata, "googlePlaceId") ||
    metadataString(metadata, "google_place_id") ||
    metadataString(metadata, "googleMapsPlaceId") ||
    place.placeId ||
    sourceUrl ||
    normalizeCanonicalPlaceName(place.title);
  const sourceRecordId = metadataString(metadata, "sourceRecordId") ||
    metadataString(metadata, "sourceEntityId") ||
    metadataString(metadata, "attemptId") ||
    stableFallbackSourceRecordId;
  return { sourceType, sourceUrl, sourceRecordId };
}

async function findSinglePlace(client: Queryable, sql: string, params: unknown[], strategy: string): Promise<CanonicalResolution | null> {
  const result = await client.query<PlaceRow>(sql, params);
  if (result.rows.length === 1) {
    return {
      status: "resolved",
      canonicalPlaceId: result.rows[0].id,
      strategy,
      matchedCount: 1,
    };
  }
  if (result.rows.length > 1) {
    return {
      status: "ambiguous",
      canonicalPlaceId: null,
      strategy,
      matchedCount: result.rows.length,
    };
  }
  return null;
}

export async function resolveCanonicalPlace(
  client: Queryable,
  place: SavedPlaceForStrollCuration,
): Promise<CanonicalResolution> {
  const existing = await client.query<SavedPlaceCanonicalRow>(
    "select canonical_place_id from user_saved_places where id = $1 limit 1",
    [place.id],
  );
  if (existing.rows[0]?.canonical_place_id) {
    return {
      status: "resolved",
      canonicalPlaceId: existing.rows[0].canonical_place_id,
      strategy: "saved_place_existing_link",
      matchedCount: 1,
    };
  }

  const metadata = toRecord(place.metadata);
  const normalizedName = normalizeCanonicalPlaceName(place.title);
  if (!normalizedName) {
    return { status: "skipped", canonicalPlaceId: null, strategy: "missing_name", matchedCount: 0 };
  }

  const googlePlaceId = readGooglePlaceId(metadata, place);
  const externalSourceId = readExternalSourceId(metadata, place);
  const city = readCity(metadata);
  const locality = readLocality(metadata);
  const latitude = metadataNumber(metadata, "lat") ?? metadataNumber(metadata, "latitude");
  const longitude = metadataNumber(metadata, "lng") ?? metadataNumber(metadata, "longitude");
  const category = place.category || metadataString(metadata, "category") || metadataString(metadata, "placeType");

  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `place:${googlePlaceId || externalSourceId || normalizedName}:${city || ""}:${locality || ""}`,
  ]);

  if (googlePlaceId) {
    const inserted = await client.query<PlaceRow>(
      `insert into places (
         canonical_name, normalized_name, primary_category, latitude, longitude, city, locality,
         google_place_id, metadata_json, created_at, updated_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now(), now())
       on conflict (google_place_id) where google_place_id is not null
       do update set updated_at = places.updated_at
       returning id, (xmax = 0) as inserted`,
      [place.title.trim(), normalizedName, category, latitude, longitude, city, locality, googlePlaceId, JSON.stringify({ resolver: "google_place_id" })],
    );
    return {
      status: inserted.rows[0]?.inserted === true ? "created" : "resolved",
      canonicalPlaceId: inserted.rows[0].id,
      strategy: "google_place_id",
      matchedCount: 1,
    };
  }

  if (externalSourceId) {
    const match = await findSinglePlace(
      client,
      `select p.id
       from places p
       join place_source_evidence pse on pse.place_id = p.id
       where pse.fact_type = 'external_source_identifier'
         and pse.source_record_id = $1
       limit 2`,
      [externalSourceId],
      "external_source_identifier",
    );
    if (match) return match;
  }

  if (latitude != null && longitude != null) {
    const coordinateMatch = await findSinglePlace(
      client,
      `select id
       from places
       where normalized_name = $1
         and latitude is not null
         and longitude is not null
         and abs(latitude - $2) <= 0.001
         and abs(longitude - $3) <= 0.001
       limit 2`,
      [normalizedName, latitude, longitude],
      "normalized_name_nearby_coordinates",
    );
    if (coordinateMatch) return coordinateMatch;
  }

  if (city || locality) {
    const cityMatch = await findSinglePlace(
      client,
      `select id
       from places
       where normalized_name = $1
         and coalesce(city, '') = coalesce($2, '')
         and coalesce(locality, '') = coalesce($3, '')
       limit 2`,
      [normalizedName, city, locality],
      "normalized_name_city_locality",
    );
    if (cityMatch) return cityMatch;
  }

  const created = await client.query<PlaceRow>(
    `insert into places (
       canonical_name, normalized_name, primary_category, latitude, longitude, city, locality,
       metadata_json, created_at, updated_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now(), now())
     returning id`,
    [place.title.trim(), normalizedName, category, latitude, longitude, city, locality, JSON.stringify({ resolver: "created_from_saved_place" })],
  );
  return { status: "created", canonicalPlaceId: created.rows[0].id, strategy: "created_new", matchedCount: 0 };
}

export async function writePlaceEvidence(
  client: Queryable,
  canonicalPlaceId: string,
  place: SavedPlaceForStrollCuration,
) {
  const metadata = toRecord(place.metadata);
  const source = sourceDescriptor(metadata, place);
  const confidence = clampConfidence(metadata.confidence ?? metadata.placeConfidence ?? metadata.searchVerificationScore);
  const extractionVersion = metadataString(metadata, "extractionVersion");
  const intelligenceVersion = metadataString(metadata, "intelligenceVersion");
  const rows: Array<{ factType: string; factValue: unknown; expiresAt: string | null }> = [
    { factType: "identity", factValue: { title: place.title, legacyPlaceId: place.placeId }, expiresAt: null },
    { factType: "category", factValue: { category: place.category, placeType: metadataString(metadata, "placeType") }, expiresAt: null },
    {
      factType: "coordinates",
      factValue: {
        latitude: metadataNumber(metadata, "lat") ?? metadataNumber(metadata, "latitude"),
        longitude: metadataNumber(metadata, "lng") ?? metadataNumber(metadata, "longitude"),
      },
      expiresAt: null,
    },
    {
      factType: "description",
      factValue: {
        description: metadataString(metadata, "description") || metadataString(metadata, "latestDescription") || metadataString(metadata, "metaSecondary"),
      },
      expiresAt: null,
    },
    { factType: "image", factValue: { imageUrl: metadataString(metadata, "imageUrl") }, expiresAt: null },
    { factType: "metadata", factValue: metadata, expiresAt: null },
  ];

  const externalSourceId = readExternalSourceId(metadata, place);
  if (externalSourceId) {
    rows.push({ factType: "external_source_identifier", factValue: { externalSourceId }, expiresAt: null });
  }

  for (const row of rows) {
    const fingerprint = evidenceFingerprint({
      factType: row.factType,
      factValue: row.factValue,
      sourceType: source.sourceType,
      sourceUrl: source.sourceUrl,
      sourceRecordId: row.factType === "external_source_identifier" ? externalSourceId : source.sourceRecordId,
    });
    await client.query(
      `insert into place_source_evidence (
         place_id, fact_type, fact_value_json, source_type, source_url, source_record_id,
         confidence, observed_at, expires_at, extraction_version, intelligence_version,
         evidence_fingerprint, original_payload_json, created_at
       )
       values ($1, $2, $3::jsonb, $4, $5, $6, $7, coalesce($8::timestamptz, now()), $9::timestamptz, $10, $11, $12, $13::jsonb, now())
       on conflict (place_id, fact_type, evidence_fingerprint) do nothing`,
      [
        canonicalPlaceId,
        row.factType,
        JSON.stringify(row.factValue ?? {}),
        source.sourceType,
        source.sourceUrl,
        row.factType === "external_source_identifier" ? externalSourceId : source.sourceRecordId,
        confidence,
        place.updatedAt,
        row.expiresAt,
        extractionVersion,
        intelligenceVersion,
        fingerprint,
        JSON.stringify({ savedPlaceId: place.id, legacyPlaceId: place.placeId, metadata }),
      ],
    );
  }
}

export async function recordUserPlaceInteraction(
  client: Queryable,
  input: {
    userId: string;
    canonicalPlaceId: string | null;
    savedPlaceId?: string | null;
    legacyPlaceId?: string | null;
    strollId?: string | null;
    interactionType: string;
    interactionSource?: string;
    metadata?: unknown;
  },
) {
  await client.query(
    `insert into user_place_interactions (
       user_id, canonical_place_id, saved_place_id, legacy_place_id, stroll_id,
       interaction_type, interaction_source, metadata_json, occurred_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())`,
    [
      input.userId,
      input.canonicalPlaceId,
      input.savedPlaceId ?? null,
      input.legacyPlaceId ?? null,
      input.strollId ?? null,
      input.interactionType,
      input.interactionSource ?? "system",
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

async function listSharedCandidates(client: Queryable, userId: string, limit = 100): Promise<SavedPlaceForStrollCuration[]> {
  const result = await client.query<{
    id: string;
    place_id: string;
    title: string;
    category: string | null;
    metadata_json: unknown;
    created_at: string | null;
    updated_at: string | null;
  }>(
    `select id, place_id, title, category, metadata_json, created_at, updated_at
     from user_saved_places
     where user_id <> $1
       and (
         metadata_json->>'sharedVisibility' = 'global'
         or coalesce((metadata_json->>'isGlobal')::boolean, false) = true
       )
     order by created_at desc
     limit $2`,
    [userId, limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    placeId: row.place_id,
    title: row.title,
    category: row.category,
    metadata: row.metadata_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function listRecentInteractions(client: Queryable, userId: string) {
  const result = await client.query<{
    canonical_place_id: string | null;
    legacy_place_id: string | null;
    interaction_type: string;
    occurred_at: string;
  }>(
    `select canonical_place_id, legacy_place_id, interaction_type, occurred_at
     from user_place_interactions
     where user_id = $1
     order by occurred_at desc
     limit 100`,
    [userId],
  );
  return result.rows.map((row) => ({
    canonicalPlaceId: row.canonical_place_id,
    legacyPlaceId: row.legacy_place_id,
    interactionType: row.interaction_type,
    occurredAt: row.occurred_at,
  }));
}

async function loadStrollPreferences(client: Queryable, userId: string): Promise<StrollPreferenceSnapshot> {
  const result = await client.query<{
    onboarding_decision: string;
    default_traveller_count: number | null;
    default_interests_json: unknown;
    default_start_time: string | null;
    updated_at: string | null;
  }>(
    `select onboarding_decision, default_traveller_count, default_interests_json, default_start_time, updated_at
     from user_stroll_preferences
     where user_id = $1
     limit 1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    onboardingDecision: row.onboarding_decision,
    defaultTravellerCount: row.default_traveller_count,
    defaultInterests: Array.isArray(row.default_interests_json)
      ? row.default_interests_json.map(String).filter(Boolean)
      : [],
    defaultStartTime: row.default_start_time,
    updatedAt: row.updated_at,
  };
}

async function loadDatabaseEvidenceSummary(client: Queryable, placeId: string | null): Promise<DatabaseEvidenceSummary> {
  if (!placeId) {
    return { evidenceRowCount: 0, latestObservedAt: null, expiredEvidenceCount: 0 };
  }
  const result = await client.query<{
    evidence_row_count: string | number | null;
    latest_observed_at: string | null;
    expired_evidence_count: string | number | null;
  }>(
    `select count(*)::bigint as evidence_row_count,
            max(observed_at)::text as latest_observed_at,
            count(*) filter (where expires_at is not null and expires_at < now())::bigint as expired_evidence_count
     from place_source_evidence
     where place_id = $1`,
    [placeId],
  );
  const row = result.rows[0];
  return {
    evidenceRowCount: Number(row?.evidence_row_count ?? 0),
    latestObservedAt: row?.latest_observed_at ?? null,
    expiredEvidenceCount: Number(row?.expired_evidence_count ?? 0),
  };
}

export async function buildStrollContext(input: {
  client: Queryable;
  userId: string;
  stroll: StrollSummary;
  savedPlaces: SavedPlaceForStrollCuration[];
  plan: GeneratedStrollPlan;
}): Promise<StrollGenerationContext> {
  const startedAt = Date.now();
  const sharedCandidates = await listSharedCandidates(input.client, input.userId);
  const candidatesWithSource = [
    ...input.savedPlaces.map((place) => ({ place, source: "user_saved" as const })),
    ...sharedCandidates.map((place) => ({ place, source: "global_shared" as const })),
  ];

  const selectedPlaceIds = input.plan.stops.map((stop) => stop.placeId);
  const analysis = analyzeDeterministicStrollCandidates(
    input.stroll,
    candidatesWithSource.map((candidate) => candidate.place),
    selectedPlaceIds,
  );
  const bySavedPlaceId = new Map(candidatesWithSource.map((candidate) => [candidate.place.id, candidate]));
  const resolutions = new Map<string, CanonicalResolution>();

  for (const { place } of candidatesWithSource) {
    const resolution = await resolveCanonicalPlace(input.client, place);
    resolutions.set(place.id, resolution);
    if (resolution.canonicalPlaceId) {
      await writePlaceEvidence(input.client, resolution.canonicalPlaceId, place);
      await input.client.query(
        "update user_saved_places set canonical_place_id = $2, updated_at = now() where id = $1 and canonical_place_id is null",
        [place.id, resolution.canonicalPlaceId],
      );
    }
  }

  const recentInteractions = await listRecentInteractions(input.client, input.userId);
  const preferences = await loadStrollPreferences(input.client, input.userId);
  const enrichedCandidates: StrollGenerationContext["candidates"] = [];
  for (const decision of analysis.decisions) {
    const match = bySavedPlaceId.get(decision.savedPlaceId);
    const resolution = resolutions.get(decision.savedPlaceId) ?? {
      status: "skipped" as const,
      canonicalPlaceId: null,
      strategy: "not_resolved",
      matchedCount: 0,
    };
    enrichedCandidates.push({
      ...decision,
      canonicalPlaceId: resolution.canonicalPlaceId,
      resolutionStatus: resolution.status,
      resolutionStrategy: resolution.strategy,
      source: match?.source ?? "user_saved",
      databaseEvidence: await loadDatabaseEvidenceSummary(input.client, resolution.canonicalPlaceId),
    });
  }

  for (const selected of enrichedCandidates.filter((candidate) => candidate.selected && candidate.source === "user_saved")) {
    await recordUserPlaceInteraction(input.client, {
      userId: input.userId,
      canonicalPlaceId: selected.canonicalPlaceId,
      savedPlaceId: selected.savedPlaceId,
      legacyPlaceId: selected.legacyPlaceId,
      strollId: input.stroll.id,
      interactionType: "selected_for_stroll",
      interactionSource: "stroll_context_shadow",
      metadata: { curationVersion: input.plan.version },
    });
  }

  const excludedCandidateCounts = enrichedCandidates.reduce<Record<string, number>>((counts, candidate) => {
    if (candidate.exclusionReason) counts[candidate.exclusionReason] = (counts[candidate.exclusionReason] ?? 0) + 1;
    return counts;
  }, {});
  const resolvedCount = enrichedCandidates.filter((candidate) => candidate.canonicalPlaceId).length;
  const staleEvidenceCount = enrichedCandidates.filter((candidate) => (
    candidate.sourceFreshness.stale || candidate.databaseEvidence.expiredEvidenceCount > 0
  )).length;
  const missingEvidenceCount = enrichedCandidates.filter((candidate) => (
    !candidate.evidenceSummary.hasSource || candidate.databaseEvidence.evidenceRowCount === 0
  )).length;
  const selectedCandidateCount = enrichedCandidates.filter((candidate) => candidate.selected).length;

  return {
    contextSchemaVersion: STROLL_CONTEXT_SCHEMA_VERSION,
    curationVersion: STROLL_CURATION_VERSION,
    generatedAt: new Date().toISOString(),
    request: {
      strollId: input.stroll.id,
      userId: input.userId,
      city: input.stroll.city,
      source: input.stroll.source,
      startDate: input.stroll.startDate,
      requestedStartTime: input.stroll.requestedStartTime,
      travellerCount: input.stroll.travellerCount,
      interests: input.stroll.interests,
      coordinates: input.stroll.latitude != null && input.stroll.longitude != null
        ? { latitude: input.stroll.latitude, longitude: input.stroll.longitude }
        : null,
    },
    user: {
      savedPlaceCount: input.savedPlaces.length,
      preferences,
      recentInteractions,
    },
    environment: {
      sharedCandidateCount: sharedCandidates.length,
    },
    candidates: enrichedCandidates,
    sourceFreshness: {
      missingEvidenceCount,
      staleEvidenceCount,
    },
    diagnostics: {
      candidateOverlap: input.plan.stops.filter((stop) => enrichedCandidates.some((candidate) => candidate.legacyPlaceId === stop.placeId)).length,
      selectedPlaceOverlap: selectedCandidateCount,
      canonicalResolutionRate: enrichedCandidates.length ? resolvedCount / enrichedCandidates.length : 0,
      excludedCandidateCounts,
      missingEvidenceCount,
      staleEvidenceCount,
      builderDurationMs: Date.now() - startedAt,
      snapshotFailures: 0,
    },
  };
}

export async function persistStrollGenerationSnapshot(input: {
  client: Queryable;
  context: StrollGenerationContext;
}) {
  const attempt = await input.client.query<{ generation_attempt: number }>(
    `select coalesce(max(generation_attempt), 0) + 1 as generation_attempt
     from stroll_generation_snapshots
     where stroll_id = $1`,
    [input.context.request.strollId],
  );
  const snapshot = await input.client.query<SnapshotRow>(
    `insert into stroll_generation_snapshots (
       stroll_id, user_id, generation_attempt, context_schema_version, curation_version,
       request_context_json, user_context_snapshot_json, environment_context_snapshot_json,
       source_freshness_summary_json, diagnostics_json, generated_at
     )
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, now())
     returning id`,
    [
      input.context.request.strollId,
      input.context.request.userId,
      attempt.rows[0]?.generation_attempt ?? 1,
      input.context.contextSchemaVersion,
      input.context.curationVersion,
      JSON.stringify(input.context.request),
      JSON.stringify(input.context.user),
      JSON.stringify(input.context.environment),
      JSON.stringify(input.context.sourceFreshness),
      JSON.stringify(input.context.diagnostics),
    ],
  );
  const snapshotId = snapshot.rows[0].id;

  for (const candidate of input.context.candidates) {
    await input.client.query(
      `insert into stroll_candidate_snapshots (
         snapshot_id, canonical_place_id, legacy_place_id, eligible, exclusion_reason,
         deterministic_score, candidate_rank, selected, scoring_factors_json,
         evidence_summary_json, source_freshness_json, created_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, now())`,
      [
        snapshotId,
        candidate.canonicalPlaceId,
        candidate.legacyPlaceId || null,
        candidate.eligible,
        candidate.exclusionReason,
        candidate.deterministicScore,
        candidate.candidateRank,
        candidate.selected,
        JSON.stringify({ ...candidate.scoringFactors, source: candidate.source, resolutionStrategy: candidate.resolutionStrategy }),
        JSON.stringify({ ...candidate.evidenceSummary, database: candidate.databaseEvidence }),
        JSON.stringify({ ...candidate.sourceFreshness, databaseLatestObservedAt: candidate.databaseEvidence.latestObservedAt }),
      ],
    );
  }

  return snapshotId;
}

export async function runStrollContextShadow(input: {
  database: PostgresDatabase;
  userId: string;
  stroll: StrollSummary;
  savedPlaces: SavedPlaceForStrollCuration[];
  plan: GeneratedStrollPlan;
}): Promise<StrollContextShadowResult> {
  const client = await input.database.connect() as TransactionClient;
  try {
    await client.query("begin");
    const contextOperationRunId = await createOperationRun(client, {
      operationType: "stroll_context_build",
      userId: input.userId,
      correlationId: input.stroll.id,
      entityType: "stroll",
      entityId: input.stroll.id,
      inputSummary: {
        city: input.stroll.city,
        savedPlaceCount: input.savedPlaces.length,
        plannedStopCount: input.plan.stops.length,
      },
    });
    const context = await buildStrollContext({
      client,
      userId: input.userId,
      stroll: input.stroll,
      savedPlaces: input.savedPlaces,
      plan: input.plan,
    });
    if (contextOperationRunId) {
      await completeOperationRun(client, {
        operationRunId: contextOperationRunId,
        status: "succeeded",
        outputSummary: {
          candidateCount: context.candidates.length,
          builderDurationMs: context.diagnostics.builderDurationMs,
        },
      });
    }
    const snapshotOperationRunId = await createOperationRun(client, {
      operationType: "stroll_snapshot_persistence",
      userId: input.userId,
      correlationId: input.stroll.id,
      entityType: "stroll",
      entityId: input.stroll.id,
      inputSummary: {
        candidateCount: context.candidates.length,
        contextSchemaVersion: context.contextSchemaVersion,
      },
    });
    const snapshotId = await persistStrollGenerationSnapshot({ client, context });
    if (snapshotOperationRunId) {
      await completeOperationRun(client, {
        operationRunId: snapshotOperationRunId,
        status: "succeeded",
        outputSummary: { snapshotId },
      });
    }
    await client.query("commit");
    return { snapshotId, context, error: null };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    console.warn("stroll_context_shadow_failed", {
      userId: input.userId,
      strollId: input.stroll.id,
      error: message,
    });
    await input.database.query(
      `insert into failure_events (
         id, scope, severity, error_code, error_category, user_id, correlation_id,
         entity_type, entity_id, public_message, internal_message, retryable,
         metadata_json, occurred_at
       )
       values (gen_random_uuid(), 'background_job', 'warning', 'stroll_context_shadow_failed',
         'stroll_shadow_snapshot', $1, $2, 'stroll', $2, $3, $4, true, $5::jsonb, now())`,
      [
        input.userId,
        input.stroll.id,
        "Stroll context snapshot failed in shadow mode",
        message,
        JSON.stringify({ visibleGenerationUnaffected: true }),
      ],
    ).catch(() => undefined);
    await input.database.query(
      `insert into app_usage_events (event_type, user_id, metadata_json, created_at)
       values ('stroll_context_shadow_failed', $1, $2::jsonb, now())`,
      [input.userId, JSON.stringify({ strollId: input.stroll.id, error: message })],
    ).catch(() => undefined);
    return { snapshotId: null, context: null, error: message };
  } finally {
    client.release();
  }
}

export async function backfillStrollInformationFoundation(input: {
  database: PostgresDatabase;
  batchSize?: number;
}) {
  const batchSize = Math.max(1, Math.min(1000, input.batchSize ?? 100));
  const client = await input.database.connect() as TransactionClient;
  const summary = {
    resolved: 0,
    created: 0,
    skipped: 0,
    ambiguous: 0,
    failed: 0,
  };

  try {
    await client.query("begin");
    const rows = await client.query<{
      id: string;
      place_id: string;
      title: string;
      category: string | null;
      metadata_json: unknown;
      created_at: string | null;
      updated_at: string | null;
    }>(
      `select id, place_id, title, category, metadata_json, created_at, updated_at
       from user_saved_places
       where canonical_place_id is null
       order by created_at asc
       limit $1
       for update skip locked`,
      [batchSize],
    );

    for (const row of rows.rows) {
      const place: SavedPlaceForStrollCuration = {
        id: row.id,
        placeId: row.place_id,
        title: row.title,
        category: row.category,
        metadata: row.metadata_json,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      try {
        const resolution = await resolveCanonicalPlace(client, place);
        summary[resolution.status] += 1;
        if (resolution.canonicalPlaceId) {
          await writePlaceEvidence(client, resolution.canonicalPlaceId, place);
          await client.query(
            "update user_saved_places set canonical_place_id = $2, updated_at = now() where id = $1 and canonical_place_id is null",
            [place.id, resolution.canonicalPlaceId],
          );
        }
      } catch {
        summary.failed += 1;
      }
    }

    await client.query("commit");
    return { ...summary, processed: rows.rows.length };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
