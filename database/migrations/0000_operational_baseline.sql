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

create table if not exists auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists auth_email_otps (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  otp_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_auth_email_otps_email_created
  on auth_email_otps(email, created_at desc);

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

create index if not exists idx_user_saved_places_user_created
  on user_saved_places(user_id, created_at desc);

create table if not exists app_usage_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  user_id uuid references users(id) on delete set null,
  anonymous_id text,
  created_at timestamptz not null default now(),
  metadata_json jsonb
);

create index if not exists idx_app_usage_events_created
  on app_usage_events(created_at desc);

create index if not exists idx_app_usage_events_user_created
  on app_usage_events(user_id, created_at desc);

create index if not exists idx_app_usage_events_anon_created
  on app_usage_events(anonymous_id, created_at desc);

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

create index if not exists idx_submitted_links_last_seen
  on submitted_links(last_seen_at desc);

alter table if exists reel_analytics_runs
  add column if not exists submitted_link_id uuid references submitted_links(id) on delete set null;

alter table if exists reel_analytics_runs
  add column if not exists canonical_url text;

alter table if exists reel_analytics_runs
  add column if not exists final_user_action text;

alter table if exists reel_analytics_runs
  add column if not exists final_selected_place_id text;

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

create index if not exists idx_reel_analytics_attempts_run_attempt
  on reel_analytics_attempts(run_id, attempt_number desc);

alter table if exists reel_analytics_attempts
  add column if not exists extraction_result_json jsonb;

alter table if exists reel_analytics_attempts
  add column if not exists intelligence_result_json jsonb;

alter table if exists reel_analytics_attempts
  add column if not exists hypothesis_json jsonb;

alter table if exists reel_analytics_attempts
  add column if not exists updated_at timestamptz not null default now();

alter table if exists reel_analytics_attempts
  add column if not exists canonical_url text;

alter table if exists reel_analytics_attempts
  add column if not exists accepted_after text;

alter table if exists reel_analytics_attempts
  add column if not exists route text;

alter table if exists reel_analytics_attempts
  add column if not exists stage_status_json jsonb;

alter table if exists reel_analytics_attempts
  add column if not exists stage_timings_ms_json jsonb;

alter table if exists reel_analytics_attempts
  add column if not exists transcript_attempted boolean;

alter table if exists reel_analytics_attempts
  add column if not exists transcript_succeeded boolean;

alter table if exists reel_analytics_attempts
  add column if not exists ocr_attempted boolean;

alter table if exists reel_analytics_attempts
  add column if not exists ocr_succeeded boolean;

alter table if exists reel_analytics_attempts
  add column if not exists visual_attempted boolean;

alter table if exists reel_analytics_attempts
  add column if not exists visual_succeeded boolean;

alter table if exists reel_analytics_attempts
  add column if not exists comments_fetched_count integer;

alter table if exists reel_analytics_attempts
  add column if not exists comment_replies_fetched_count integer;

alter table if exists reel_analytics_attempts
  add column if not exists creator_reply_count integer;

create table if not exists reel_analytics_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references reel_analytics_runs(id) on delete cascade,
  attempt_number integer,
  event_name text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

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

create index if not exists idx_reel_entities_run_id
  on reel_analytics_entities(run_id);

create index if not exists idx_reel_entities_attempt_id
  on reel_analytics_entities(attempt_id);

create index if not exists idx_reel_entities_final_place_id
  on reel_analytics_entities(final_place_id);

create index if not exists idx_reel_entities_type
  on reel_analytics_entities(entity_type);

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

create index if not exists idx_attempt_stage_runs_attempt
  on attempt_stage_runs(attempt_id);

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

create index if not exists idx_attempt_evidence_attempt
  on attempt_evidence(attempt_id);

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

create index if not exists idx_entity_field_edits_run_attempt
  on entity_field_edits(run_id, attempt_number, created_at desc);

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

create index if not exists idx_reel_jobs_run_id
  on reel_jobs(run_id);

create index if not exists idx_reel_jobs_attempt_id
  on reel_jobs(attempt_id);

create index if not exists idx_reel_jobs_status
  on reel_jobs(status);

create index if not exists idx_reel_jobs_created_at
  on reel_jobs(created_at desc);
