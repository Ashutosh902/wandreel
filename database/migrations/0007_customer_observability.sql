alter table if exists auth_sessions
  add column if not exists last_seen_at timestamptz;

alter table if exists auth_sessions
  add column if not exists ended_at timestamptz;

alter table if exists auth_sessions
  add column if not exists end_reason text;

alter table if exists auth_sessions
  add column if not exists client_platform text;

alter table if exists auth_sessions
  add column if not exists app_version text;

alter table if exists auth_sessions
  add column if not exists device_metadata_json jsonb not null default '{}'::jsonb;

create index if not exists idx_auth_sessions_user_last_seen
  on auth_sessions(user_id, coalesce(last_seen_at, created_at) desc);

create table if not exists operation_runs (
  id uuid primary key default gen_random_uuid(),
  operation_type text not null,
  user_id uuid references users(id) on delete set null,
  session_id uuid references auth_sessions(id) on delete set null,
  request_id text,
  correlation_id text,
  entity_type text,
  entity_id text,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  attempt_count integer not null default 1 check (attempt_count > 0),
  idempotency_key text,
  provider text,
  model_name text,
  version text,
  input_summary_json jsonb not null default '{}'::jsonb,
  output_summary_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (octet_length(input_summary_json::text) <= 8192),
  check (octet_length(output_summary_json::text) <= 8192)
);

create unique index if not exists idx_operation_runs_idempotency
  on operation_runs(operation_type, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_operation_runs_user_started
  on operation_runs(user_id, started_at desc)
  where user_id is not null;

create index if not exists idx_operation_runs_session_started
  on operation_runs(session_id, started_at desc)
  where session_id is not null;

create index if not exists idx_operation_runs_type_status
  on operation_runs(operation_type, status, started_at desc);

create index if not exists idx_operation_runs_request_id
  on operation_runs(request_id)
  where request_id is not null;

create index if not exists idx_operation_runs_correlation_id
  on operation_runs(correlation_id)
  where correlation_id is not null;

create index if not exists idx_operation_runs_entity
  on operation_runs(entity_type, entity_id, started_at desc)
  where entity_type is not null and entity_id is not null;

create table if not exists user_location_contexts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  session_id uuid references auth_sessions(id) on delete set null,
  source text not null check (source in ('device', 'manual_city', 'map_selection', 'stroll_start', 'ip_approximate')),
  latitude double precision check (latitude is null or (latitude >= -90 and latitude <= 90)),
  longitude double precision check (longitude is null or (longitude >= -180 and longitude <= 180)),
  accuracy_meters integer check (accuracy_meters is null or accuracy_meters >= 0),
  city text,
  locality text,
  permission_status text check (permission_status is null or permission_status in ('granted', 'denied', 'prompt', 'unavailable', 'unknown')),
  consent_source text,
  captured_at timestamptz not null default now(),
  expires_at timestamptz,
  check (
    source <> 'device'
    or expires_at is not null
  )
);

create index if not exists idx_user_location_contexts_user_captured
  on user_location_contexts(user_id, captured_at desc)
  where user_id is not null;

create index if not exists idx_user_location_contexts_session_captured
  on user_location_contexts(session_id, captured_at desc)
  where session_id is not null;

create index if not exists idx_user_location_contexts_expires
  on user_location_contexts(expires_at)
  where expires_at is not null;

alter table if exists app_usage_events
  add column if not exists session_id uuid references auth_sessions(id) on delete set null;

alter table if exists app_usage_events
  add column if not exists request_id text;

alter table if exists app_usage_events
  add column if not exists operation_run_id uuid references operation_runs(id) on delete set null;

alter table if exists app_usage_events
  add column if not exists entity_type text;

alter table if exists app_usage_events
  add column if not exists entity_id text;

alter table if exists app_usage_events
  add column if not exists route_name text;

alter table if exists app_usage_events
  add column if not exists source_surface text;

alter table if exists app_usage_events
  add column if not exists outcome text check (outcome is null or outcome in ('started', 'succeeded', 'failed', 'cancelled', 'viewed'));

alter table if exists app_usage_events
  add column if not exists duration_ms integer check (duration_ms is null or duration_ms >= 0);

alter table if exists app_usage_events
  add column if not exists location_context_id uuid references user_location_contexts(id) on delete set null;

alter table if exists app_usage_events
  add column if not exists schema_version integer not null default 1;

create index if not exists idx_app_usage_events_session_created
  on app_usage_events(session_id, created_at desc)
  where session_id is not null;

create index if not exists idx_app_usage_events_request_id
  on app_usage_events(request_id)
  where request_id is not null;

create index if not exists idx_app_usage_events_operation_created
  on app_usage_events(operation_run_id, created_at desc)
  where operation_run_id is not null;

create index if not exists idx_app_usage_events_entity_created
  on app_usage_events(entity_type, entity_id, created_at desc)
  where entity_type is not null and entity_id is not null;

create index if not exists idx_app_usage_events_type_created
  on app_usage_events(event_type, created_at desc);

create table if not exists failure_events (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('customer', 'system', 'provider', 'background_job', 'financial')),
  severity text not null check (severity in ('info', 'warning', 'error', 'critical')),
  error_code text not null,
  error_category text,
  user_id uuid references users(id) on delete set null,
  session_id uuid references auth_sessions(id) on delete set null,
  request_id text,
  correlation_id text,
  operation_run_id uuid references operation_runs(id) on delete set null,
  entity_type text,
  entity_id text,
  provider text,
  http_status integer check (http_status is null or (http_status >= 100 and http_status <= 599)),
  public_message text,
  internal_message text,
  retryable boolean,
  attempt_number integer check (attempt_number is null or attempt_number > 0),
  resolved_at timestamptz,
  metadata_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  check (octet_length(metadata_json::text) <= 8192)
);

create index if not exists idx_failure_events_user_occurred
  on failure_events(user_id, occurred_at desc)
  where user_id is not null;

create index if not exists idx_failure_events_session_occurred
  on failure_events(session_id, occurred_at desc)
  where session_id is not null;

create index if not exists idx_failure_events_unresolved
  on failure_events(severity, occurred_at desc)
  where resolved_at is null;

create index if not exists idx_failure_events_request_id
  on failure_events(request_id)
  where request_id is not null;

create index if not exists idx_failure_events_correlation_id
  on failure_events(correlation_id)
  where correlation_id is not null;

create index if not exists idx_failure_events_entity
  on failure_events(entity_type, entity_id, occurred_at desc)
  where entity_type is not null and entity_id is not null;
