import { randomUUID } from "node:crypto";
export type ObservabilityQueryable = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

export const PRODUCT_EVENT_TYPES = [
  "app_opened",
  "login_started",
  "login_seen",
  "login_succeeded",
  "login_failed",
  "logout",
  "screen_viewed",
  "add_flow_started",
  "link_submitted",
  "extraction_started",
  "extraction_succeeded",
  "extraction_failed",
  "place_save_started",
  "place_save_succeeded",
  "place_save_failed",
  "stroll_creation_started",
  "stroll_generation_started",
  "stroll_generation_succeeded",
  "stroll_generation_failed",
  "stroll_opened",
  "stroll_stop_removed",
  "stroll_stop_swapped",
  "wallet_opened",
  "coin_onboarding_viewed",
  "coin_onboarding_explore_discover_clicked",
  "coin_onboarding_add_place_clicked",
  "coin_onboarding_dismissed",
  "coin_help_opened",
  "impact_opened",
  "impact_top_place_clicked",
  "impact_month_changed",
  "impact_empty_cta_clicked",
  "stroll_context_shadow_failed",
] as const;

export type ProductEventType = typeof PRODUCT_EVENT_TYPES[number];
export type ProductEventOutcome = "started" | "succeeded" | "failed" | "cancelled" | "viewed";
export type OperationStatus = "running" | "succeeded" | "failed" | "cancelled";
export type FailureScope = "customer" | "system" | "provider" | "background_job" | "financial";
export type FailureSeverity = "info" | "warning" | "error" | "critical";
export type LocationContextSource = "device" | "manual_city" | "map_selection" | "stroll_start" | "ip_approximate";
export type LocationPermissionStatus = "granted" | "denied" | "prompt" | "unavailable" | "unknown";

export type ProductEventInput = {
  eventType: ProductEventType;
  userId?: string | null;
  anonymousId?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  operationRunId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  routeName?: string | null;
  sourceSurface?: string | null;
  outcome?: ProductEventOutcome | null;
  durationMs?: number | null;
  locationContextId?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type OperationRunInput = {
  operationType: string;
  userId?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  status?: OperationStatus;
  attemptCount?: number | null;
  idempotencyKey?: string | null;
  provider?: string | null;
  modelName?: string | null;
  version?: string | null;
  inputSummary?: Record<string, unknown> | null;
};

export type CompleteOperationRunInput = {
  operationRunId: string;
  status: Exclude<OperationStatus, "running">;
  outputSummary?: Record<string, unknown> | null;
  completedAt?: Date;
};

export type FailureEventInput = {
  scope: FailureScope;
  severity: FailureSeverity;
  errorCode: string;
  errorCategory?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  operationRunId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  provider?: string | null;
  httpStatus?: number | null;
  publicMessage?: string | null;
  internalMessage?: string | null;
  retryable?: boolean | null;
  attemptNumber?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type LocationContextInput = {
  userId?: string | null;
  sessionId?: string | null;
  source: LocationContextSource;
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  city?: string | null;
  locality?: string | null;
  permissionStatus?: LocationPermissionStatus | null;
  consentSource?: string | null;
  capturedAt?: Date;
  expiresAt?: Date | null;
};

const allowedProductEvents = new Set<string>(PRODUCT_EVENT_TYPES);
const MAX_METADATA_BYTES = 8192;
const MAX_INTERNAL_MESSAGE_LENGTH = 1000;
const DEFAULT_PRECISE_LOCATION_RETENTION_DAYS = 14;

export function isAllowedProductEventType(value: string): value is ProductEventType {
  return allowedProductEvents.has(value);
}

function cleanText(value: unknown, maxLength = 200) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function safeInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function boundedJson(value: Record<string, unknown> | null | undefined) {
  const candidate = value && typeof value === "object" ? value : {};
  const json = JSON.stringify(candidate);
  if (Buffer.byteLength(json, "utf8") > MAX_METADATA_BYTES) {
    throw new Error("metadata_json exceeds observability size limit");
  }
  return json;
}

function maybeUuid(value: unknown) {
  const text = cleanText(value, 80);
  return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

export function buildRequestId(prefix: string) {
  return `${prefix}:${randomUUID()}`;
}

export async function touchSession(database: ObservabilityQueryable, input: {
  sessionId: string;
  clientPlatform?: string | null;
  appVersion?: string | null;
  deviceMetadata?: Record<string, unknown> | null;
}) {
  await database.query(
    `update auth_sessions
     set last_seen_at = now(),
         client_platform = coalesce($2, client_platform),
         app_version = coalesce($3, app_version),
         device_metadata_json = case when $4::jsonb = '{}'::jsonb then device_metadata_json else $4::jsonb end
     where id = $1`,
    [
      input.sessionId,
      cleanText(input.clientPlatform, 80),
      cleanText(input.appVersion, 80),
      boundedJson(input.deviceMetadata),
    ],
  );
}

export async function endSession(database: ObservabilityQueryable, input: {
  sessionId: string;
  endReason: "logout" | "expired" | "revoked" | "unknown";
}) {
  await database.query(
    `update auth_sessions
     set ended_at = coalesce(ended_at, now()),
         end_reason = coalesce(end_reason, $2),
         last_seen_at = coalesce(last_seen_at, now())
     where id = $1`,
    [input.sessionId, input.endReason],
  );
}

export async function recordProductEvent(database: ObservabilityQueryable, input: ProductEventInput) {
  if (!isAllowedProductEventType(input.eventType)) {
    throw new Error("Invalid product event type");
  }
  const result = await database.query<{ id: string }>(
    `insert into app_usage_events (
       id, event_type, user_id, anonymous_id, session_id, request_id, operation_run_id,
       entity_type, entity_id, route_name, source_surface, outcome, duration_ms,
       location_context_id, schema_version, metadata_json, created_at
     )
     values (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12, $13,
       $14, 1, $15::jsonb, now()
     )
     returning id`,
    [
      randomUUID(),
      input.eventType,
      maybeUuid(input.userId),
      cleanText(input.anonymousId, 120),
      maybeUuid(input.sessionId),
      cleanText(input.requestId, 160),
      maybeUuid(input.operationRunId),
      cleanText(input.entityType, 80),
      cleanText(input.entityId, 160),
      cleanText(input.routeName, 120),
      cleanText(input.sourceSurface, 120),
      input.outcome ?? null,
      safeInteger(input.durationMs),
      maybeUuid(input.locationContextId),
      boundedJson(input.metadata),
    ],
  );
  return result.rows[0]?.id ?? null;
}

export async function createOperationRun(database: ObservabilityQueryable, input: OperationRunInput) {
  const operationType = cleanText(input.operationType, 120);
  if (!operationType) throw new Error("operationType is required");
  const result = await database.query<{ id: string }>(
    `insert into operation_runs (
       id, operation_type, user_id, session_id, request_id, correlation_id,
       entity_type, entity_id, status, attempt_count, idempotency_key,
       provider, model_name, version, input_summary_json, output_summary_json, started_at, created_at
     )
     values (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11,
       $12, $13, $14, $15::jsonb, '{}'::jsonb, now(), now()
     )
     on conflict (operation_type, idempotency_key)
     where idempotency_key is not null
     do update set request_id = coalesce(operation_runs.request_id, excluded.request_id)
     returning id`,
    [
      randomUUID(),
      operationType,
      maybeUuid(input.userId),
      maybeUuid(input.sessionId),
      cleanText(input.requestId, 160),
      cleanText(input.correlationId, 160),
      cleanText(input.entityType, 80),
      cleanText(input.entityId, 160),
      input.status ?? "running",
      Math.max(1, safeInteger(input.attemptCount) ?? 1),
      cleanText(input.idempotencyKey, 200),
      cleanText(input.provider, 80),
      cleanText(input.modelName, 120),
      cleanText(input.version, 80),
      boundedJson(input.inputSummary),
    ],
  );
  return result.rows[0]?.id ?? null;
}

export async function completeOperationRun(database: ObservabilityQueryable, input: CompleteOperationRunInput) {
  await database.query(
    `update operation_runs
     set status = $2,
         completed_at = coalesce($3, now()),
         duration_ms = greatest(0, floor(extract(epoch from (coalesce($3, now()) - started_at)) * 1000)::integer),
         output_summary_json = $4::jsonb
     where id = $1`,
    [
      input.operationRunId,
      input.status,
      input.completedAt?.toISOString() ?? null,
      boundedJson(input.outputSummary),
    ],
  );
}

export async function recordFailureEvent(database: ObservabilityQueryable, input: FailureEventInput) {
  const errorCode = cleanText(input.errorCode, 160);
  if (!errorCode) throw new Error("errorCode is required");
  const result = await database.query<{ id: string }>(
    `insert into failure_events (
       id, scope, severity, error_code, error_category, user_id, session_id,
       request_id, correlation_id, operation_run_id, entity_type, entity_id,
       provider, http_status, public_message, internal_message, retryable,
       attempt_number, metadata_json, occurred_at
     )
     values (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12,
       $13, $14, $15, $16, $17,
       $18, $19::jsonb, now()
     )
     returning id`,
    [
      randomUUID(),
      input.scope,
      input.severity,
      errorCode,
      cleanText(input.errorCategory, 120),
      maybeUuid(input.userId),
      maybeUuid(input.sessionId),
      cleanText(input.requestId, 160),
      cleanText(input.correlationId, 160),
      maybeUuid(input.operationRunId),
      cleanText(input.entityType, 80),
      cleanText(input.entityId, 160),
      cleanText(input.provider, 80),
      safeInteger(input.httpStatus),
      cleanText(input.publicMessage, 400),
      cleanText(input.internalMessage, MAX_INTERNAL_MESSAGE_LENGTH),
      input.retryable ?? null,
      input.attemptNumber && input.attemptNumber > 0 ? input.attemptNumber : null,
      boundedJson(input.metadata),
    ],
  );
  return result.rows[0]?.id ?? null;
}

export async function recordLocationContext(database: ObservabilityQueryable, input: LocationContextInput) {
  const source = input.source;
  const isPrecise = source === "device" || source === "map_selection" || source === "stroll_start";
  const expiresAt =
    input.expiresAt ??
    (isPrecise
      ? new Date(Date.now() + DEFAULT_PRECISE_LOCATION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
      : null);
  const result = await database.query<{ id: string }>(
    `insert into user_location_contexts (
       id, user_id, session_id, source, latitude, longitude, accuracy_meters,
       city, locality, permission_status, consent_source, captured_at, expires_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, coalesce($12, now()), $13)
     returning id`,
    [
      randomUUID(),
      maybeUuid(input.userId),
      maybeUuid(input.sessionId),
      source,
      Number.isFinite(input.latitude) ? input.latitude : null,
      Number.isFinite(input.longitude) ? input.longitude : null,
      safeInteger(input.accuracyMeters),
      cleanText(input.city, 120),
      cleanText(input.locality, 120),
      input.permissionStatus ?? null,
      cleanText(input.consentSource, 120),
      input.capturedAt?.toISOString() ?? null,
      expiresAt?.toISOString() ?? null,
    ],
  );
  return result.rows[0]?.id ?? null;
}

export async function bestEffortObservability(task: () => Promise<unknown>) {
  try {
    await task();
  } catch (error) {
    console.warn("observability_write_failed", error instanceof Error ? error.message : String(error));
  }
}
