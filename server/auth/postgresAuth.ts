import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

export type AuthProvider = "EMAIL" | "GOOGLE" | "PHONE" | "FACEBOOK" | "APPLE";

type UserRecord = {
  id: string;
  email: string | null;
  email_verified: boolean;
  phone_number: string | null;
  phone_verified: boolean;
  display_name: string | null;
  avatar_url: string | null;
  auth_provider: AuthProvider | null;
  provider_id: string | null;
  created_at: string;
  updated_at: string;
};

type SessionRecord = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

type SavedPlaceRecord = {
  id: string;
  user_id: string;
  place_id: string;
  title: string;
  category: string | null;
  metadata_json: unknown;
  created_at: string;
  updated_at: string;
};

type ReelAnalyticsRunRecord = {
  id: string;
};

type SubmittedLinkRecord = {
  id: string;
};

type ReusableMetadataExtractionRecord = {
  submitted_link_id: string;
  canonical_url: string;
  run_id: string;
  client_run_id: string | null;
  user_id: string | null;
  anonymous_id: string | null;
  attempt_id: string | null;
  attempt_number: number | null;
  status: string | null;
  failure_reason: string | null;
  extraction_result_json: unknown;
  intelligence_status: string | null;
};

type AdminObservabilityOverviewRow = {
  total_submitted_links: number | string | null;
  total_runs: number | string | null;
  total_attempts: number | string | null;
  saved_runs: number | string | null;
  edited_runs: number | string | null;
  discarded_runs: number | string | null;
  average_attempt_count: number | string | null;
  average_extraction_time_ms: number | string | null;
  estimated_cache_reuse_count: number | string | null;
  estimated_duplicate_saved_place_count: number | string | null;
};

type ReelJobRecord = {
  id: string;
  run_id: string | null;
  attempt_id: string | null;
  attempt_number: number | null;
  job_type: string;
  status: string;
  progress_json: Record<string, unknown> | null;
  result_json: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

const DATABASE_URL = process.env.DATABASE_URL || "";
const SESSION_COOKIE_NAME = "wr_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const EMAIL_OTP_TTL_MS = 1000 * 60 * 10;

type DatabaseLike = Pick<Pool, "query" | "connect">;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
});

let databaseUrl = DATABASE_URL;
let database: DatabaseLike = pool;
let schemaReady = false;

export function isPostgresConfigured() {
  return Boolean(databaseUrl.trim());
}

export type ReelAnalyticsAttemptInput = {
  clientRunId: string;
  userId?: string | null;
  anonymousId?: string | null;
  sourceUrl: string;
  sourcePlatform?: string | null;
  attemptNumber: number;
  triggerType: "initial" | "retry";
};

export type ReelAnalyticsAttemptResult = {
  attemptId: string;
  runId: string;
};

export type ReelAnalyticsAttemptCompletion = {
  attemptId: string;
  status: "completed" | "failed";
  sourcePlatform?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  providerLatencyMs?: number | null;
  totalLatencyMs?: number | null;
  entityCount?: number | null;
  intelligenceStatus?: string | null;
  validationErrorCount?: number | null;
  failureReason?: string | null;
};

export type ReelAnalyticsAttemptArtifactsInput = {
  attemptId?: string | null;
  runId?: string | null;
  attemptNumber?: number | null;
  extractionResult?: unknown;
  intelligenceResult?: unknown;
  hypothesisSummary?: unknown;
};

export type ReelAnalyticsEventInput = {
  clientRunId: string;
  userId?: string | null;
  anonymousId?: string | null;
  sourceUrl?: string | null;
  sourcePlatform?: string | null;
  attemptNumber?: number | null;
  eventName: "saved" | "edited" | "discarded";
  payload?: unknown;
};

export type ReelAnalyticsEntitiesUpsertInput = {
  runId: string;
  attemptId?: string | null;
  attemptNumber: number;
  entities: Array<{
    entityIndex: number;
    entityType?: string | null;
    title?: string | null;
    subtitle?: string | null;
    placeCandidateId?: string | null;
    finalPlaceId?: string | null;
    confidence?: number | null;
    metadataJson?: Record<string, unknown> | null;
  }>;
};

export type ReelAnalyticsEntityOutcomeInput = {
  runId: string;
  attemptNumber: number;
  entityIndex?: number | null;
  entityId?: string | null;
  eventName: "saved" | "edited" | "discarded";
  finalPlaceId?: string | null;
};

export type ReelJobCreateInput = {
  jobId?: string;
  runId?: string | null;
  attemptId?: string | null;
  attemptNumber?: number | null;
  jobType?: string;
  status?: "queued" | "running" | "completed" | "failed";
  progressJson?: Record<string, unknown>;
};

export type ReelJobUpdateInput = {
  jobId: string;
  status?: "queued" | "running" | "completed" | "failed";
  progressJson?: Record<string, unknown>;
  resultJson?: Record<string, unknown> | null;
  errorMessage?: string | null;
};

export type ReelJobDto = {
  id: string;
  runId: string | null;
  attemptId: string | null;
  attemptNumber: number | null;
  jobType: string;
  status: string;
  progressJson: Record<string, unknown>;
  resultJson: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SubmittedLinkUpsertInput = {
  canonicalUrl: string;
  canonicalUrlHash?: string | null;
  sourcePlatform?: string | null;
  latestTitle?: string | null;
  latestDescription?: string | null;
  latestImageUrl?: string | null;
};

export type SubmittedLinkUpsertResult = {
  id: string;
};

export type ReusableMetadataExtractionLookupResult = {
  submittedLinkId: string;
  canonicalUrl: string;
  runId: string;
  clientRunId: string | null;
  userId: string | null;
  anonymousId: string | null;
  attemptId: string | null;
  attemptNumber: number | null;
  status: string | null;
  failureReason: string | null;
  extractionResult: unknown;
  priorStatus: string | null;
};

export type AdminObservabilityOverviewInput = {
  from?: string | null;
  to?: string | null;
  platform?: string | null;
};

export type AdminObservabilityOverviewResult = {
  totalSubmittedLinks: number;
  totalRuns: number;
  totalAttempts: number;
  savedRuns: number;
  editedRuns: number;
  discardedRuns: number;
  saveRate: number;
  editRate: number;
  discardRate: number;
  averageAttemptCount: number;
  averageExtractionTimeMs: number | null;
  estimatedCacheReuseCount: number;
  estimatedDuplicateSavedPlaceCount: number;
};

type AdminObservabilityLinksRow = {
  submitted_link_id: string;
  canonical_url: string;
  platform: string | null;
  first_seen_at: string;
  last_seen_at: string;
  run_count: number | string | null;
  attempt_count: number | string | null;
  latest_status: string | null;
  latest_accepted_after: string | null;
  latest_route: string | null;
  cache_reuse_count: number | string | null;
  final_selected_place_id: string | null;
  final_user_action: string | null;
};

export type AdminObservabilityLinksInput = {
  from?: string | null;
  to?: string | null;
  platform?: string | null;
  status?: string | null;
  reused?: boolean | null;
  acceptedAfter?: string | null;
  q?: string | null;
  page?: number | null;
  pageSize?: number | null;
};

export type AdminObservabilityLinksItemResult = {
  submittedLinkId: string;
  canonicalUrl: string;
  platform: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  runCount: number;
  attemptCount: number;
  latestStatus: string | null;
  latestAcceptedAfter: string | null;
  latestRoute: string | null;
  cacheReuseCount: number;
  finalSelectedPlaceId: string | null;
  finalUserAction: string | null;
};

export type AdminObservabilityLinksResult = {
  rows: AdminObservabilityLinksItemResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type AdminUsageActorRow = {
  actor_key: string;
  user_type: "logged_in" | "anonymous";
  actor_email?: string | null;
  first_seen_at: string;
  last_seen_at: string;
  runs_count: number | string | null;
  unique_links_submitted: number | string | null;
  saved_places_count: number | string | null;
  edited_count: number | string | null;
  reused_count: number | string | null;
  app_opened_count: number | string | null;
  login_seen_count: number | string | null;
};

export type AdminUsageInput = {
  from?: string | null;
  to?: string | null;
  platform?: string | null;
  userType?: "logged_in" | "anonymous" | null;
  excludeTestUsers?: boolean | null;
};

export type AdminUsageOverviewResult = {
  loggedInUsers: number;
  anonymousUsers: number;
  uniqueUsers: number;
  appOpenedUsers: number;
  loginSeenUsers: number;
  loggedInButNoRunUsers: number;
  newUsers: number;
  returningUsers: number;
  repeatUsers: number;
  usersSubmittedAtLeastOneLink: number;
  usersSavedAtLeastOnePlace: number;
  usersWithTwoPlusSavedPlaces: number;
  usersSubmittedButDidNotSave: number;
  totalSavedPlaces: number;
  savesPerUser: number;
  linksPerUser: number;
  saveRatePerUser: number;
  lastActiveAt: string | null;
};

export type AdminUsageUsersInput = AdminUsageInput & {
  status?: "new" | "active" | "saved_place" | "repeat_user" | "dropped_after_extraction" | "opened_app" | "logged_in" | "no_link_submitted" | null;
  q?: string | null;
  page?: number | null;
  pageSize?: number | null;
};

export type AdminUsageUserRowResult = {
  actorKey: string;
  userType: "logged_in" | "anonymous";
  firstSeenAt: string;
  lastSeenAt: string;
  runsCount: number;
  uniqueLinksSubmitted: number;
  savedPlacesCount: number;
  editedCount: number;
  reusedCount: number;
  appOpenedCount: number;
  loginSeenCount: number;
  hasSubmittedLink: boolean;
  hasSavedPlace: boolean;
  saveRate: number;
  linksPerUser: number;
  savesPerUser: number;
  statusBadges: Array<"new" | "active" | "saved_place" | "repeat_user" | "dropped_after_extraction" | "opened_app" | "logged_in" | "no_link_submitted">;
};

type AdminUsageActorInternalRow = AdminUsageUserRowResult & {
  actorKeyRaw: string;
  actorEmail: string | null;
};

export type AdminUsageUsersResult = {
  rows: AdminUsageUserRowResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type AttemptPromotedFieldsInput = {
  attemptId?: string | null;
  runId?: string | null;
  attemptNumber?: number | null;
  canonicalUrl?: string | null;
  acceptedAfter?: string | null;
  route?: string | null;
  stageStatus?: Record<string, unknown> | null;
  stageTimingsMs?: Record<string, unknown> | null;
  transcriptAttempted?: boolean | null;
  transcriptSucceeded?: boolean | null;
  ocrAttempted?: boolean | null;
  ocrSucceeded?: boolean | null;
  visualAttempted?: boolean | null;
  visualSucceeded?: boolean | null;
  commentsFetchedCount?: number | null;
  commentRepliesFetchedCount?: number | null;
  creatorReplyCount?: number | null;
};

export type AppUsageEventInput = {
  eventType: "app_opened" | "login_seen";
  userId?: string | null;
  anonymousId?: string | null;
  metadataJson?: Record<string, unknown> | null;
};

export type AdminObservabilityLinkDetailInput = {
  submittedLinkId: string;
  includeRaw?: boolean | null;
};

export type AdminObservabilityLinkDetailResult = {
  submittedLink: {
    id: string;
    canonicalUrl: string;
    platform: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
  } | null;
  runs: Array<{
    id: string;
    clientRunId: string | null;
    userId: string | null;
    anonymousId: string | null;
    sourceUrl: string;
    sourcePlatform: string | null;
    latestOutcome: string | null;
    latestAttemptNumber: number | null;
    firstSavedAttemptNumber: number | null;
    firstEditedAttemptNumber: number | null;
    firstDiscardedAttemptNumber: number | null;
    createdAt: string;
    updatedAt: string;
    attempts: Array<any>;
    events: Array<any>;
  }>;
};

export async function getAdminObservabilityLinkDetail(
  input: AdminObservabilityLinkDetailInput,
): Promise<AdminObservabilityLinkDetailResult> {
  const submittedLinkId = String(input.submittedLinkId || "").trim();
  const includeRaw = !!input.includeRaw;
  if (!submittedLinkId) {
    return { submittedLink: null, runs: [] };
  }

  // 1) submitted link
  const slRes = await database.query(
    `select id::text, canonical_url, source_platform, first_seen_at, last_seen_at from submitted_links where id = $1 limit 1`,
    [submittedLinkId],
  );
  const submittedLinkRow = slRes.rows[0];
  const submittedLink = submittedLinkRow
    ? {
        id: submittedLinkRow.id,
        canonicalUrl: submittedLinkRow.canonical_url,
        platform: submittedLinkRow.source_platform,
        firstSeenAt: submittedLinkRow.first_seen_at,
        lastSeenAt: submittedLinkRow.last_seen_at,
      }
    : null;

  if (!submittedLink) return { submittedLink: null, runs: [] };

  // 2) runs
  const runsRes = await database.query(
    `select * from reel_analytics_runs where submitted_link_id = $1 order by created_at asc`,
    [submittedLinkId],
  );
  const runs = runsRes.rows;
  const runIds = runs.map((r: any) => r.id);

  // 3) attempts
  const attemptsRes = runIds.length
    ? await database.query(`select * from reel_analytics_attempts where run_id = any($1::uuid[]) order by created_at asc`, [runIds])
    : { rows: [] };
  const attempts = attemptsRes.rows;

  // 4) stages
  const stagesRes = runIds.length
    ? await database.query(`select * from attempt_stage_runs where run_id = any($1::uuid[]) order by created_at asc`, [runIds])
    : { rows: [] };
  const stages = stagesRes.rows;

  // 5) evidence
  const evidenceRes = runIds.length
    ? await database.query(`select * from attempt_evidence where run_id = any($1::uuid[]) order by created_at asc`, [runIds])
    : { rows: [] };
  const evidence = evidenceRes.rows;

  // 6) entities
  const entitiesRes = runIds.length
    ? await database.query(`select * from reel_analytics_entities where run_id = any($1::uuid[]) order by created_at asc`, [runIds])
    : { rows: [] };
  const entities = entitiesRes.rows;

  // 7) events
  const eventsRes = runIds.length
    ? await database.query(`select * from reel_analytics_events where run_id = any($1::uuid[]) order by created_at asc`, [runIds])
    : { rows: [] };
  const events = eventsRes.rows;

  // 8) entity field edits
  const editsRes = runIds.length
    ? await database.query(`select * from entity_field_edits where run_id = any($1::uuid[]) order by created_at asc`, [runIds])
    : { rows: [] };
  const edits = editsRes.rows;

  // Assemble runs with nested attempts, stages, evidence, entities, events, edits
  const attemptsByRun: Record<string, any[]> = {};
  for (const a of attempts) {
    const runId = a.run_id;
    attemptsByRun[runId] = attemptsByRun[runId] || [];
    attemptsByRun[runId].push({
      id: a.id,
      attemptNumber: a.attempt_number,
      status: a.status,
      triggerType: a.trigger_type,
      model: a.model,
      inputTokens: a.input_tokens,
      outputTokens: a.output_tokens,
      totalTokens: a.total_tokens,
      providerLatencyMs: a.provider_latency_ms,
      totalLatencyMs: a.total_latency_ms,
      entityCount: a.entity_count,
      intelligenceStatus: a.intelligence_status,
      validationErrorCount: a.validation_error_count,
      failureReason: a.failure_reason,
      createdAt: a.created_at,
      startedAt: a.started_at,
      completedAt: a.completed_at,
      acceptedAfter: a.accepted_after,
      route: a.route,
      // raw payloads
      extractionResult: includeRaw ? a.extraction_result_json : null,
      intelligenceResult: includeRaw ? a.intelligence_result_json : null,
      // summarized fields when raw not included
      extractionResultSummary: includeRaw ? null : (a.extraction_result_json ? "<hidden>" : null),
      intelligenceResultSummary: includeRaw ? null : (a.intelligence_result_json ? "<hidden>" : null),
      stages: [],
      evidence: [],
      entities: [],
      edits: [],
    });
  }

  const stagesByAttemptKey: Record<string, any[]> = {};
  for (const s of stages) {
    const key = `${s.run_id}::${s.attempt_number}`;
    stagesByAttemptKey[key] = stagesByAttemptKey[key] || [];
    stagesByAttemptKey[key].push({
      id: s.id,
      stage: s.stage,
      status: s.status,
      attemptNumber: s.attempt_number,
      latencyMs: s.latency_ms,
      errorText: s.error_text,
      createdAt: s.created_at,
      startedAt: s.started_at,
      finishedAt: s.finished_at,
    });
  }

  const evidenceByAttemptKey: Record<string, any[]> = {};
  for (const e of evidence) {
    const key = `${e.run_id}::${e.attempt_number}`;
    evidenceByAttemptKey[key] = evidenceByAttemptKey[key] || [];
    evidenceByAttemptKey[key].push({
      id: e.id,
      evidenceType: e.evidence_type,
      position: e.position,
      summaryText: e.summary_text,
      sourceRef: e.source_ref,
      metricsJson: includeRaw ? e.metrics_json : null,
      rawJson: includeRaw ? e.raw_json : null,
      createdAt: e.created_at,
    });
  }

  const entitiesByAttemptKey: Record<string, any[]> = {};
  for (const en of entities) {
    const key = `${en.run_id}::${en.attempt_number}`;
    entitiesByAttemptKey[key] = entitiesByAttemptKey[key] || [];
    entitiesByAttemptKey[key].push({
      id: en.id,
      entityIndex: en.entity_index,
      entityType: en.entity_type,
      title: en.title,
      subtitle: en.subtitle,
      placeCandidateId: en.place_candidate_id,
      finalPlaceId: en.final_place_id,
      confidence: en.confidence,
      metadataJson: includeRaw ? en.metadata_json : null,
      wasSaved: !!en.was_saved,
      wasEdited: !!en.was_edited,
      wasDiscarded: !!en.was_discarded,
      createdAt: en.created_at,
    });
  }

  const editsByRun: Record<string, any[]> = {};
  for (const ed of edits) {
    editsByRun[ed.run_id] = editsByRun[ed.run_id] || [];
    editsByRun[ed.run_id].push({
      id: ed.id,
      dedupeKey: ed.dedupe_key,
      runId: ed.run_id,
      attemptId: ed.attempt_id,
      attemptNumber: ed.attempt_number,
      entityId: ed.entity_id,
      entityIndex: ed.entity_index,
      fieldName: ed.field_name,
      beforeValueJson: includeRaw ? ed.before_value_json : null,
      afterValueJson: includeRaw ? ed.after_value_json : null,
      editedByUserId: ed.edited_by_user_id,
      createdAt: ed.created_at,
    });
  }

  const eventsByRun: Record<string, any[]> = {};
  for (const ev of events) {
    eventsByRun[ev.run_id] = eventsByRun[ev.run_id] || [];
    eventsByRun[ev.run_id].push({
      id: ev.id,
      attemptNumber: ev.attempt_number,
      eventName: ev.event_name,
      payloadJson: includeRaw ? ev.payload_json : null,
      createdAt: ev.created_at,
    });
  }

  const runsResult: AdminObservabilityLinkDetailResult["runs"] = [] as any;
  for (const r of runs) {
    const runAttempts = attemptsByRun[r.id] || [];
    for (const a of runAttempts) {
      const key = `${r.id}::${a.attemptNumber}`;
      a.stages = stagesByAttemptKey[key] || [];
      a.evidence = evidenceByAttemptKey[key] || [];
      a.entities = entitiesByAttemptKey[key] || [];
      a.edits = editsByRun[r.id] || [];
    }
    runsResult.push({
      id: r.id,
      clientRunId: r.client_run_id ?? null,
      userId: r.user_id ?? null,
      anonymousId: r.anonymous_id ?? null,
      sourceUrl: r.source_url,
      sourcePlatform: r.source_platform ?? null,
      latestOutcome: r.latest_outcome ?? null,
      latestAttemptNumber: r.latest_attempt_number ?? null,
      firstSavedAttemptNumber: r.first_saved_attempt_number ?? null,
      firstEditedAttemptNumber: r.first_edited_attempt_number ?? null,
      firstDiscardedAttemptNumber: r.first_discarded_attempt_number ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      attempts: runAttempts,
      events: eventsByRun[r.id] || [],
    });
  }

  return { submittedLink, runs: runsResult };
}

export type AttemptStageRunUpsertInput = {
  attemptId?: string | null;
  runId: string;
  attemptNumber: number;
  stages: Array<{
    stageKey: string;
    status?: string | null;
    provider?: string | null;
    reason?: string | null;
    latencyMs?: number | null;
    chars?: number | null;
    metadataJson?: Record<string, unknown> | null;
  }>;
};

export type AttemptEvidenceUpsertInput = {
  attemptId?: string | null;
  runId: string;
  attemptNumber: number;
  evidence: Array<{
    evidenceType: string;
    position?: number | null;
    summaryText?: string | null;
    sourceRef?: string | null;
    metricsJson?: Record<string, unknown> | null;
    rawJson?: Record<string, unknown> | null;
  }>;
};

export type RunFinalOutcomeUpdateInput = {
  runId: string;
  finalUserAction?: "saved" | "edited" | "discarded" | null;
  finalSelectedPlaceId?: string | null;
};

export type EntityFieldEditInsertInput = {
  edits: Array<{
    runId: string;
    attemptId?: string | null;
    attemptNumber?: number | null;
    entityId?: string | null;
    entityIndex?: number | null;
    fieldName: string;
    beforeValue?: unknown;
    afterValue?: unknown;
    editedByUserId?: string | null;
    dedupeKey?: string | null;
  }>;
};

export function __setPostgresTestConfig(input: {
  databaseOverride?: DatabaseLike;
  databaseUrlOverride?: string;
  schemaReadyOverride?: boolean;
}) {
  if (Object.prototype.hasOwnProperty.call(input, "databaseOverride")) {
    database = input.databaseOverride ?? pool;
  }
  if (Object.prototype.hasOwnProperty.call(input, "databaseUrlOverride")) {
    databaseUrl = input.databaseUrlOverride ?? DATABASE_URL;
  }
  if (Object.prototype.hasOwnProperty.call(input, "schemaReadyOverride")) {
    schemaReady = Boolean(input.schemaReadyOverride);
  }
}

export function __resetPostgresTestConfig() {
  database = pool;
  databaseUrl = DATABASE_URL;
  schemaReady = false;
}

function isMissingUpdatedAtColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /column\s+"updated_at"\s+of relation\s+"reel_analytics_attempts"\s+does not exist/i.test(message);
}

function sanitizeArtifactPayload<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === "string" && currentValue.startsWith("data:")) {
        return "[omitted_data_url]";
      }
      if (
        currentValue &&
        typeof currentValue === "object" &&
        !Array.isArray(currentValue) &&
        typeof (currentValue as Record<string, unknown>).url === "string" &&
        typeof (currentValue as Record<string, unknown>).origin === "string" &&
        typeof (currentValue as Record<string, unknown>).label === "string"
      ) {
        return {
          ...(currentValue as Record<string, unknown>),
          url: "[omitted_image_payload]",
          sourcePath: null,
        };
      }
      return currentValue;
    }),
  ) as T;
}

export async function ensureAuthSchema() {
  if (schemaReady) return;
  if (!isPostgresConfigured()) {
    throw new Error("DATABASE_URL is not configured");
  }

  await database.query(`
    create table if not exists users (
      id uuid primary key default gen_random_uuid(),
      email text unique,
      email_verified boolean not null default false,
      phone_number text unique,
      phone_verified boolean not null default false,
      display_name text,
      avatar_url text,
      auth_provider text,
      provider_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint users_provider_unique unique (auth_provider, provider_id)
    );
  `);

  await database.query(`
    create table if not exists auth_sessions (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      token_hash text not null unique,
      expires_at timestamptz not null,
      revoked_at timestamptz,
      created_at timestamptz not null default now()
    );
  `);

  await database.query(`
    create table if not exists auth_email_otps (
      id uuid primary key default gen_random_uuid(),
      email text not null,
      otp_hash text not null,
      expires_at timestamptz not null,
      consumed_at timestamptz,
      attempt_count integer not null default 0,
      created_at timestamptz not null default now()
    );
  `);

  await database.query(`
    create index if not exists idx_auth_email_otps_email_created on auth_email_otps(email, created_at desc);
  `);

  await database.query(`
    create table if not exists user_saved_places (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      place_id text not null,
      title text not null,
      category text,
      metadata_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (user_id, place_id)
    );
  `);

  await database.query(`
    create index if not exists idx_user_saved_places_user_created on user_saved_places(user_id, created_at desc);
  `);

  await database.query(`
    create table if not exists app_usage_events (
      id uuid primary key default gen_random_uuid(),
      event_type text not null,
      user_id uuid references users(id) on delete set null,
      anonymous_id text,
      created_at timestamptz not null default now(),
      metadata_json jsonb
    );
  `);

  await database.query(`
    create index if not exists idx_app_usage_events_created on app_usage_events(created_at desc);
  `);

  await database.query(`
    create index if not exists idx_app_usage_events_user_created on app_usage_events(user_id, created_at desc);
  `);

  await database.query(`
    create index if not exists idx_app_usage_events_anon_created on app_usage_events(anonymous_id, created_at desc);
  `);

  await database.query(`
    create table if not exists reel_analytics_runs (
      id uuid primary key default gen_random_uuid(),
      client_run_id text not null unique,
      user_id uuid references users(id) on delete set null,
      anonymous_id text,
      source_url text not null,
      source_platform text,
      latest_outcome text not null default 'started',
      latest_attempt_number integer not null default 0,
      first_saved_attempt_number integer,
      first_edited_attempt_number integer,
      first_discarded_attempt_number integer,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await database.query(`
    create table if not exists submitted_links (
      id uuid primary key default gen_random_uuid(),
      canonical_url text not null unique,
      canonical_url_hash text,
      source_platform text,
      latest_title text,
      latest_description text,
      latest_image_url text,
      first_seen_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await database.query(`
    create index if not exists idx_submitted_links_last_seen on submitted_links(last_seen_at desc);
  `);

  await database.query(`
    alter table if exists reel_analytics_runs add column if not exists submitted_link_id uuid references submitted_links(id) on delete set null;
  `);
  await database.query(`
    alter table if exists reel_analytics_runs add column if not exists canonical_url text;
  `);
  await database.query(`
    alter table if exists reel_analytics_runs add column if not exists final_user_action text;
  `);
  await database.query(`
    alter table if exists reel_analytics_runs add column if not exists final_selected_place_id text;
  `);

  await database.query(`
    create table if not exists reel_analytics_attempts (
      id uuid primary key default gen_random_uuid(),
      run_id uuid not null references reel_analytics_runs(id) on delete cascade,
      attempt_number integer not null,
      trigger_type text not null,
      status text not null default 'queued',
      source_url text not null,
      source_platform text,
      model text,
      input_tokens integer,
      output_tokens integer,
      total_tokens integer,
      provider_latency_ms integer,
      total_latency_ms integer,
      entity_count integer,
      intelligence_status text,
      validation_error_count integer,
      failure_reason text,
      extraction_result_json jsonb,
      intelligence_result_json jsonb,
      hypothesis_json jsonb,
      created_at timestamptz not null default now(),
      started_at timestamptz not null default now(),
      completed_at timestamptz,
      unique (run_id, attempt_number)
    );
  `);

  await database.query(`
    create index if not exists idx_reel_analytics_attempts_run_attempt on reel_analytics_attempts(run_id, attempt_number desc);
  `);

  await database.query(`
    alter table if exists reel_analytics_attempts add column if not exists extraction_result_json jsonb;
  `);
  await database.query(`
    alter table if exists reel_analytics_attempts add column if not exists intelligence_result_json jsonb;
  `);
  await database.query(`
    alter table if exists reel_analytics_attempts add column if not exists hypothesis_json jsonb;
  `);
  await database.query(`
    alter table if exists reel_analytics_attempts add column if not exists updated_at timestamptz not null default now();
  `);
  await database.query(`
    alter table if exists reel_analytics_attempts add column if not exists canonical_url text;
  `);
  await database.query(`
    alter table if exists reel_analytics_attempts add column if not exists accepted_after text;
  `);
  await database.query(`
    alter table if exists reel_analytics_attempts add column if not exists route text;
  `);
  await database.query(`
    alter table if exists reel_analytics_attempts add column if not exists stage_status_json jsonb;
  `);
  await database.query(`
    alter table if exists reel_analytics_attempts add column if not exists stage_timings_ms_json jsonb;
  `);
  await database.query(`
    alter table if exists reel_analytics_attempts add column if not exists transcript_attempted boolean;
  `);
  await database.query(`
    alter table if exists reel_analytics_attempts add column if not exists transcript_succeeded boolean;
  `);
  await database.query(`
    alter table if exists reel_analytics_attempts add column if not exists ocr_attempted boolean;
  `);
  await database.query(`
    alter table if exists reel_analytics_attempts add column if not exists ocr_succeeded boolean;
  `);
  await database.query(`
    alter table if exists reel_analytics_attempts add column if not exists visual_attempted boolean;
  `);
  await database.query(`
    alter table if exists reel_analytics_attempts add column if not exists visual_succeeded boolean;
  `);
  await database.query(`
    alter table if exists reel_analytics_attempts add column if not exists comments_fetched_count integer;
  `);
  await database.query(`
    alter table if exists reel_analytics_attempts add column if not exists comment_replies_fetched_count integer;
  `);
  await database.query(`
    alter table if exists reel_analytics_attempts add column if not exists creator_reply_count integer;
  `);

  await database.query(`
    create table if not exists reel_analytics_events (
      id uuid primary key default gen_random_uuid(),
      run_id uuid not null references reel_analytics_runs(id) on delete cascade,
      attempt_number integer,
      event_name text not null,
      payload_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
  `);

  await database.query(`
    create table if not exists reel_analytics_entities (
      id uuid primary key default gen_random_uuid(),
      run_id uuid not null references reel_analytics_runs(id) on delete cascade,
      attempt_id uuid references reel_analytics_attempts(id) on delete cascade,
      attempt_number integer not null,
      entity_index integer not null,
      entity_type text,
      title text,
      subtitle text,
      place_candidate_id text,
      final_place_id text,
      confidence numeric,
      metadata_json jsonb not null default '{}'::jsonb,
      was_saved boolean not null default false,
      was_edited boolean not null default false,
      was_discarded boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (run_id, attempt_number, entity_index)
    );
  `);

  await database.query(`
    create index if not exists idx_reel_entities_run_id on reel_analytics_entities(run_id);
  `);

  await database.query(`
    create index if not exists idx_reel_entities_attempt_id on reel_analytics_entities(attempt_id);
  `);

  await database.query(`
    create index if not exists idx_reel_entities_final_place_id on reel_analytics_entities(final_place_id);
  `);

  await database.query(`
    create index if not exists idx_reel_entities_type on reel_analytics_entities(entity_type);
  `);

  await database.query(`
    create table if not exists attempt_stage_runs (
      id uuid primary key default gen_random_uuid(),
      run_id uuid not null references reel_analytics_runs(id) on delete cascade,
      attempt_id uuid references reel_analytics_attempts(id) on delete cascade,
      attempt_number integer not null,
      stage_key text not null,
      status text,
      provider text,
      reason text,
      latency_ms integer,
      chars integer,
      metadata_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (run_id, attempt_number, stage_key)
    );
  `);

  await database.query(`
    create index if not exists idx_attempt_stage_runs_attempt on attempt_stage_runs(attempt_id);
  `);

  await database.query(`
    create table if not exists attempt_evidence (
      id uuid primary key default gen_random_uuid(),
      run_id uuid not null references reel_analytics_runs(id) on delete cascade,
      attempt_id uuid references reel_analytics_attempts(id) on delete cascade,
      attempt_number integer not null,
      evidence_type text not null,
      position integer not null default 0,
      summary_text text,
      source_ref text,
      metrics_json jsonb not null default '{}'::jsonb,
      raw_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (run_id, attempt_number, evidence_type, position)
    );
  `);

  await database.query(`
    create index if not exists idx_attempt_evidence_attempt on attempt_evidence(attempt_id);
  `);

  await database.query(`
    create table if not exists entity_field_edits (
      id uuid primary key default gen_random_uuid(),
      dedupe_key text not null unique,
      run_id uuid not null references reel_analytics_runs(id) on delete cascade,
      attempt_id uuid references reel_analytics_attempts(id) on delete cascade,
      attempt_number integer,
      entity_id uuid references reel_analytics_entities(id) on delete set null,
      entity_index integer,
      field_name text not null,
      before_value_json jsonb,
      after_value_json jsonb,
      edited_by_user_id uuid references users(id) on delete set null,
      created_at timestamptz not null default now()
    );
  `);

  await database.query(`
    create index if not exists idx_entity_field_edits_run_attempt on entity_field_edits(run_id, attempt_number, created_at desc);
  `);

  await database.query(`
    create table if not exists reel_jobs (
      id uuid primary key default gen_random_uuid(),
      run_id uuid references reel_analytics_runs(id) on delete cascade,
      attempt_id uuid references reel_analytics_attempts(id) on delete cascade,
      attempt_number integer,
      job_type text not null default 'full_pipeline',
      status text not null default 'queued',
      progress_json jsonb not null default '{}'::jsonb,
      result_json jsonb,
      error_message text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await database.query(`
    create index if not exists idx_reel_jobs_run_id on reel_jobs(run_id);
  `);

  await database.query(`
    create index if not exists idx_reel_jobs_attempt_id on reel_jobs(attempt_id);
  `);

  await database.query(`
    create index if not exists idx_reel_jobs_status on reel_jobs(status);
  `);

  await database.query(`
    create index if not exists idx_reel_jobs_created_at on reel_jobs(created_at desc);
  `);

  schemaReady = true;
}

function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizeDisplayName(name: string | null | undefined) {
  const normalized = String(name || "").trim();
  return normalized || null;
}

function toUserDTO(row: UserRecord) {
  return {
    userId: row.id,
    customerId: row.id,
    email: row.email,
    emailVerified: row.email_verified,
    phoneNumber: row.phone_number,
    phoneVerified: row.phone_verified,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    authProvider: row.auth_provider,
    providerId: row.provider_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findUserById(userId: string) {
  const result = await database.query<UserRecord>("select * from users where id = $1 limit 1", [userId]);
  return result.rows[0] || null;
}

export async function findUserByEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const result = await database.query<UserRecord>("select * from users where email = $1 limit 1", [normalized]);
  return result.rows[0] || null;
}

export async function upsertGoogleVerifiedUser(input: {
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  providerId: string;
}) {
  const email = normalizeEmail(input.email);
  const displayName = sanitizeDisplayName(input.displayName) || email.split("@")[0] || "Wandreel User";
  const avatarUrl = input.avatarUrl ? String(input.avatarUrl).trim() : null;

  const client = await database.connect() as PoolClient;
  try {
    await client.query("begin");
    const existingByEmail = await client.query<UserRecord>("select * from users where email = $1 limit 1 for update", [email]);
    const existing = existingByEmail.rows[0];

    if (existing) {
      const updated = await client.query<UserRecord>(
        `
          update users
          set
            email_verified = true,
            display_name = coalesce($2, display_name),
            avatar_url = coalesce($3, avatar_url),
            auth_provider = 'GOOGLE',
            provider_id = $4,
            updated_at = now()
          where id = $1
          returning *
        `,
        [existing.id, displayName, avatarUrl, input.providerId],
      );
      await client.query("commit");
      return toUserDTO(updated.rows[0]);
    }

    const inserted = await client.query<UserRecord>(
      `
        insert into users (
          id, email, email_verified, phone_number, phone_verified, display_name, avatar_url, auth_provider, provider_id, created_at, updated_at
        )
        values ($1, $2, $3, null, false, $4, $5, 'GOOGLE', $6, now(), now())
        returning *
      `,
      [randomUUID(), email, input.emailVerified, displayName, avatarUrl, input.providerId],
    );
    await client.query("commit");
    return toUserDTO(inserted.rows[0]);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function createOrReuseEmailVerifiedUser(input: { email: string; displayName?: string | null }) {
  const email = normalizeEmail(input.email);
  const displayName = sanitizeDisplayName(input.displayName);
  const existing = await findUserByEmail(email);
  if (existing) {
    const updated = await database.query<UserRecord>(
      `
        update users
        set
          email_verified = true,
          display_name = coalesce(display_name, $2),
          auth_provider = coalesce(auth_provider, 'EMAIL'),
          updated_at = now()
        where id = $1
        returning *
      `,
      [existing.id, displayName],
    );
    return toUserDTO(updated.rows[0]);
  }

  const inserted = await database.query<UserRecord>(
    `
      insert into users (
        id, email, email_verified, phone_number, phone_verified, display_name, avatar_url, auth_provider, provider_id, created_at, updated_at
      )
      values ($1, $2, true, null, false, $3, null, 'EMAIL', null, now(), now())
      returning *
    `,
    [randomUUID(), email, displayName],
  );
  return toUserDTO(inserted.rows[0]);
}

export async function updateDisplayName(userId: string, displayName: string) {
  const cleaned = sanitizeDisplayName(displayName);
  if (!cleaned) {
    throw new Error("displayName is required");
  }
  const updated = await database.query<UserRecord>(
    "update users set display_name = $2, updated_at = now() where id = $1 returning *",
    [userId, cleaned],
  );
  if (!updated.rows[0]) {
    throw new Error("User not found");
  }
  return toUserDTO(updated.rows[0]);
}

export async function createSession(userId: string) {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashValue(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const sessionId = randomUUID();

  await database.query<SessionRecord>(
    `
      insert into auth_sessions (id, user_id, token_hash, expires_at, revoked_at, created_at)
      values ($1, $2, $3, $4, null, now())
    `,
    [sessionId, userId, tokenHash, expiresAt],
  );

  return { rawToken, expiresAt };
}

export async function findSessionUser(rawToken: string) {
  const tokenHash = hashValue(rawToken);
  const result = await database.query<UserRecord>(
    `
      select u.*
      from auth_sessions s
      join users u on u.id = s.user_id
      where s.token_hash = $1
        and s.revoked_at is null
        and s.expires_at > now()
      limit 1
    `,
    [tokenHash],
  );
  const user = result.rows[0];
  return user ? toUserDTO(user) : null;
}

export async function revokeSession(rawToken: string) {
  const tokenHash = hashValue(rawToken);
  await database.query("update auth_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null", [tokenHash]);
}

export async function issueEmailOtp(emailInput: string) {
  const email = normalizeEmail(emailInput);
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("Enter a valid email");
  }
  const otp = String(randomInt(100000, 999999));
  const otpHash = hashValue(otp);
  const expiresAt = new Date(Date.now() + EMAIL_OTP_TTL_MS).toISOString();

  await database.query(
    `
      insert into auth_email_otps (id, email, otp_hash, expires_at, consumed_at, attempt_count, created_at)
      values ($1, $2, $3, $4, null, 0, now())
    `,
    [randomUUID(), email, otpHash, expiresAt],
  );

  return {
    email,
    expiresAt,
    otpPreview: process.env.EMAIL_OTP_DEV_MODE === "true" ? otp : undefined,
  };
}

export async function verifyEmailOtp(emailInput: string, otp: string) {
  const email = normalizeEmail(emailInput);
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("Enter a valid email");
  }
  if (!/^\d{6}$/.test(String(otp || "").trim())) {
    throw new Error("OTP must be 6 digits");
  }

  const latestResult = await database.query<{
    id: string;
    otp_hash: string;
    expires_at: string;
    consumed_at: string | null;
    attempt_count: number;
  }>(
    `
      select id, otp_hash, expires_at, consumed_at, attempt_count
      from auth_email_otps
      where email = $1
      order by created_at desc
      limit 1
    `,
    [email],
  );
  const latest = latestResult.rows[0];
  if (!latest) {
    throw new Error("No OTP request found for this email");
  }
  if (latest.consumed_at) {
    throw new Error("OTP already used. Please request a new OTP");
  }
  if (new Date(latest.expires_at).getTime() < Date.now()) {
    throw new Error("OTP expired. Please request a new OTP");
  }

  const receivedHash = hashValue(otp.trim());
  if (receivedHash !== latest.otp_hash) {
    await database.query("update auth_email_otps set attempt_count = attempt_count + 1 where id = $1", [latest.id]);
    throw new Error("Invalid OTP");
  }

  await database.query("update auth_email_otps set consumed_at = now(), attempt_count = attempt_count + 1 where id = $1", [latest.id]);
  return { email };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function getSessionCookieName() {
  return SESSION_COOKIE_NAME;
}

function isProductionCookieContext() {
  return process.env.NODE_ENV === "production";
}

function buildSessionCookieAttributes(maxAgeSeconds: number) {
  const secure = isProductionCookieContext();
  const sameSite = secure ? "None" : "Lax";
  return `Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

export function buildSessionCookie(token: string) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE_NAME}=${token}; ${buildSessionCookieAttributes(maxAge)}`;
}

export function buildClearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; ${buildSessionCookieAttributes(0)}`;
}

function toSavedPlaceDTO(row: SavedPlaceRecord) {
  return {
    id: row.id,
    placeId: row.place_id,
    title: row.title,
    category: row.category,
    metadata: row.metadata_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSavedPlaces(userId: string) {
  const result = await database.query<SavedPlaceRecord>(
    "select * from user_saved_places where user_id = $1 order by created_at desc",
    [userId],
  );
  return result.rows.map(toSavedPlaceDTO);
}

export async function findSavedPlaceByUserAndPlaceId(userId: string, placeIdRaw: string) {
  const placeId = String(placeIdRaw || "").trim();
  if (!placeId) return null;
  const result = await database.query<SavedPlaceRecord>(
    "select * from user_saved_places where user_id = $1 and place_id = $2 limit 1",
    [userId, placeId],
  );
  const row = result.rows[0];
  return row ? toSavedPlaceDTO(row) : null;
}

export async function upsertSavedPlace(userId: string, input: { placeId: string; title: string; category?: string | null; metadata?: unknown }) {
  const placeId = String(input.placeId || "").trim();
  const title = String(input.title || "").trim();
  const category = input.category ? String(input.category).trim() : null;
  const metadata = input.metadata ?? {};

  if (!placeId) throw new Error("placeId is required");
  if (!title) throw new Error("title is required");

  const existing = await findSavedPlaceByUserAndPlaceId(userId, placeId);
  if (existing) {
    return {
      item: existing,
      alreadySaved: true,
    };
  }

  const result = await database.query<SavedPlaceRecord>(
    `
      insert into user_saved_places (id, user_id, place_id, title, category, metadata_json, created_at, updated_at)
      values ($1, $2, $3, $4, $5, $6::jsonb, now(), now())
      returning *
    `,
    [randomUUID(), userId, placeId, title, category, JSON.stringify(metadata)],
  );
  return {
    item: toSavedPlaceDTO(result.rows[0]),
    alreadySaved: false,
  };
}

export async function deleteSavedPlace(userId: string, placeIdRaw: string) {
  const placeId = String(placeIdRaw || "").trim();
  if (!placeId) throw new Error("placeId is required");
  const result = await database.query(
    "delete from user_saved_places where user_id = $1 and place_id = $2 returning id",
    [userId, placeId],
  );
  return { deleted: Number(result.rowCount || 0) > 0 };
}

async function upsertReelAnalyticsRun(input: {
  clientRunId: string;
  userId?: string | null;
  anonymousId?: string | null;
  sourceUrl: string;
  sourcePlatform?: string | null;
  latestAttemptNumber?: number;
}) {
  const result = await database.query<ReelAnalyticsRunRecord>(
    `
      insert into reel_analytics_runs (
        id, client_run_id, user_id, anonymous_id, source_url, source_platform, latest_attempt_number, created_at, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, now(), now())
      on conflict (client_run_id)
      do update set
        user_id = coalesce(excluded.user_id, reel_analytics_runs.user_id),
        anonymous_id = coalesce(excluded.anonymous_id, reel_analytics_runs.anonymous_id),
        source_url = excluded.source_url,
        source_platform = coalesce(excluded.source_platform, reel_analytics_runs.source_platform),
        latest_attempt_number = greatest(reel_analytics_runs.latest_attempt_number, excluded.latest_attempt_number),
        updated_at = now()
      returning id
    `,
    [
      randomUUID(),
      input.clientRunId,
      input.userId ?? null,
      input.anonymousId ?? null,
      input.sourceUrl,
      input.sourcePlatform ?? null,
      input.latestAttemptNumber ?? 0,
    ],
  );
  return result.rows[0]?.id || null;
}

export async function createReelAnalyticsAttempt(input: ReelAnalyticsAttemptInput): Promise<ReelAnalyticsAttemptResult | null> {
  const runId = await upsertReelAnalyticsRun({
    clientRunId: input.clientRunId,
    userId: input.userId ?? null,
    anonymousId: input.anonymousId ?? null,
    sourceUrl: input.sourceUrl,
    sourcePlatform: input.sourcePlatform ?? null,
    latestAttemptNumber: input.attemptNumber,
  });
  if (!runId) return null;

  const attemptId = randomUUID();
  const attemptResult = await database.query<{ id: string }>(
    `
      insert into reel_analytics_attempts (
        id, run_id, attempt_number, trigger_type, status, source_url, source_platform, created_at, started_at
      )
      values ($1, $2, $3, $4, 'queued', $5, $6, now(), now())
      on conflict (run_id, attempt_number)
      do update set
        trigger_type = excluded.trigger_type,
        status = 'queued',
        source_url = excluded.source_url,
        source_platform = coalesce(excluded.source_platform, reel_analytics_attempts.source_platform),
        failure_reason = null,
        completed_at = null,
        started_at = now()
      returning id
    `,
    [attemptId, runId, input.attemptNumber, input.triggerType, input.sourceUrl, input.sourcePlatform ?? null],
  );

  await database.query(
    "update reel_analytics_runs set latest_attempt_number = greatest(latest_attempt_number, $2), updated_at = now() where id = $1",
    [runId, input.attemptNumber],
  );

  return { attemptId: attemptResult.rows[0]?.id || attemptId, runId };
}

export async function getReelAnalyticsRunIdByClientRunId(clientRunId: string) {
  const normalized = String(clientRunId || "").trim();
  if (!normalized) return null;
  const result = await database.query<ReelAnalyticsRunRecord>(
    "select id from reel_analytics_runs where client_run_id = $1 limit 1",
    [normalized],
  );
  return result.rows[0]?.id || null;
}

export async function finalizeReelAnalyticsAttempt(input: ReelAnalyticsAttemptCompletion) {
  await database.query(
    `
      update reel_analytics_attempts
      set
        status = $2,
        source_platform = coalesce($3, source_platform),
        model = coalesce($4, model),
        input_tokens = $5,
        output_tokens = $6,
        total_tokens = $7,
        provider_latency_ms = $8,
        total_latency_ms = $9,
        entity_count = $10,
        intelligence_status = $11,
        validation_error_count = $12,
        failure_reason = $13,
        completed_at = now()
      where id = $1
    `,
    [
      input.attemptId,
      input.status,
      input.sourcePlatform ?? null,
      input.model ?? null,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.totalTokens ?? null,
      input.providerLatencyMs ?? null,
      input.totalLatencyMs ?? null,
      input.entityCount ?? null,
      input.intelligenceStatus ?? null,
      input.validationErrorCount ?? null,
      input.failureReason ?? null,
    ],
  );
}

export async function persistReelAnalyticsAttemptArtifacts(input: ReelAnalyticsAttemptArtifactsInput) {
  const hasExtractionResult = Object.prototype.hasOwnProperty.call(input, "extractionResult");
  const hasIntelligenceResult = Object.prototype.hasOwnProperty.call(input, "intelligenceResult");
  const hasHypothesisSummary = Object.prototype.hasOwnProperty.call(input, "hypothesisSummary");
  const extractionResult = hasExtractionResult ? JSON.stringify(sanitizeArtifactPayload(input.extractionResult ?? null)) : null;
  const intelligenceResult = hasIntelligenceResult ? JSON.stringify(sanitizeArtifactPayload(input.intelligenceResult ?? null)) : null;
  const hypothesisSummary = hasHypothesisSummary ? JSON.stringify(sanitizeArtifactPayload(input.hypothesisSummary ?? null)) : null;

  if (input.attemptId) {
    try {
      await database.query(
        `
          update reel_analytics_attempts
          set
            extraction_result_json = case when $2 then $3::jsonb else extraction_result_json end,
            intelligence_result_json = case when $4 then $5::jsonb else intelligence_result_json end,
            hypothesis_json = case when $6 then $7::jsonb else hypothesis_json end,
            updated_at = now()
          where id = $1
        `,
        [
          input.attemptId,
          hasExtractionResult,
          extractionResult,
          hasIntelligenceResult,
          intelligenceResult,
          hasHypothesisSummary,
          hypothesisSummary,
        ],
      );
    } catch (error) {
      if (!isMissingUpdatedAtColumnError(error)) throw error;
      await database.query(
        `
          update reel_analytics_attempts
          set
            extraction_result_json = case when $2 then $3::jsonb else extraction_result_json end,
            intelligence_result_json = case when $4 then $5::jsonb else intelligence_result_json end,
            hypothesis_json = case when $6 then $7::jsonb else hypothesis_json end
          where id = $1
        `,
        [
          input.attemptId,
          hasExtractionResult,
          extractionResult,
          hasIntelligenceResult,
          intelligenceResult,
          hasHypothesisSummary,
          hypothesisSummary,
        ],
      );
    }
    return;
  }

  const runId = String(input.runId || "").trim();
  const attemptNumber = Number(input.attemptNumber) || 0;
  if (!runId || !attemptNumber) return;

  try {
    await database.query(
      `
        update reel_analytics_attempts
        set
          extraction_result_json = case when $3 then $4::jsonb else extraction_result_json end,
          intelligence_result_json = case when $5 then $6::jsonb else intelligence_result_json end,
          hypothesis_json = case when $7 then $8::jsonb else hypothesis_json end,
          updated_at = now()
        where run_id = $1 and attempt_number = $2
      `,
      [
        runId,
        attemptNumber,
        hasExtractionResult,
        extractionResult,
        hasIntelligenceResult,
        intelligenceResult,
        hasHypothesisSummary,
        hypothesisSummary,
      ],
    );
  } catch (error) {
    if (!isMissingUpdatedAtColumnError(error)) throw error;
    await database.query(
      `
        update reel_analytics_attempts
        set
          extraction_result_json = case when $3 then $4::jsonb else extraction_result_json end,
          intelligence_result_json = case when $5 then $6::jsonb else intelligence_result_json end,
          hypothesis_json = case when $7 then $8::jsonb else hypothesis_json end
        where run_id = $1 and attempt_number = $2
      `,
      [
        runId,
        attemptNumber,
        hasExtractionResult,
        extractionResult,
        hasIntelligenceResult,
        intelligenceResult,
        hasHypothesisSummary,
        hypothesisSummary,
      ],
    );
  }
}

export async function recordReelAnalyticsEvent(input: ReelAnalyticsEventInput) {
  const runId = await upsertReelAnalyticsRun({
    clientRunId: input.clientRunId,
    userId: input.userId ?? null,
    anonymousId: input.anonymousId ?? null,
    sourceUrl: input.sourceUrl || "",
    sourcePlatform: input.sourcePlatform ?? null,
    latestAttemptNumber: input.attemptNumber ?? 0,
  });
  if (!runId) return;

  await database.query(
    `
      insert into reel_analytics_events (id, run_id, attempt_number, event_name, payload_json, created_at)
      values ($1, $2, $3, $4, $5::jsonb, now())
    `,
    [randomUUID(), runId, input.attemptNumber ?? null, input.eventName, JSON.stringify(input.payload ?? {})],
  );

  await database.query(
    `
      update reel_analytics_runs
      set
        latest_outcome = $2,
        first_saved_attempt_number = case when $2 = 'saved' then coalesce(first_saved_attempt_number, $3) else first_saved_attempt_number end,
        first_edited_attempt_number = case when $2 = 'edited' then coalesce(first_edited_attempt_number, $3) else first_edited_attempt_number end,
        first_discarded_attempt_number = case when $2 = 'discarded' then coalesce(first_discarded_attempt_number, $3) else first_discarded_attempt_number end,
        latest_attempt_number = greatest(latest_attempt_number, coalesce($3, 0)),
        updated_at = now()
      where id = $1
    `,
    [runId, input.eventName, input.attemptNumber ?? null],
  );
}

export async function recordAppUsageEvent(input: AppUsageEventInput): Promise<void> {
  await database.query(
    `
      insert into app_usage_events (id, event_type, user_id, anonymous_id, created_at, metadata_json)
      values ($1, $2, $3, $4, now(), $5::jsonb)
    `,
    [
      randomUUID(),
      input.eventType,
      input.userId ?? null,
      input.anonymousId ?? null,
      JSON.stringify(input.metadataJson ?? {}),
    ],
  );
}

export async function upsertReelAnalyticsEntities(input: ReelAnalyticsEntitiesUpsertInput): Promise<void> {
  for (const entity of input.entities) {
    await database.query(
      `
        insert into reel_analytics_entities (
          id, run_id, attempt_id, attempt_number, entity_index, entity_type, title, subtitle,
          place_candidate_id, final_place_id, confidence, metadata_json, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, now(), now())
        on conflict (run_id, attempt_number, entity_index)
        do update set
          attempt_id = excluded.attempt_id,
          entity_type = excluded.entity_type,
          title = excluded.title,
          subtitle = excluded.subtitle,
          place_candidate_id = excluded.place_candidate_id,
          final_place_id = excluded.final_place_id,
          confidence = excluded.confidence,
          metadata_json = excluded.metadata_json,
          updated_at = now()
      `,
      [
        randomUUID(),
        input.runId,
        input.attemptId ?? null,
        input.attemptNumber,
        entity.entityIndex,
        entity.entityType ?? null,
        entity.title ?? null,
        entity.subtitle ?? null,
        entity.placeCandidateId ?? null,
        entity.finalPlaceId ?? null,
        entity.confidence ?? null,
        JSON.stringify(entity.metadataJson ?? {}),
      ],
    );
  }
}

export async function markReelAnalyticsEntityOutcome(input: ReelAnalyticsEntityOutcomeInput): Promise<void> {
  const flagColumn =
    input.eventName === "saved"
      ? "was_saved"
      : input.eventName === "edited"
        ? "was_edited"
        : "was_discarded";

  if (input.entityId) {
    await database.query(
      `
        update reel_analytics_entities
        set
          ${flagColumn} = true,
          final_place_id = coalesce($2, final_place_id),
          updated_at = now()
        where id = $1
      `,
      [input.entityId, input.finalPlaceId ?? null],
    );
    return;
  }

  if (input.entityIndex === null || typeof input.entityIndex !== "number") return;

  await database.query(
    `
      update reel_analytics_entities
      set
        ${flagColumn} = true,
        final_place_id = coalesce($4, final_place_id),
        updated_at = now()
      where run_id = $1 and attempt_number = $2 and entity_index = $3
    `,
    [input.runId, input.attemptNumber, input.entityIndex, input.finalPlaceId ?? null],
  );
}

export async function createReelJob(input: ReelJobCreateInput): Promise<{ id: string }> {
  const jobId = input.jobId || randomUUID();
  await database.query(
    `
      insert into reel_jobs (
        id, run_id, attempt_id, attempt_number, job_type, status, progress_json, created_at, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, now(), now())
      on conflict (id)
      do update set
        run_id = coalesce(excluded.run_id, reel_jobs.run_id),
        attempt_id = coalesce(excluded.attempt_id, reel_jobs.attempt_id),
        attempt_number = coalesce(excluded.attempt_number, reel_jobs.attempt_number),
        job_type = excluded.job_type,
        status = excluded.status,
        progress_json = excluded.progress_json,
        updated_at = now()
    `,
    [
      jobId,
      input.runId ?? null,
      input.attemptId ?? null,
      input.attemptNumber ?? null,
      input.jobType || "full_pipeline",
      input.status || "queued",
      JSON.stringify(input.progressJson ?? {}),
    ],
  );
  return { id: jobId };
}

export async function updateReelJob(input: ReelJobUpdateInput): Promise<void> {
  const hasProgressJson = Object.prototype.hasOwnProperty.call(input, "progressJson");
  const hasResultJson = Object.prototype.hasOwnProperty.call(input, "resultJson");
  const hasErrorMessage = Object.prototype.hasOwnProperty.call(input, "errorMessage");
  const serializedProgressJson = hasProgressJson ? JSON.stringify(sanitizeArtifactPayload(input.progressJson ?? {})) : null;
  const serializedResultJson =
    hasResultJson ? (input.resultJson === null ? null : JSON.stringify(sanitizeArtifactPayload(input.resultJson))) : null;
  await database.query(
    `
      update reel_jobs
      set
        status = coalesce($2, status),
        progress_json = case when $6 then $3::jsonb else progress_json end,
        result_json = case when $7 then $4::jsonb else result_json end,
        error_message = case when $8 then $5 else error_message end,
        updated_at = now()
      where id = $1
    `,
    [
      input.jobId,
      input.status ?? null,
      serializedProgressJson,
      serializedResultJson,
      input.errorMessage ?? null,
      hasProgressJson,
      hasResultJson,
      hasErrorMessage,
    ],
  );
}

function serializeJsonOrNull(value: unknown): string | null {
  if (typeof value === "undefined") return null;
  return value === null ? null : JSON.stringify(value);
}

function normalizeInteger(value: number | null | undefined): number | null {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function normalizeNumericResult(value: number | string | null | undefined): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeOptionalDateInput(value: unknown): string | null {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  return Number.isFinite(new Date(normalized).getTime()) ? normalized : null;
}

function maskActorKey(actorKey: string, userType: "logged_in" | "anonymous") {
  const digest = hashValue(actorKey).slice(0, 8);
  return `${userType === "logged_in" ? "usr" : "anon"}_${digest}`;
}

function isWithinSelectedRange(value: string, from: string | null, to: string | null) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  if (from) {
    const fromTime = new Date(from).getTime();
    if (Number.isFinite(fromTime) && timestamp < fromTime) return false;
  }
  if (to) {
    const toTime = new Date(`${to}T23:59:59.999Z`).getTime();
    if (Number.isFinite(toTime) && timestamp > toTime) return false;
  }
  return true;
}

function buildUsageStatusBadges(
  row: Pick<AdminUsageUserRowResult, "firstSeenAt" | "lastSeenAt" | "runsCount" | "uniqueLinksSubmitted" | "savedPlacesCount" | "appOpenedCount" | "loginSeenCount">,
  from: string | null,
  to: string | null,
): Array<"new" | "active" | "saved_place" | "repeat_user" | "dropped_after_extraction" | "opened_app" | "logged_in" | "no_link_submitted"> {
  const badges: Array<"new" | "active" | "saved_place" | "repeat_user" | "dropped_after_extraction" | "opened_app" | "logged_in" | "no_link_submitted"> = [];
  if ((from || to) && isWithinSelectedRange(row.firstSeenAt, from, to)) {
    badges.push("new");
  }
  if (row.lastSeenAt) {
    badges.push("active");
  }
  if (row.appOpenedCount > 0) {
    badges.push("opened_app");
  }
  if (row.loginSeenCount > 0) {
    badges.push("logged_in");
  }
  if (row.savedPlacesCount > 0) {
    badges.push("saved_place");
  }
  if (row.runsCount >= 2) {
    badges.push("repeat_user");
  }
  if (row.uniqueLinksSubmitted === 0) {
    badges.push("no_link_submitted");
  }
  if (row.uniqueLinksSubmitted > 0 && row.savedPlacesCount === 0) {
    badges.push("dropped_after_extraction");
  }
  return badges;
}

function isMissingAppUsageEventsTableError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code || "") : "";
  const message = error instanceof Error ? error.message : String(error || "");
  return code === "42P01" || /app_usage_events/i.test(message);
}

function normalizeEmailForFiltering(email: string | null | undefined) {
  return String(email || "").trim().toLowerCase();
}

function isLikelyUsageTestEmail(email: string | null | undefined) {
  const normalized = normalizeEmailForFiltering(email);
  if (!normalized) return false;
  const [localPart = "", domain = ""] = normalized.split("@");
  return (
    domain === "example.com" ||
    /(^|[+._-])(test|qa|demo|seed|local)([+._-]|$)/.test(localPart) ||
    /^(test|qa|demo|seed|local)/.test(localPart)
  );
}

function isLikelyUsageTestActorKey(actorKey: string, userType: "logged_in" | "anonymous") {
  if (userType !== "anonymous") return false;
  const normalized = actorKey.toLowerCase();
  return ["test", "qa", "demo", "seed", "local", "admin"].some((token) => normalized.includes(token));
}

function shouldExcludeUsageActor(row: AdminUsageActorInternalRow, excludeTestUsers: boolean) {
  if (!excludeTestUsers) return false;
  const adminEmails = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const normalizedEmail = normalizeEmailForFiltering(row.actorEmail);
  if (normalizedEmail && (adminEmails.includes(normalizedEmail) || isLikelyUsageTestEmail(normalizedEmail))) {
    return true;
  }
  return isLikelyUsageTestActorKey(row.actorKeyRaw, row.userType);
}

function mapAdminUsageActorRows(rows: AdminUsageActorRow[], from: string | null, to: string | null) {
  return rows.map((row) => {
    const mapped: AdminUsageActorInternalRow = {
      actorKey: maskActorKey(row.actor_key, row.user_type),
      actorKeyRaw: row.actor_key,
      actorEmail: row.actor_email ? String(row.actor_email) : null,
      userType: row.user_type,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      runsCount: normalizeNumericResult(row.runs_count),
      uniqueLinksSubmitted: normalizeNumericResult(row.unique_links_submitted),
      savedPlacesCount: normalizeNumericResult(row.saved_places_count),
      editedCount: normalizeNumericResult(row.edited_count),
      reusedCount: normalizeNumericResult(row.reused_count),
      appOpenedCount: normalizeNumericResult(row.app_opened_count),
      loginSeenCount: normalizeNumericResult(row.login_seen_count),
      hasSubmittedLink: normalizeNumericResult(row.unique_links_submitted) > 0,
      hasSavedPlace: normalizeNumericResult(row.saved_places_count) > 0,
      saveRate: 0,
      linksPerUser: 0,
      savesPerUser: 0,
      statusBadges: [],
    };
    mapped.saveRate =
      mapped.uniqueLinksSubmitted > 0 ? mapped.savedPlacesCount / mapped.uniqueLinksSubmitted : 0;
    mapped.linksPerUser = mapped.uniqueLinksSubmitted;
    mapped.savesPerUser = mapped.savedPlacesCount;
    mapped.statusBadges = buildUsageStatusBadges(mapped, from, to);
    return mapped;
  });
}

async function getAdminUsageActorRows(input: AdminUsageInput): Promise<AdminUsageActorInternalRow[]> {
  const from = normalizeOptionalDateInput(input.from);
  const to = normalizeOptionalDateInput(input.to);
  const platform = input.platform ? String(input.platform).trim() : null;
  const userType = input.userType ? String(input.userType).trim() : null;
  const excludeTestUsers = input.excludeTestUsers !== false;

  try {
    const result = await database.query<AdminUsageActorRow>(
      `
      with active_runs as (
        select
          r.*,
          case
            when r.user_id is not null then 'u:' || r.user_id::text
            else 'a:' || coalesce(r.anonymous_id, 'unknown')
          end as actor_key,
          case
            when r.user_id is not null then 'logged_in'
            else 'anonymous'
          end as user_type
        from reel_analytics_runs r
        where
          ($1::timestamptz is null or r.created_at >= $1::timestamptz)
          and ($2::timestamptz is null or r.created_at < ($2::timestamptz + interval '1 day'))
          and ($3::text is null or r.source_platform = $3::text)
          and (
            $4::text is null
            or ($4::text = 'logged_in' and r.user_id is not null)
            or ($4::text = 'anonymous' and r.user_id is null)
          )
      ),
      active_app_events as (
        select
          e.*,
          case
            when e.user_id is not null then 'u:' || e.user_id::text
            else 'a:' || coalesce(e.anonymous_id, 'unknown')
          end as actor_key,
          case
            when e.user_id is not null then 'logged_in'
            else 'anonymous'
          end as user_type
        from app_usage_events e
        where
          ($3::text is null)
          and ($1::timestamptz is null or e.created_at >= $1::timestamptz)
          and ($2::timestamptz is null or e.created_at < ($2::timestamptz + interval '1 day'))
          and (
            $4::text is null
            or ($4::text = 'logged_in' and e.user_id is not null)
            or ($4::text = 'anonymous' and e.user_id is null)
          )
          and e.event_type in ('app_opened', 'login_seen')
      ),
      actor_scope as (
        select distinct actor_key, user_type
        from active_runs
        union
        select distinct actor_key, user_type
        from active_app_events
      ),
      actor_runs as (
        select
          r.*,
          scope.actor_key,
          scope.user_type
        from actor_scope scope
        join reel_analytics_runs r
          on (
            (scope.user_type = 'logged_in' and scope.actor_key = 'u:' || r.user_id::text)
            or (scope.user_type = 'anonymous' and scope.actor_key = 'a:' || coalesce(r.anonymous_id, 'unknown'))
          )
        where ($3::text is null or r.source_platform = $3::text)
      ),
      actor_app_events as (
        select
          e.*,
          scope.actor_key,
          scope.user_type
        from actor_scope scope
        join app_usage_events e
          on (
            (scope.user_type = 'logged_in' and scope.actor_key = 'u:' || e.user_id::text)
            or (scope.user_type = 'anonymous' and scope.actor_key = 'a:' || coalesce(e.anonymous_id, 'unknown'))
          )
        where
          ($3::text is null)
          and e.event_type in ('app_opened', 'login_seen')
      ),
      run_rollup as (
        select
          actor_key,
          user_type,
          min(created_at) as first_seen_at,
          max(updated_at) as last_seen_at,
          count(*)::numeric as runs_count,
          (count(distinct submitted_link_id) filter (where submitted_link_id is not null))::numeric as unique_links_submitted,
          (count(*) filter (where final_user_action = 'edited'))::numeric as edited_count
        from actor_runs
        group by actor_key, user_type
      ),
      reuse_rollup as (
        select
          actor_key,
          coalesce(sum(case when link_runs > 1 then link_runs - 1 else 0 end), 0)::numeric as reused_count
        from (
          select actor_key, submitted_link_id, count(*)::numeric as link_runs
          from actor_runs
          where submitted_link_id is not null
          group by actor_key, submitted_link_id
        ) grouped_links
        group by actor_key
      ),
      app_event_rollup as (
        select
          actor_key,
          min(created_at) as first_seen_at,
          max(created_at) as last_seen_at,
          (count(*) filter (where event_type = 'app_opened'))::numeric as app_opened_count,
          (count(*) filter (where event_type = 'login_seen'))::numeric as login_seen_count
        from actor_app_events
        group by actor_key
      ),
      saved_place_rollup as (
        select
          'u:' || usp.user_id::text as actor_key,
          count(*)::numeric as saved_places_count,
          max(usp.created_at) as last_saved_at
        from user_saved_places usp
        where
          ($1::timestamptz is null or usp.created_at >= $1::timestamptz)
          and ($2::timestamptz is null or usp.created_at < ($2::timestamptz + interval '1 day'))
        group by 1
      ),
      actor_profile as (
        select
          scope.actor_key,
          max(u.email) as actor_email
        from actor_scope scope
        left join users u
          on scope.user_type = 'logged_in'
          and scope.actor_key = 'u:' || u.id::text
        group by scope.actor_key
      )
      select
        scope.actor_key,
        scope.user_type,
        profile.actor_email,
        coalesce(
          least(rr.first_seen_at, aer.first_seen_at),
          rr.first_seen_at,
          aer.first_seen_at
        ) as first_seen_at,
        greatest(
          coalesce(rr.last_seen_at, aer.last_seen_at),
          coalesce(aer.last_seen_at, rr.last_seen_at),
          coalesce(spr.last_saved_at, rr.last_seen_at, aer.last_seen_at)
        ) as last_seen_at,
        coalesce(rr.runs_count, 0)::numeric as runs_count,
        coalesce(rr.unique_links_submitted, 0)::numeric as unique_links_submitted,
        coalesce(spr.saved_places_count, 0)::numeric as saved_places_count,
        coalesce(rr.edited_count, 0)::numeric as edited_count,
        coalesce(reuse.reused_count, 0)::numeric as reused_count,
        coalesce(aer.app_opened_count, 0)::numeric as app_opened_count,
        coalesce(aer.login_seen_count, 0)::numeric as login_seen_count
      from actor_scope scope
      left join run_rollup rr on rr.actor_key = scope.actor_key
      left join saved_place_rollup spr on spr.actor_key = scope.actor_key
      left join reuse_rollup reuse on reuse.actor_key = scope.actor_key
      left join app_event_rollup aer on aer.actor_key = scope.actor_key
      left join actor_profile profile on profile.actor_key = scope.actor_key
      order by last_seen_at desc nulls last, scope.actor_key asc
    `,
      [from, to, platform, userType],
    );

    return mapAdminUsageActorRows(result.rows, from, to).filter((row) => !shouldExcludeUsageActor(row, excludeTestUsers));
  } catch (error) {
    if (!isMissingAppUsageEventsTableError(error)) {
      throw error;
    }

    const fallbackResult = await database.query<AdminUsageActorRow>(
      `
        with actor_runs as (
          select
            r.*,
            case
              when r.user_id is not null then 'u:' || r.user_id::text
              else 'a:' || coalesce(r.anonymous_id, 'unknown')
            end as actor_key,
            case
              when r.user_id is not null then 'logged_in'
              else 'anonymous'
            end as user_type
          from reel_analytics_runs r
          where
            ($1::timestamptz is null or r.created_at >= $1::timestamptz)
            and ($2::timestamptz is null or r.created_at < ($2::timestamptz + interval '1 day'))
            and ($3::text is null or r.source_platform = $3::text)
            and (
              $4::text is null
              or ($4::text = 'logged_in' and r.user_id is not null)
              or ($4::text = 'anonymous' and r.user_id is null)
            )
        ),
        run_rollup as (
          select
            actor_key,
            user_type,
            min(created_at) as first_seen_at,
            max(updated_at) as last_seen_at,
            count(*)::numeric as runs_count,
            (count(distinct submitted_link_id) filter (where submitted_link_id is not null))::numeric as unique_links_submitted,
            (count(*) filter (where final_user_action = 'edited'))::numeric as edited_count
          from actor_runs
          group by actor_key, user_type
        ),
        reuse_rollup as (
          select
            actor_key,
            coalesce(sum(case when link_runs > 1 then link_runs - 1 else 0 end), 0)::numeric as reused_count
          from (
            select actor_key, submitted_link_id, count(*)::numeric as link_runs
            from actor_runs
            where submitted_link_id is not null
            group by actor_key, submitted_link_id
          ) grouped_links
          group by actor_key
        ),
        saved_place_rollup as (
          select
            'u:' || usp.user_id::text as actor_key,
            count(*)::numeric as saved_places_count,
            max(usp.created_at) as last_saved_at
          from user_saved_places usp
          where
            ($1::timestamptz is null or usp.created_at >= $1::timestamptz)
            and ($2::timestamptz is null or usp.created_at < ($2::timestamptz + interval '1 day'))
          group by 1
        ),
        actor_profile as (
          select
            rr.actor_key,
            max(u.email) as actor_email
          from run_rollup rr
          left join users u
            on rr.user_type = 'logged_in'
            and rr.actor_key = 'u:' || u.id::text
          group by rr.actor_key
        )
        select
          rr.actor_key,
          rr.user_type,
          profile.actor_email,
          rr.first_seen_at,
          greatest(
            coalesce(rr.last_seen_at, spr.last_saved_at),
            coalesce(spr.last_saved_at, rr.last_seen_at)
          ) as last_seen_at,
          rr.runs_count,
          rr.unique_links_submitted,
          coalesce(spr.saved_places_count, 0)::numeric as saved_places_count,
          rr.edited_count,
          coalesce(reuse.reused_count, 0)::numeric as reused_count,
          0::numeric as app_opened_count,
          0::numeric as login_seen_count
        from run_rollup rr
        left join saved_place_rollup spr on spr.actor_key = rr.actor_key
        left join reuse_rollup reuse on reuse.actor_key = rr.actor_key
        left join actor_profile profile on profile.actor_key = rr.actor_key
        order by last_seen_at desc nulls last, rr.actor_key asc
      `,
      [from, to, platform, userType],
    );

    return mapAdminUsageActorRows(fallbackResult.rows, from, to).filter((row) => !shouldExcludeUsageActor(row, excludeTestUsers));
  }
}

function buildEntityFieldEditDedupeKey(input: {
  runId: string;
  attemptId?: string | null;
  attemptNumber?: number | null;
  entityId?: string | null;
  entityIndex?: number | null;
  fieldName: string;
  beforeValue?: unknown;
  afterValue?: unknown;
}) {
  return createHash("sha256").update(JSON.stringify({
    runId: input.runId,
    attemptId: input.attemptId ?? null,
    attemptNumber: input.attemptNumber ?? null,
    entityId: input.entityId ?? null,
    entityIndex: input.entityIndex ?? null,
    fieldName: input.fieldName,
    beforeValue: input.beforeValue ?? null,
    afterValue: input.afterValue ?? null,
  })).digest("hex");
}

export async function upsertSubmittedLink(input: SubmittedLinkUpsertInput): Promise<SubmittedLinkUpsertResult | null> {
  const canonicalUrl = String(input.canonicalUrl || "").trim();
  if (!canonicalUrl) return null;
  const result = await database.query<SubmittedLinkRecord>(
    `
      insert into submitted_links (
        id, canonical_url, canonical_url_hash, source_platform, latest_title,
        latest_description, latest_image_url, first_seen_at, last_seen_at, created_at, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, now(), now(), now(), now())
      on conflict (canonical_url)
      do update set
        canonical_url_hash = coalesce(excluded.canonical_url_hash, submitted_links.canonical_url_hash),
        source_platform = coalesce(excluded.source_platform, submitted_links.source_platform),
        latest_title = coalesce(excluded.latest_title, submitted_links.latest_title),
        latest_description = coalesce(excluded.latest_description, submitted_links.latest_description),
        latest_image_url = coalesce(excluded.latest_image_url, submitted_links.latest_image_url),
        last_seen_at = now(),
        updated_at = now()
      returning id
    `,
    [
      randomUUID(),
      canonicalUrl,
      input.canonicalUrlHash ? String(input.canonicalUrlHash).trim() : null,
      input.sourcePlatform ? String(input.sourcePlatform).trim() : null,
      input.latestTitle ? String(input.latestTitle) : null,
      input.latestDescription ? String(input.latestDescription) : null,
      input.latestImageUrl ? String(input.latestImageUrl) : null,
    ],
  );
  const row = result.rows[0];
  return row ? { id: row.id } : null;
}

export async function getLatestReusableMetadataExtractionByCanonicalUrl(
  canonicalUrlRaw: string,
): Promise<ReusableMetadataExtractionLookupResult | null> {
  const canonicalUrl = String(canonicalUrlRaw || "").trim();
  if (!canonicalUrl) return null;
  const result = await database.query<ReusableMetadataExtractionRecord>(
    `
      select
        sl.id as submitted_link_id,
        sl.canonical_url,
        r.id as run_id,
        r.client_run_id,
        r.user_id,
        r.anonymous_id,
        a.id as attempt_id,
        a.attempt_number,
        a.status,
        a.failure_reason,
        a.extraction_result_json,
        a.intelligence_status
      from submitted_links sl
      join reel_analytics_runs r on r.submitted_link_id = sl.id
      join reel_analytics_attempts a on a.run_id = r.id
      where
        sl.canonical_url = $1
        and coalesce(a.canonical_url, r.canonical_url, sl.canonical_url) = $1
        and a.extraction_result_json is not null
        and coalesce(a.status, '') <> 'failed'
        and a.failure_reason is null
      order by coalesce(a.completed_at, a.updated_at, a.started_at, a.created_at) desc, a.attempt_number desc
      limit 1
    `,
    [canonicalUrl],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    submittedLinkId: row.submitted_link_id,
    canonicalUrl: row.canonical_url,
    runId: row.run_id,
    clientRunId: row.client_run_id,
    userId: row.user_id,
    anonymousId: row.anonymous_id,
    attemptId: row.attempt_id,
    attemptNumber: row.attempt_number,
    status: row.status,
    failureReason: row.failure_reason,
    extractionResult: row.extraction_result_json,
    priorStatus: row.intelligence_status ?? row.status,
  };
}

export async function getAdminObservabilityOverview(
  input: AdminObservabilityOverviewInput,
): Promise<AdminObservabilityOverviewResult> {
  const from = input.from ? String(input.from).trim() : null;
  const to = input.to ? String(input.to).trim() : null;
  const platform = input.platform ? String(input.platform).trim() : null;

  const result = await database.query<AdminObservabilityOverviewRow>(
    `
      with filtered_links as (
        select sl.id
        from submitted_links sl
        where
          ($1::timestamptz is null or sl.first_seen_at >= $1::timestamptz)
          and ($2::timestamptz is null or sl.first_seen_at < ($2::timestamptz + interval '1 day'))
          and ($3::text is null or sl.source_platform = $3::text)
      ),
      filtered_runs as (
        select r.*
        from reel_analytics_runs r
        where
          ($1::timestamptz is null or r.created_at >= $1::timestamptz)
          and ($2::timestamptz is null or r.created_at < ($2::timestamptz + interval '1 day'))
          and ($3::text is null or r.source_platform = $3::text)
      ),
      filtered_attempts as (
        select a.*
        from reel_analytics_attempts a
        join filtered_runs r on r.id = a.run_id
      ),
      filtered_stage_totals as (
        select s.run_id, s.attempt_number, sum(coalesce(s.latency_ms, 0))::numeric as total_latency_ms
        from attempt_stage_runs s
        join filtered_runs r on r.id = s.run_id
        group by s.run_id, s.attempt_number
      ),
      cache_reuse as (
        select coalesce(sum(case when run_count > 1 then run_count - 1 else 0 end), 0)::numeric as estimated_cache_reuse_count
        from (
          select r.submitted_link_id, count(*)::numeric as run_count
          from filtered_runs r
          where r.submitted_link_id is not null
          group by r.submitted_link_id
        ) grouped_runs
      ),
      duplicate_saves as (
        select coalesce(sum(case when save_count > 1 then save_count - 1 else 0 end), 0)::numeric as estimated_duplicate_saved_place_count
        from (
          select r.user_id, r.final_selected_place_id, count(*)::numeric as save_count
          from filtered_runs r
          where
            r.user_id is not null
            and r.final_user_action = 'saved'
            and r.final_selected_place_id is not null
          group by r.user_id, r.final_selected_place_id
        ) grouped_saves
      )
      select
        (select count(*)::numeric from filtered_links) as total_submitted_links,
        (select count(*)::numeric from filtered_runs) as total_runs,
        (select count(*)::numeric from filtered_attempts) as total_attempts,
        (select count(*)::numeric from filtered_runs where final_user_action = 'saved') as saved_runs,
        (select count(*)::numeric from filtered_runs where final_user_action = 'edited') as edited_runs,
        (select count(*)::numeric from filtered_runs where final_user_action = 'discarded') as discarded_runs,
        (select avg(latest_attempt_number)::numeric from filtered_runs where latest_attempt_number > 0) as average_attempt_count,
        (select avg(total_latency_ms)::numeric from filtered_stage_totals) as average_extraction_time_ms,
        (select estimated_cache_reuse_count from cache_reuse) as estimated_cache_reuse_count,
        (select estimated_duplicate_saved_place_count from duplicate_saves) as estimated_duplicate_saved_place_count
    `,
    [from, to, platform],
  );

  const row = result.rows[0];
  const totalRuns = normalizeNumericResult(row?.total_runs);
  const savedRuns = normalizeNumericResult(row?.saved_runs);
  const editedRuns = normalizeNumericResult(row?.edited_runs);
  const discardedRuns = normalizeNumericResult(row?.discarded_runs);

  const saveRate = totalRuns > 0 ? savedRuns / totalRuns : 0;
  const editRate = totalRuns > 0 ? editedRuns / totalRuns : 0;
  const discardRate = totalRuns > 0 ? discardedRuns / totalRuns : 0;
  const averageExtractionTimeMsRaw = row?.average_extraction_time_ms;
  const averageExtractionTimeMs =
    averageExtractionTimeMsRaw === null || typeof averageExtractionTimeMsRaw === "undefined"
      ? null
      : normalizeNumericResult(averageExtractionTimeMsRaw);

  return {
    totalSubmittedLinks: normalizeNumericResult(row?.total_submitted_links),
    totalRuns,
    totalAttempts: normalizeNumericResult(row?.total_attempts),
    savedRuns,
    editedRuns,
    discardedRuns,
    saveRate,
    editRate,
    discardRate,
    averageAttemptCount: normalizeNumericResult(row?.average_attempt_count),
    averageExtractionTimeMs,
    estimatedCacheReuseCount: normalizeNumericResult(row?.estimated_cache_reuse_count),
    estimatedDuplicateSavedPlaceCount: normalizeNumericResult(row?.estimated_duplicate_saved_place_count),
  };
}

export async function getAdminObservabilityLinks(
  input: AdminObservabilityLinksInput,
): Promise<AdminObservabilityLinksResult> {
  const from = input.from ? String(input.from).trim() : null;
  const to = input.to ? String(input.to).trim() : null;
  const platform = input.platform ? String(input.platform).trim() : null;
  const status = input.status ? String(input.status).trim() : null;
  const reused = input.reused ? true : input.reused === false ? false : null;
  const acceptedAfter = input.acceptedAfter ? String(input.acceptedAfter).trim() : null;
  const q = input.q ? String(input.q).trim() : null;
  const page =
    Number.isFinite(Number(input.page)) && Number(input.page) >= 1 ? Number(input.page) : 1;
  const pageSize =
    Number.isFinite(Number(input.pageSize)) && Number(input.pageSize) >= 1
      ? Math.min(Number(input.pageSize), 200)
      : 50;
  const offset = (page - 1) * pageSize;

  // First, get total count
  const countResult = await database.query<{ total: string | number }>(
    `
      with filtered_links as (
        select distinct sl.id
        from submitted_links sl
        left join reel_analytics_runs r on r.submitted_link_id = sl.id
        where
          ($1::timestamptz is null or sl.first_seen_at >= $1::timestamptz)
          and ($2::timestamptz is null or sl.first_seen_at < ($2::timestamptz + interval '1 day'))
          and ($3::text is null or sl.source_platform = $3::text)
          and ($4::text is null or r.latest_outcome = $4::text)
          and (
            case when $5::boolean is not null then
              (select count(*) > 1 from reel_analytics_runs where submitted_link_id = sl.id) = $5::boolean
            else true
            end
          )
          and ($6::text is null or exists (select 1 from reel_analytics_attempts a where a.run_id = r.id and a.accepted_after = $6::text))
          and ($7::text is null or sl.canonical_url ilike '%' || $7::text || '%')
      )
      select count(*)::numeric as total
      from filtered_links
    `,
    [from, to, platform, status, reused, acceptedAfter, q],
  );

  const totalCount = normalizeNumericResult(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.ceil(totalCount / pageSize);

  // Then get the paginated results
  const result = await database.query<AdminObservabilityLinksRow>(
    `
      with filtered_links as (
        select distinct sl.id, sl.canonical_url, sl.source_platform, sl.first_seen_at, sl.last_seen_at
        from submitted_links sl
        left join reel_analytics_runs r on r.submitted_link_id = sl.id
        where
          ($1::timestamptz is null or sl.first_seen_at >= $1::timestamptz)
          and ($2::timestamptz is null or sl.first_seen_at < ($2::timestamptz + interval '1 day'))
          and ($3::text is null or sl.source_platform = $3::text)
          and ($4::text is null or r.latest_outcome = $4::text)
          and (
            case when $5::boolean is not null then
              (select count(*) > 1 from reel_analytics_runs where submitted_link_id = sl.id) = $5::boolean
            else true
            end
          )
          and ($6::text is null or exists (select 1 from reel_analytics_attempts a where a.run_id = r.id and a.accepted_after = $6::text))
          and ($7::text is null or sl.canonical_url ilike '%' || $7::text || '%')
        order by sl.last_seen_at desc
        limit $8::int offset $9::int
      ),
      link_aggregates as (
        select
          fl.id,
          fl.canonical_url,
          fl.source_platform,
          fl.first_seen_at,
          fl.last_seen_at,
          count(distinct r.id)::numeric as run_count,
          coalesce(avg(r.latest_attempt_number), 0)::numeric as attempt_count,
          max(r.latest_outcome) as latest_status,
          max(a.accepted_after) as latest_accepted_after,
          max(a.route) as latest_route,
          (select count(*) - 1 from reel_analytics_runs where submitted_link_id = fl.id)::numeric as cache_reuse_count,
          max(r.final_selected_place_id) as final_selected_place_id,
          max(r.final_user_action) as final_user_action
        from filtered_links fl
        left join reel_analytics_runs r on r.submitted_link_id = fl.id
        left join reel_analytics_attempts a on a.run_id = r.id and a.attempt_number = r.latest_attempt_number
        group by fl.id, fl.canonical_url, fl.source_platform, fl.first_seen_at, fl.last_seen_at
      )
      select
        id::text as submitted_link_id,
        canonical_url,
        source_platform as platform,
        first_seen_at,
        last_seen_at,
        run_count,
        attempt_count,
        latest_status,
        latest_accepted_after,
        latest_route,
        cache_reuse_count,
        final_selected_place_id,
        final_user_action
      from link_aggregates
      order by last_seen_at desc
    `,
    [from, to, platform, status, reused, acceptedAfter, q, pageSize, offset],
  );

  const rows = result.rows.map((row) => ({
    submittedLinkId: row.submitted_link_id,
    canonicalUrl: row.canonical_url,
    platform: row.platform,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    runCount: normalizeNumericResult(row.run_count),
    attemptCount: normalizeNumericResult(row.attempt_count),
    latestStatus: row.latest_status,
    latestAcceptedAfter: row.latest_accepted_after,
    latestRoute: row.latest_route,
    cacheReuseCount: normalizeNumericResult(row.cache_reuse_count),
    finalSelectedPlaceId: row.final_selected_place_id,
    finalUserAction: row.final_user_action,
  }));

  return {
    rows,
    total: totalCount,
    page,
    pageSize,
    totalPages,
  };
}

export async function getAdminUsageOverview(
  input: AdminUsageInput,
): Promise<AdminUsageOverviewResult> {
  const from = normalizeOptionalDateInput(input.from);
  const to = normalizeOptionalDateInput(input.to);
  const rows = await getAdminUsageActorRows(input);
  const loggedInUsers = rows.filter((row) => row.userType === "logged_in").length;
  const anonymousUsers = rows.filter((row) => row.userType === "anonymous").length;
  const uniqueUsers = rows.length;
  const appOpenedUsers = rows.filter((row) => row.appOpenedCount > 0).length;
  const loginSeenUsers = rows.filter((row) => row.loginSeenCount > 0).length;
  const loggedInButNoRunUsers = rows.filter((row) => row.loginSeenCount > 0 && row.runsCount === 0).length;
  const newUsers = rows.filter((row) => (from || to) && isWithinSelectedRange(row.firstSeenAt, from, to)).length;
  const returningUsers = rows.filter((row) => from && new Date(row.firstSeenAt).getTime() < new Date(from).getTime()).length;
  const repeatUsers = rows.filter((row) => row.runsCount >= 2).length;
  const usersSubmittedAtLeastOneLink = rows.filter((row) => row.uniqueLinksSubmitted > 0).length;
  const usersSavedAtLeastOnePlace = rows.filter((row) => row.savedPlacesCount > 0).length;
  const usersWithTwoPlusSavedPlaces = rows.filter((row) => row.savedPlacesCount >= 2).length;
  const usersSubmittedButDidNotSave = rows.filter(
    (row) => row.uniqueLinksSubmitted > 0 && row.savedPlacesCount === 0,
  ).length;
  const totalSavedPlaces = rows.reduce((sum, row) => sum + row.savedPlacesCount, 0);
  const totalUniqueLinks = rows.reduce((sum, row) => sum + row.uniqueLinksSubmitted, 0);
  const lastActiveAt = rows.reduce<string | null>((latest, row) => {
    if (!latest) return row.lastSeenAt;
    return new Date(row.lastSeenAt).getTime() > new Date(latest).getTime() ? row.lastSeenAt : latest;
  }, null);

  return {
    loggedInUsers,
    anonymousUsers,
    uniqueUsers,
    appOpenedUsers,
    loginSeenUsers,
    loggedInButNoRunUsers,
    newUsers,
    returningUsers,
    repeatUsers,
    usersSubmittedAtLeastOneLink,
    usersSavedAtLeastOnePlace,
    usersWithTwoPlusSavedPlaces,
    usersSubmittedButDidNotSave,
    totalSavedPlaces,
    savesPerUser: uniqueUsers > 0 ? totalSavedPlaces / uniqueUsers : 0,
    linksPerUser: uniqueUsers > 0 ? totalUniqueLinks / uniqueUsers : 0,
    saveRatePerUser:
      usersSubmittedAtLeastOneLink > 0 ? usersSavedAtLeastOnePlace / usersSubmittedAtLeastOneLink : 0,
    lastActiveAt,
  };
}

export async function getAdminUsageUsers(
  input: AdminUsageUsersInput,
): Promise<AdminUsageUsersResult> {
  const status = input.status ? String(input.status).trim() : null;
  const q = input.q ? String(input.q).trim().toLowerCase() : null;
  const page =
    Number.isFinite(Number(input.page)) && Number(input.page) >= 1 ? Number(input.page) : 1;
  const pageSize =
    Number.isFinite(Number(input.pageSize)) && Number(input.pageSize) >= 1
      ? Math.min(Number(input.pageSize), 200)
      : 50;
  const offset = (page - 1) * pageSize;

  const rows = await getAdminUsageActorRows(input);
  const filteredRows = rows.filter((row) => {
    if (status && !row.statusBadges.includes(status as AdminUsageUserRowResult["statusBadges"][number])) {
      return false;
    }
    if (q && !row.actorKey.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });

  const total = filteredRows.length;
  const totalPages = Math.ceil(total / pageSize);

  return {
    rows: filteredRows.slice(offset, offset + pageSize).map(({ actorKeyRaw: _actorKeyRaw, actorEmail: _actorEmail, ...row }) => row),
    total,
    page,
    pageSize,
    totalPages,
  };
}

export async function linkRunToSubmittedLink(input: {
  runId: string;
  submittedLinkId: string;
  canonicalUrl?: string | null;
}): Promise<void> {
  const runId = String(input.runId || "").trim();
  const submittedLinkId = String(input.submittedLinkId || "").trim();
  if (!runId || !submittedLinkId) return;
  await database.query(
    `
      update reel_analytics_runs
      set
        submitted_link_id = $2,
        canonical_url = coalesce($3, canonical_url),
        updated_at = now()
      where id = $1
    `,
    [runId, submittedLinkId, input.canonicalUrl ? String(input.canonicalUrl).trim() : null],
  );
}

export async function updateAttemptPromotedFields(input: AttemptPromotedFieldsInput): Promise<void> {
  const attemptId = String(input.attemptId || "").trim();
  const runId = String(input.runId || "").trim();
  const attemptNumber = normalizeInteger(input.attemptNumber);
  if (!attemptId && (!runId || !attemptNumber)) return;

  await database.query(
    `
      update reel_analytics_attempts
      set
        canonical_url = coalesce($4, canonical_url),
        accepted_after = coalesce($5, accepted_after),
        route = coalesce($6, route),
        stage_status_json = coalesce($7::jsonb, stage_status_json),
        stage_timings_ms_json = coalesce($8::jsonb, stage_timings_ms_json),
        transcript_attempted = coalesce($9, transcript_attempted),
        transcript_succeeded = coalesce($10, transcript_succeeded),
        ocr_attempted = coalesce($11, ocr_attempted),
        ocr_succeeded = coalesce($12, ocr_succeeded),
        visual_attempted = coalesce($13, visual_attempted),
        visual_succeeded = coalesce($14, visual_succeeded),
        comments_fetched_count = coalesce($15, comments_fetched_count),
        comment_replies_fetched_count = coalesce($16, comment_replies_fetched_count),
        creator_reply_count = coalesce($17, creator_reply_count),
        updated_at = now()
      where
        ($1::uuid is not null and id = $1::uuid)
        or ($1::uuid is null and run_id = $2::uuid and attempt_number = $3)
    `,
    [
      attemptId || null,
      runId || null,
      attemptNumber,
      input.canonicalUrl ? String(input.canonicalUrl).trim() : null,
      input.acceptedAfter ? String(input.acceptedAfter).trim() : null,
      input.route ? String(input.route).trim() : null,
      serializeJsonOrNull(input.stageStatus ?? null),
      serializeJsonOrNull(input.stageTimingsMs ?? null),
      typeof input.transcriptAttempted === "boolean" ? input.transcriptAttempted : null,
      typeof input.transcriptSucceeded === "boolean" ? input.transcriptSucceeded : null,
      typeof input.ocrAttempted === "boolean" ? input.ocrAttempted : null,
      typeof input.ocrSucceeded === "boolean" ? input.ocrSucceeded : null,
      typeof input.visualAttempted === "boolean" ? input.visualAttempted : null,
      typeof input.visualSucceeded === "boolean" ? input.visualSucceeded : null,
      normalizeInteger(input.commentsFetchedCount),
      normalizeInteger(input.commentRepliesFetchedCount),
      normalizeInteger(input.creatorReplyCount),
    ],
  );
}

export async function upsertAttemptStageRuns(input: AttemptStageRunUpsertInput): Promise<void> {
  for (const stage of input.stages) {
    const stageKey = String(stage.stageKey || "").trim();
    if (!stageKey) continue;
    await database.query(
      `
        insert into attempt_stage_runs (
          id, run_id, attempt_id, attempt_number, stage_key, status, provider, reason, latency_ms, chars, metadata_json, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, now(), now())
        on conflict (run_id, attempt_number, stage_key)
        do update set
          attempt_id = coalesce(excluded.attempt_id, attempt_stage_runs.attempt_id),
          status = excluded.status,
          provider = excluded.provider,
          reason = excluded.reason,
          latency_ms = excluded.latency_ms,
          chars = excluded.chars,
          metadata_json = excluded.metadata_json,
          updated_at = now()
      `,
      [
        randomUUID(),
        input.runId,
        input.attemptId ?? null,
        input.attemptNumber,
        stageKey,
        stage.status ? String(stage.status).trim() : null,
        stage.provider ? String(stage.provider).trim() : null,
        stage.reason ? String(stage.reason) : null,
        normalizeInteger(stage.latencyMs),
        normalizeInteger(stage.chars),
        JSON.stringify(stage.metadataJson ?? {}),
      ],
    );
  }
}

export async function upsertAttemptEvidence(input: AttemptEvidenceUpsertInput): Promise<void> {
  for (const evidence of input.evidence) {
    const evidenceType = String(evidence.evidenceType || "").trim();
    if (!evidenceType) continue;
    await database.query(
      `
        insert into attempt_evidence (
          id, run_id, attempt_id, attempt_number, evidence_type, position, summary_text, source_ref, metrics_json, raw_json, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, now(), now())
        on conflict (run_id, attempt_number, evidence_type, position)
        do update set
          attempt_id = coalesce(excluded.attempt_id, attempt_evidence.attempt_id),
          summary_text = excluded.summary_text,
          source_ref = excluded.source_ref,
          metrics_json = excluded.metrics_json,
          raw_json = excluded.raw_json,
          updated_at = now()
      `,
      [
        randomUUID(),
        input.runId,
        input.attemptId ?? null,
        input.attemptNumber,
        evidenceType,
        normalizeInteger(evidence.position) ?? 0,
        evidence.summaryText ? String(evidence.summaryText) : null,
        evidence.sourceRef ? String(evidence.sourceRef) : null,
        JSON.stringify(evidence.metricsJson ?? {}),
        JSON.stringify(evidence.rawJson ?? {}),
      ],
    );
  }
}

export async function updateRunFinalOutcome(input: RunFinalOutcomeUpdateInput): Promise<void> {
  const runId = String(input.runId || "").trim();
  if (!runId) return;
  await database.query(
    `
      update reel_analytics_runs
      set
        final_user_action = coalesce($2, final_user_action),
        final_selected_place_id = coalesce($3, final_selected_place_id),
        updated_at = now()
      where id = $1
    `,
    [
      runId,
      input.finalUserAction ?? null,
      input.finalSelectedPlaceId ? String(input.finalSelectedPlaceId).trim() : null,
    ],
  );
}

export async function insertEntityFieldEdits(input: EntityFieldEditInsertInput): Promise<void> {
  for (const edit of input.edits) {
    const runId = String(edit.runId || "").trim();
    const fieldName = String(edit.fieldName || "").trim();
    if (!runId || !fieldName) continue;
    const dedupeKey = edit.dedupeKey
      ? String(edit.dedupeKey).trim()
      : buildEntityFieldEditDedupeKey({
          runId,
          attemptId: edit.attemptId ?? null,
          attemptNumber: edit.attemptNumber ?? null,
          entityId: edit.entityId ?? null,
          entityIndex: edit.entityIndex ?? null,
          fieldName,
          beforeValue: edit.beforeValue,
          afterValue: edit.afterValue,
        });
    await database.query(
      `
        insert into entity_field_edits (
          id, dedupe_key, run_id, attempt_id, attempt_number, entity_id, entity_index,
          field_name, before_value_json, after_value_json, edited_by_user_id, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, now())
        on conflict (dedupe_key) do nothing
      `,
      [
        randomUUID(),
        dedupeKey,
        runId,
        edit.attemptId ?? null,
        normalizeInteger(edit.attemptNumber),
        edit.entityId ?? null,
        normalizeInteger(edit.entityIndex),
        fieldName,
        serializeJsonOrNull(edit.beforeValue ?? null),
        serializeJsonOrNull(edit.afterValue ?? null),
        edit.editedByUserId ?? null,
      ],
    );
  }
}

function toReelJobDto(row: ReelJobRecord): ReelJobDto {
  return {
    id: row.id,
    runId: row.run_id,
    attemptId: row.attempt_id,
    attemptNumber: row.attempt_number,
    jobType: row.job_type,
    status: row.status,
    progressJson: row.progress_json || {},
    resultJson: row.result_json || null,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getReelJob(jobId: string): Promise<ReelJobDto | null> {
  const normalized = String(jobId || "").trim();
  if (!normalized) return null;
  const result = await database.query<ReelJobRecord>(
    "select * from reel_jobs where id = $1 limit 1",
    [normalized],
  );
  const row = result.rows[0];
  return row ? toReelJobDto(row) : null;
}
