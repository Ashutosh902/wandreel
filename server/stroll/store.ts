import { getPostgresDatabase, type PostgresDatabase } from "../auth/postgresAuth";
import type {
  CreateDraftStrollInput,
  HeroBookmarkInput,
  HeroInteractionInput,
  UpdateOnboardingInput,
} from "./contracts";
import {
  generateDeterministicStrollPlan,
  StrollCurationPipelineError,
  type SavedPlaceForStrollCuration,
} from "./curation";
import {
  enrichStopDescriptionIfNeeded,
  type PersistedStrollStopEnrichment,
  type StrollStopEnrichmentGenerator,
  type TrustedStrollStopInput,
} from "./enrichment";
import type {
  HeroBookmark,
  OnboardingDecision,
  StrollDetail,
  StrollOnboardingPreference,
  StrollSource,
  StrollStatus,
  StrollStop,
  StrollSummary,
} from "./types";
import { validateStrollStopsForReady } from "./curationValidation";

type Queryable = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

type TransactionClient = Queryable & {
  release: () => void;
};

type OnboardingRow = {
  onboarding_decision: OnboardingDecision;
  onboarding_decision_at: string | Date | null;
  default_traveller_count: number | string | null;
  default_interests_json: unknown;
  default_start_time: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type StrollRow = {
  id: string;
  name: string;
  description: string | null;
  city: string;
  status: StrollStatus;
  source: StrollSource;
  start_date: string | Date | null;
  end_date: string | Date | null;
  requested_start_time: string | null;
  traveller_count: number | string | null;
  interests_json: unknown;
  latitude: number | string | null;
  longitude: number | string | null;
  total_distance_meters: number | string | null;
  estimated_duration_minutes: number | string | null;
  stop_count: number | string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  curated_at: string | Date | null;
  archived_at: string | Date | null;
};

type SavedPlaceIdRow = {
  place_id: string;
};

type SavedPlaceForCurationRow = {
  id: string;
  place_id: string;
  title: string;
  category: string | null;
  metadata_json: unknown;
  created_at: string | Date | null;
  updated_at: string | Date | null;
};

type ReorderStopRow = {
  id: string;
  place_id: string;
  sequence: number | string;
  owned_place_id: string | null;
};

type StrollStopRow = {
  id: string;
  place_id: string;
  place_title: string | null;
  place_category: string | null;
  place_metadata_json: unknown | null;
  sequence: number | string;
  reason: string | null;
  generated_description: string | null;
  description_generation_meta_json: unknown | null;
  estimated_visit_duration_minutes: number | string | null;
  arrival_estimate: string | Date | null;
  departure_estimate: string | Date | null;
  route_distance_meters: number | string | null;
  route_duration_minutes: number | string | null;
};

type HeroBookmarkRow = {
  id: string;
  card_key: string;
  hero_type: string;
  cta_action: string | null;
  title: string | null;
  subtitle: string | null;
  metadata_json: unknown;
  matching_place_ids_json: unknown;
  created_at: string | Date;
  updated_at: string | Date;
};

type ReadyHeroStrollCandidateRow = {
  id: string;
  user_id: string;
  city: string;
  source: StrollSource;
  interests_json: unknown;
  stop_place_ids_json: unknown;
  stop_categories_json: unknown;
};

const strollSelectColumns = `
  s.id,
  s.name,
  s.description,
  s.city,
  s.status,
  s.source,
  s.start_date,
  s.end_date,
  s.requested_start_time,
  s.traveller_count,
  s.interests_json,
  s.latitude,
  s.longitude,
  s.total_distance_meters,
  s.estimated_duration_minutes,
  s.failure_code,
  s.failure_message,
  (
    select count(*)::int
    from stroll_stops ss
    where ss.stroll_id = s.id
  ) as stop_count,
  s.created_at,
  s.updated_at,
  s.curated_at,
  s.archived_at
`;

const strollReturningColumns = `
  id,
  name,
  description,
  city,
  status,
  source,
  start_date,
  end_date,
  requested_start_time,
  traveller_count,
  interests_json,
  latitude,
  longitude,
  total_distance_meters,
  estimated_duration_minutes,
  failure_code,
  failure_message,
  0::int as stop_count,
  created_at,
  updated_at,
  curated_at,
  archived_at
`;

function database(): PostgresDatabase {
  return getPostgresDatabase();
}

function toIso(value: string | Date | null | undefined) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function toDateOnly(value: string | Date | null | undefined) {
  const iso = toIso(value);
  return iso ? iso.slice(0, 10) : null;
}

function toNullableNumber(value: number | string | null | undefined) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toJsonString(value: unknown) {
  return JSON.stringify(value ?? {});
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
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

function metadataRecord(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function metadataStringArray(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function mapWeatherSuitability(metadata: Record<string, unknown>) {
  const suitability = metadataRecord(metadata, "suitability");
  const raw =
    metadataString(metadata, "weatherSuitability") ||
    metadataString(metadata, "weather_suitability") ||
    metadataString(suitability, "weather") ||
    metadataString(suitability, "weatherSuitability");
  const normalized = raw?.toLowerCase();
  if (normalized === "indoor" || normalized === "outdoor" || normalized === "sheltered") return normalized;
  if (metadata["indoor"] === true || metadata["isIndoor"] === true) return "indoor";
  if (metadata["outdoor"] === true || metadata["isOutdoor"] === true) return "outdoor";
  return "unknown";
}

function mapStopSuitability(metadata: Record<string, unknown>): StrollStop["suitability"] {
  return {
    weather: mapWeatherSuitability(metadata),
    openingHours: metadata["openingHours"] ?? metadata["opening_hours"] ?? null,
    notes: metadataStringArray(metadata, "suitabilityNotes"),
  };
}

function mapOnboardingRow(row: OnboardingRow): StrollOnboardingPreference {
  return {
    decision: row.onboarding_decision,
    decisionAt: toIso(row.onboarding_decision_at),
    defaultTravellerCount: toNullableNumber(row.default_traveller_count),
    defaultInterests: toStringArray(row.default_interests_json),
    defaultStartTime: row.default_start_time,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapStrollRow(row: StrollRow): StrollSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    city: row.city,
    status: row.status,
    source: row.source,
    startDate: toDateOnly(row.start_date),
    endDate: toDateOnly(row.end_date),
    requestedStartTime: row.requested_start_time,
    travellerCount: toNullableNumber(row.traveller_count),
    interests: toStringArray(row.interests_json),
    latitude: toNullableNumber(row.latitude),
    longitude: toNullableNumber(row.longitude),
    totalDistanceMeters: toNullableNumber(row.total_distance_meters),
    estimatedDurationMinutes: toNullableNumber(row.estimated_duration_minutes),
    stopCount: toNullableNumber(row.stop_count) ?? 0,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    createdAt: toIso(row.created_at) ?? "",
    updatedAt: toIso(row.updated_at) ?? "",
    curatedAt: toIso(row.curated_at),
    archivedAt: toIso(row.archived_at),
  };
}

function mapStopRow(row: StrollStopRow): StrollStop {
  const metadata = toRecord(row.place_metadata_json);
  const locality = metadataString(metadata, "locality");
  const address = metadataString(metadata, "fullAddress") || locality;
  return {
    id: row.id,
    placeId: row.place_id,
    placeTitle: row.place_title,
    placeCategory: row.place_category,
    placeLocality: locality,
    placeAddress: address,
    placeDescription: metadataString(metadata, "description") || metadataString(metadata, "latestDescription") || metadataString(metadata, "metaSecondary"),
    placeImageUrl: metadataString(metadata, "imageUrl"),
    placeVideoUrl: metadataString(metadata, "videoUrl"),
    latitude: metadataNumber(metadata, "lat"),
    longitude: metadataNumber(metadata, "lng"),
    sequence: toNullableNumber(row.sequence) ?? 0,
    reason: row.reason,
    generatedDescription: row.generated_description,
    descriptionGenerationMeta: row.description_generation_meta_json,
    estimatedVisitDurationMinutes: toNullableNumber(row.estimated_visit_duration_minutes),
    arrivalEstimate: toIso(row.arrival_estimate),
    departureEstimate: toIso(row.departure_estimate),
    routeDistanceMeters: toNullableNumber(row.route_distance_meters),
    routeDurationMinutes: toNullableNumber(row.route_duration_minutes),
    suitability: mapStopSuitability(metadata),
  };
}

function mapStopRowToTrustedInput(row: StrollStopRow): TrustedStrollStopInput {
  const metadata = toRecord(row.place_metadata_json);
  return {
    stopId: row.id,
    placeId: row.place_id,
    sequence: toNullableNumber(row.sequence) ?? 0,
    existingGeneratedDescription: row.generated_description,
    existingReason: row.reason,
    existingGenerationMeta: row.description_generation_meta_json,
    placeTitle: row.place_title,
    placeCategory: row.place_category,
    placeLocality: metadataString(metadata, "locality"),
    placeAddress: metadataString(metadata, "fullAddress"),
    placeDescription: metadataString(metadata, "description") || metadataString(metadata, "latestDescription") || metadataString(metadata, "metaSecondary"),
    placeMetaPrimary: metadataString(metadata, "metaPrimary"),
    placeMetaSecondary: metadataString(metadata, "metaSecondary"),
    sourceCaption:
      metadataString(metadata, "sourceCaption") ||
      metadataString(metadata, "caption") ||
      metadataString(metadata, "sourceDescription") ||
      metadataString(metadata, "latestDescription"),
    sourceUrl: metadataString(metadata, "sourceUrl") || metadataString(metadata, "videoUrl"),
  };
}

function mapSavedPlaceForCurationRow(row: SavedPlaceForCurationRow): SavedPlaceForStrollCuration {
  return {
    id: row.id,
    placeId: row.place_id,
    title: row.title,
    category: row.category,
    metadata: row.metadata_json ?? {},
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapBookmarkRow(row: HeroBookmarkRow): HeroBookmark {
  return {
    id: row.id,
    cardKey: row.card_key,
    heroType: row.hero_type,
    ctaAction: row.cta_action,
    title: row.title,
    subtitle: row.subtitle,
    metadata: row.metadata_json ?? {},
    matchingPlaceIds: toStringArray(row.matching_place_ids_json),
    createdAt: toIso(row.created_at) ?? "",
    updatedAt: toIso(row.updated_at) ?? "",
  };
}

async function connectTransaction(): Promise<TransactionClient> {
  const client = (await database().connect()) as TransactionClient;
  return client;
}

export async function getStrollOnboarding(userId: string): Promise<StrollOnboardingPreference> {
  const result = await database().query<OnboardingRow>(
    `select onboarding_decision,
            onboarding_decision_at,
            default_traveller_count,
            default_interests_json,
            default_start_time,
            created_at,
            updated_at
     from user_stroll_preferences
     where user_id = $1`,
    [userId],
  );

  const row = result.rows[0];
  if (!row) {
    return {
      decision: "unseen",
      decisionAt: null,
      defaultTravellerCount: null,
      defaultInterests: [],
      defaultStartTime: null,
      createdAt: null,
      updatedAt: null,
    };
  }
  return mapOnboardingRow(row);
}

export async function updateStrollOnboarding(userId: string, input: UpdateOnboardingInput) {
  const result = await database().query<OnboardingRow>(
    `insert into user_stroll_preferences (
       user_id,
       onboarding_decision,
       onboarding_decision_at,
       default_traveller_count,
       default_interests_json,
       default_start_time
     )
     values ($1, $2, now(), $3, $4::jsonb, $5)
     on conflict (user_id) do update set
       onboarding_decision = excluded.onboarding_decision,
       onboarding_decision_at = now(),
       default_traveller_count = excluded.default_traveller_count,
       default_interests_json = excluded.default_interests_json,
       default_start_time = excluded.default_start_time,
       updated_at = now()
     returning onboarding_decision,
               onboarding_decision_at,
               default_traveller_count,
               default_interests_json,
               default_start_time,
               created_at,
               updated_at`,
    [
      userId,
      input.decision,
      input.defaultTravellerCount ?? null,
      JSON.stringify(input.defaultInterests ?? []),
      input.defaultStartTime ?? null,
    ],
  );
  return mapOnboardingRow(result.rows[0]);
}

export class StrollDraftValidationError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "StrollDraftValidationError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function createDraftStroll(userId: string, input: CreateDraftStrollInput) {
  const existing = await database().query<StrollRow>(
    `select ${strollSelectColumns}
     from strolls s
     where s.user_id = $1 and s.client_request_id = $2
     limit 1`,
    [userId, input.clientRequestId],
  );
  if (existing.rows[0]) {
    return {
      created: false,
      stroll: mapStrollRow(existing.rows[0]),
    };
  }

  if (input.placeIds.length > 0) {
    const owned = await database().query<SavedPlaceIdRow>(
      `select place_id
       from user_saved_places
       where user_id = $1 and place_id = any($2::text[])`,
      [userId, input.placeIds],
    );
    const ownedIds = new Set(owned.rows.map((row) => row.place_id));
    const unowned = input.placeIds.filter((placeId) => !ownedIds.has(placeId));
    if (unowned.length > 0) {
      throw new StrollDraftValidationError(
        400,
        "invalid_place_ids",
        "Every draft Stroll placeId must belong to your saved places.",
      );
    }
  }

  const client = await connectTransaction();
  try {
    await client.query("begin");
    const inserted = await client.query<StrollRow>(
      `insert into strolls (
         user_id,
         client_request_id,
         name,
         city,
         status,
         source,
         start_date,
         end_date,
         requested_start_time,
         traveller_count,
         interests_json,
         latitude,
         longitude
       )
       values ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
       returning ${strollReturningColumns}`,
      [
        userId,
        input.clientRequestId,
        input.name,
        input.city,
        input.source,
        input.startDate ?? null,
        input.endDate ?? null,
        input.requestedStartTime ?? null,
        input.travellerCount ?? null,
        JSON.stringify(input.interests),
        input.latitude ?? null,
        input.longitude ?? null,
      ],
    );
    const stroll = inserted.rows[0];
    for (const [index, placeId] of input.placeIds.entries()) {
      await client.query(
        `insert into stroll_stops (stroll_id, place_id, sequence)
         values ($1, $2, $3)`,
        [stroll.id, placeId, index + 1],
      );
    }
    await client.query("commit");

    return {
      created: true,
      stroll: {
        ...mapStrollRow(stroll),
        stopCount: input.placeIds.length,
      },
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listStrolls(userId: string, includeArchived = false): Promise<StrollSummary[]> {
  const result = await database().query<StrollRow>(
    `select ${strollSelectColumns}
     from strolls s
     where s.user_id = $1
       and ($2::boolean or s.status <> 'archived')
     order by s.updated_at desc`,
    [userId, includeArchived],
  );
  return result.rows.map(mapStrollRow);
}

export type ReadyHeroStrollCandidate = {
  id: string;
  userId: string;
  city: string;
  source: StrollSource;
  interests: string[];
  stopPlaceIds: string[];
  stopCategories: string[];
};

export async function listReadyHeroStrollCandidates(userId: string): Promise<ReadyHeroStrollCandidate[]> {
  const result = await database().query<ReadyHeroStrollCandidateRow>(
    `select s.id,
            s.user_id,
            s.city,
            s.source,
            s.interests_json,
            coalesce(
              json_agg(ss.place_id order by ss.sequence) filter (where ss.place_id is not null),
              '[]'::json
            ) as stop_place_ids_json,
            coalesce(
              json_agg(usp.category order by ss.sequence) filter (where usp.category is not null),
              '[]'::json
            ) as stop_categories_json
     from strolls s
     left join stroll_stops ss on ss.stroll_id = s.id
     left join user_saved_places usp
       on usp.user_id = s.user_id and usp.place_id = ss.place_id
     where s.user_id = $1 and s.status = 'ready'
     group by s.id, s.user_id, s.city, s.source, s.interests_json, s.updated_at
     order by s.updated_at desc`,
    [userId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    city: row.city,
    source: row.source,
    interests: toStringArray(row.interests_json),
    stopPlaceIds: toStringArray(row.stop_place_ids_json),
    stopCategories: toStringArray(row.stop_categories_json),
  }));
}

export async function getStrollSummary(userId: string, strollId: string): Promise<StrollSummary | null> {
  const result = await database().query<StrollRow>(
    `select ${strollSelectColumns}
     from strolls s
     where s.user_id = $1 and s.id = $2
     limit 1`,
    [userId, strollId],
  );
  const row = result.rows[0];
  return row ? mapStrollRow(row) : null;
}

export async function getStrollDetail(userId: string, strollId: string): Promise<StrollDetail | null> {
  const strollResult = await database().query<StrollRow>(
    `select ${strollSelectColumns}
     from strolls s
     where s.user_id = $1 and s.id = $2
     limit 1`,
    [userId, strollId],
  );
  const stroll = strollResult.rows[0];
  if (!stroll) return null;

  const stopsResult = await database().query<StrollStopRow>(
    `select ss.id,
            ss.place_id,
            usp.title as place_title,
            usp.category as place_category,
            usp.metadata_json as place_metadata_json,
            ss.sequence,
            ss.reason,
            ss.generated_description,
            ss.description_generation_meta_json,
            ss.estimated_visit_duration_minutes,
            ss.arrival_estimate,
            ss.departure_estimate,
            ss.route_distance_meters,
            ss.route_duration_minutes
     from stroll_stops ss
     left join user_saved_places usp
       on usp.user_id = $2 and usp.place_id = ss.place_id
     where ss.stroll_id = $1
     order by ss.sequence asc`,
    [strollId, userId],
  );

  return {
    ...mapStrollRow(stroll),
    stops: stopsResult.rows.map(mapStopRow),
  };
}

async function getTrustedStopInputsForEnrichment(userId: string, strollId: string): Promise<TrustedStrollStopInput[] | null> {
  const stroll = await getStrollSummary(userId, strollId);
  if (!stroll) return null;
  const stopsResult = await database().query<StrollStopRow>(
    `select ss.id,
            ss.place_id,
            usp.title as place_title,
            usp.category as place_category,
            usp.metadata_json as place_metadata_json,
            ss.sequence,
            ss.reason,
            ss.generated_description,
            ss.description_generation_meta_json,
            ss.estimated_visit_duration_minutes,
            ss.arrival_estimate,
            ss.departure_estimate,
            ss.route_distance_meters,
            ss.route_duration_minutes
     from stroll_stops ss
     left join user_saved_places usp
       on usp.user_id = $2 and usp.place_id = ss.place_id
     where ss.stroll_id = $1
     order by ss.sequence asc`,
    [strollId, userId],
  );
  return stopsResult.rows.map(mapStopRowToTrustedInput);
}

async function persistStopEnrichment(strollId: string, enrichment: PersistedStrollStopEnrichment): Promise<void> {
  await database().query(
    `update stroll_stops
     set generated_description = coalesce($3, generated_description),
         reason = case
           when reason is null or trim(reason) = '' then coalesce($4, reason)
           else reason
         end,
         description_generation_meta_json = $5::jsonb,
         updated_at = now()
     where stroll_id = $1 and id = $2`,
    [
      strollId,
      enrichment.stopId,
      enrichment.description,
      enrichment.reason,
      JSON.stringify(enrichment.metadata),
    ],
  );
}

export async function enrichPersistedStrollStopDescriptions(
  userId: string,
  strollId: string,
  generator?: StrollStopEnrichmentGenerator,
): Promise<void> {
  const stops = await getTrustedStopInputsForEnrichment(userId, strollId);
  if (!stops) return;

  for (const stop of stops) {
    const enrichment = await enrichStopDescriptionIfNeeded(stop, generator);
    if (!enrichment) continue;
    await persistStopEnrichment(strollId, enrichment);
  }
}

async function listSavedPlacesForStrollCuration(userId: string): Promise<SavedPlaceForStrollCuration[]> {
  const result = await database().query<SavedPlaceForCurationRow>(
    `select id,
            place_id,
            title,
            category,
            metadata_json,
            created_at,
            updated_at
     from user_saved_places
     where user_id = $1
     order by created_at desc`,
    [userId],
  );
  return result.rows.map(mapSavedPlaceForCurationRow);
}

export async function generatePersistedStrollStopsFromSavedPlaces(userId: string, strollId: string): Promise<void> {
  if (process.env.STROLL_REAL_CURATION_ENABLED === "false") {
    throw new StrollCurationPipelineError("curation_disabled", "Real Stroll curation is disabled.");
  }

  const stroll = await getStrollSummary(userId, strollId);
  if (!stroll) {
    throw new StrollCurationPipelineError("stroll_not_found", "Stroll not found.");
  }
  if (stroll.stopCount > 0) return;

  const savedPlaces = await listSavedPlacesForStrollCuration(userId);
  const plan = generateDeterministicStrollPlan(stroll, savedPlaces);

  const client = await connectTransaction();
  try {
    await client.query("begin");
    const locked = await client.query(
      `select id
       from strolls
       where user_id = $1 and id = $2
       limit 1
       for update`,
      [userId, strollId],
    );
    if (!locked.rows[0]) {
      await client.query("rollback");
      throw new StrollCurationPipelineError("stroll_not_found", "Stroll not found.");
    }

    await client.query("delete from stroll_stops where stroll_id = $1", [strollId]);
    for (const stop of plan.stops) {
      await client.query(
        `insert into stroll_stops (
           stroll_id,
           place_id,
           sequence,
           reason,
           estimated_visit_duration_minutes,
           route_distance_meters,
           route_duration_minutes
         )
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          strollId,
          stop.placeId,
          stop.sequence,
          stop.reason,
          stop.estimatedVisitDurationMinutes,
          stop.routeDistanceMeters,
          stop.routeDurationMinutes,
        ],
      );
    }

    await client.query(
      `update strolls
       set total_distance_meters = $3,
           estimated_duration_minutes = $4,
           generation_version = $5,
           updated_at = now()
       where user_id = $1 and id = $2`,
      [userId, strollId, plan.totalDistanceMeters, plan.estimatedDurationMinutes, plan.version],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function markStrollQueued(userId: string, strollId: string): Promise<StrollSummary | null> {
  const result = await database().query(
    `update strolls
     set status = 'queued',
         failure_code = null,
         failure_message = null,
         updated_at = now()
     where user_id = $1 and id = $2`,
    [userId, strollId],
  );
  if (Number(result.rowCount ?? 0) === 0) return null;
  return getStrollSummary(userId, strollId);
}

export async function markStrollCurating(userId: string, strollId: string): Promise<StrollSummary | null> {
  const result = await database().query(
    `update strolls
     set status = 'curating',
         failure_code = null,
         failure_message = null,
         updated_at = now()
     where user_id = $1 and id = $2`,
    [userId, strollId],
  );
  if (Number(result.rowCount ?? 0) === 0) return null;
  return getStrollSummary(userId, strollId);
}

export async function markStrollReady(userId: string, strollId: string): Promise<StrollSummary | null> {
  const result = await database().query(
    `update strolls
     set status = 'ready',
         failure_code = null,
         failure_message = null,
         curated_at = coalesce(curated_at, now()),
         updated_at = now()
     where user_id = $1 and id = $2`,
    [userId, strollId],
  );
  if (Number(result.rowCount ?? 0) === 0) return null;
  return getStrollSummary(userId, strollId);
}

export async function markStrollFailed(
  userId: string,
  strollId: string,
  failureCode: string,
  failureMessage: string,
): Promise<StrollSummary | null> {
  const result = await database().query(
    `update strolls
     set status = 'failed',
         failure_code = $3,
         failure_message = $4,
         updated_at = now()
     where user_id = $1 and id = $2`,
    [userId, strollId, failureCode, failureMessage],
  );
  if (Number(result.rowCount ?? 0) === 0) return null;
  return getStrollSummary(userId, strollId);
}

export async function validatePersistedStrollForReady(userId: string, strollId: string): Promise<void> {
  const stroll = await getStrollDetail(userId, strollId);
  if (!stroll) {
    throw new Error("Stroll not found.");
  }

  const placeIds = stroll.stops.map((stop) => stop.placeId);
  const ownedPlaceIds = placeIds.length
    ? await database().query<SavedPlaceIdRow>(
        `select place_id
         from user_saved_places
         where user_id = $1 and place_id = any($2::text[])`,
        [userId, placeIds],
      )
    : { rows: [] };

  validateStrollStopsForReady(
    stroll.stops.map((stop) => ({ placeId: stop.placeId, sequence: stop.sequence })),
    ownedPlaceIds.rows.map((row) => row.place_id),
  );
}

export class StrollReorderValidationError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "StrollReorderValidationError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function validateAcceptedStopOrder(existingStops: ReorderStopRow[], requestedStopIds: string[]) {
  if (existingStops.length === 0) {
    throw new StrollReorderValidationError(409, "no_stops", "This Stroll has no stops to reorder.");
  }
  if (requestedStopIds.length !== existingStops.length) {
    throw new StrollReorderValidationError(400, "partial_reorder_not_supported", "A full stop order is required.");
  }
  const unique = new Set(requestedStopIds);
  if (unique.size !== requestedStopIds.length) {
    throw new StrollReorderValidationError(400, "duplicate_stop", "Stop order cannot contain duplicates.");
  }
  const existingIds = new Set(existingStops.map((stop) => stop.id));
  const missing = existingStops.some((stop) => !unique.has(stop.id));
  const foreign = requestedStopIds.some((stopId) => !existingIds.has(stopId));
  if (foreign) {
    throw new StrollReorderValidationError(400, "foreign_stop", "Stop order contains a stop outside this Stroll.");
  }
  if (missing) {
    throw new StrollReorderValidationError(400, "missing_stop", "Stop order is missing one or more saved stops.");
  }
  if (existingStops.some((stop) => !stop.owned_place_id)) {
    throw new StrollReorderValidationError(400, "foreign_place", "Every reordered stop must belong to your saved places.");
  }
}

export async function acceptStrollStopOrder(userId: string, strollId: string, stopIds: string[]): Promise<StrollDetail | null> {
  const client = await connectTransaction();
  try {
    await client.query("begin");
    const stopsResult = await client.query<ReorderStopRow>(
      `select ss.id,
              ss.place_id,
              ss.sequence,
              usp.place_id as owned_place_id
       from strolls s
       join stroll_stops ss on ss.stroll_id = s.id
       left join user_saved_places usp
         on usp.user_id = s.user_id and usp.place_id = ss.place_id
       where s.user_id = $1 and s.id = $2
       order by ss.sequence asc
       for update of ss`,
      [userId, strollId],
    );
    if (stopsResult.rows.length === 0) {
      const stroll = await client.query(`select id from strolls where user_id = $1 and id = $2 limit 1`, [userId, strollId]);
      if (!stroll.rows[0]) {
        await client.query("rollback");
        return null;
      }
    }

    validateAcceptedStopOrder(stopsResult.rows, stopIds);

    for (const [index, stop] of stopsResult.rows.entries()) {
      await client.query(
        `update stroll_stops
         set sequence = $3,
             updated_at = now()
         where stroll_id = $1 and id = $2`,
        [strollId, stop.id, -(index + 1)],
      );
    }

    for (const [index, stopId] of stopIds.entries()) {
      await client.query(
        `update stroll_stops
         set sequence = $3,
             updated_at = now()
         where stroll_id = $1 and id = $2`,
        [strollId, stopId, index + 1],
      );
    }

    await client.query(
      `update strolls
       set updated_at = now()
       where user_id = $1 and id = $2`,
      [userId, strollId],
    );
    await client.query("commit");
    return getStrollDetail(userId, strollId);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function archiveStroll(userId: string, strollId: string): Promise<StrollSummary | null> {
  const result = await database().query<StrollRow>(
    `update strolls s
     set status = 'archived',
         archived_at = coalesce(archived_at, now()),
         updated_at = now()
     where s.user_id = $1 and s.id = $2
     returning ${strollReturningColumns}`,
    [userId, strollId],
  );
  const row = result.rows[0];
  return row ? mapStrollRow(row) : null;
}

export async function listHeroBookmarks(userId: string): Promise<HeroBookmark[]> {
  const result = await database().query<HeroBookmarkRow>(
    `select id,
            card_key,
            hero_type,
            cta_action,
            title,
            subtitle,
            metadata_json,
            matching_place_ids_json,
            created_at,
            updated_at
     from hero_bookmarks
     where user_id = $1 and deleted_at is null
     order by updated_at desc`,
    [userId],
  );
  return result.rows.map(mapBookmarkRow);
}

export async function upsertHeroBookmark(userId: string, input: HeroBookmarkInput): Promise<HeroBookmark> {
  const result = await database().query<HeroBookmarkRow>(
    `insert into hero_bookmarks (
       user_id,
       card_key,
       hero_type,
       cta_action,
       title,
       subtitle,
       metadata_json,
       matching_place_ids_json
     )
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
     on conflict (user_id, card_key) do update set
       hero_type = excluded.hero_type,
       cta_action = excluded.cta_action,
       title = excluded.title,
       subtitle = excluded.subtitle,
       metadata_json = excluded.metadata_json,
       matching_place_ids_json = excluded.matching_place_ids_json,
       deleted_at = null,
       updated_at = now()
     returning id,
               card_key,
               hero_type,
               cta_action,
               title,
               subtitle,
               metadata_json,
               matching_place_ids_json,
               created_at,
               updated_at`,
    [
      userId,
      input.cardKey,
      input.heroType,
      input.ctaAction ?? null,
      input.title ?? null,
      input.subtitle ?? null,
      toJsonString(input.metadata ?? {}),
      JSON.stringify(input.matchingPlaceIds ?? []),
    ],
  );
  return mapBookmarkRow(result.rows[0]);
}

export async function removeHeroBookmark(userId: string, cardKey: string): Promise<boolean> {
  const result = await database().query(
    `update hero_bookmarks
     set deleted_at = now(),
         updated_at = now()
     where user_id = $1 and card_key = $2 and deleted_at is null`,
    [userId, cardKey],
  );
  return Number(result.rowCount ?? 0) > 0;
}

export async function recordHeroInteraction(userId: string, input: HeroInteractionInput): Promise<void> {
  await database().query(
    `insert into hero_interactions (user_id, card_key, hero_type, action, metadata_json)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [userId, input.cardKey, input.heroType ?? null, input.action, toJsonString(input.metadata ?? {})],
  );
}
