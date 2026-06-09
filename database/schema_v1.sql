-- Wandreel PostgreSQL v1 schema draft
-- Source: Pinshort auth/user patterns + Wandreel extraction/intelligence pipeline

create extension if not exists pgcrypto;

-- ----------------------------
-- Enums
-- ----------------------------
create type source_platform as enum ('youtube','instagram','google_maps','website','unknown');
create type supported_category as enum ('eat','do','stay','see');
create type pipeline_stage as enum ('extract','transcript','ocr','intelligence','preprocess','resolve');
create type pipeline_status as enum ('queued','running','completed','failed');
create type intelligence_status as enum ('ready','needs_review','no_supported_entity_found');
create type source_type as enum (
  'travel_discovery_video',
  'restaurant_recommendation',
  'itinerary',
  'stay_recommendation',
  'activity_recommendation',
  'sightseeing_recommendation',
  'mixed_discovery',
  'unknown'
);

-- ----------------------------
-- User/Auth tables
-- ----------------------------
create table users (
  user_id uuid primary key default gen_random_uuid(),
  email text unique,
  email_verified boolean not null default false,
  phone text unique,
  phone_verified boolean not null default false,
  username text,
  display_name text,
  avatar_url text,
  auth_provider text,
  provider_id text,
  password_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'active',
  unique (auth_provider, provider_id)
);

create table auth_otp (
  otp_id bigserial primary key,
  identifier text not null,
  otp_code text not null,
  channel text not null default 'sms',
  status text not null default 'issued',
  expires_at timestamptz not null,
  resend_count integer not null default 0,
  verify_attempt_count integer not null default 0,
  cooldown_until timestamptz,
  lockout_until timestamptz,
  consumed_at timestamptz,
  is_verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table auth_sessions (
  session_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table auth_email_otps (
  email_otp_id uuid primary key default gen_random_uuid(),
  email text not null,
  otp_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table auth_journey_events (
  event_id uuid primary key default gen_random_uuid(),
  event_name text not null,
  identifier_hash text,
  identifier_kind text,
  channel text,
  user_id uuid references users(user_id) on delete set null,
  success boolean not null default true,
  error_code text,
  metadata_json jsonb,
  created_at timestamptz not null default now()
);

create table user_preferences (
  user_id uuid primary key references users(user_id) on delete cascade,
  pref_city text,
  pref_state text,
  pref_country text,
  language text,
  content_mode text,
  updated_at timestamptz not null default now()
);

create table user_activity_events (
  event_id uuid primary key default gen_random_uuid(),
  user_id uuid references users(user_id) on delete set null,
  event_name text not null,
  session_id text,
  anonymous_id text,
  source_id uuid,
  entity_id uuid,
  category supported_category,
  source_platform source_platform,
  page_path text,
  source_url_hash text,
  ip_hash text,
  user_agent_hash text,
  properties_json jsonb,
  created_at timestamptz not null default now()
);

-- ----------------------------
-- Source + pipeline tables
-- ----------------------------
create table sources (
  source_id uuid primary key default gen_random_uuid(),
  canonical_url text not null unique,
  url_hash text not null unique,
  platform source_platform not null default 'unknown',
  latest_title text,
  latest_description text,
  latest_thumbnail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_source_submissions (
  submission_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  source_id uuid not null references sources(source_id) on delete cascade,
  original_url text not null,
  ingest_channel text,
  submitted_at timestamptz not null default now(),
  unique (user_id, source_id)
);

create table pipeline_runs (
  run_id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(source_id) on delete cascade,
  trigger_user_id uuid references users(user_id) on delete set null,
  run_mode text not null default 'sync',
  status pipeline_status not null default 'queued',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table pipeline_stage_runs (
  stage_run_id uuid primary key default gen_random_uuid(),
  run_id uuid not null references pipeline_runs(run_id) on delete cascade,
  source_id uuid not null references sources(source_id) on delete cascade,
  stage pipeline_stage not null,
  status pipeline_status not null default 'queued',
  attempt_count integer not null default 0,
  latency_ms integer,
  error_text text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index idx_pipeline_stage_runs_source_stage on pipeline_stage_runs(source_id, stage, created_at desc);

create table extraction_outputs_raw (
  extraction_output_id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(source_id) on delete cascade,
  run_id uuid not null references pipeline_runs(run_id) on delete cascade,
  stage_run_id uuid not null references pipeline_stage_runs(stage_run_id) on delete cascade,
  mode text not null,
  provider text,
  metadata_json jsonb not null,
  transcript_json jsonb,
  ocr_json jsonb,
  schema_version text not null default 'v1',
  created_at timestamptz not null default now()
);

create table intelligence_outputs_raw (
  intelligence_output_id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(source_id) on delete cascade,
  run_id uuid not null references pipeline_runs(run_id) on delete cascade,
  stage_run_id uuid not null references pipeline_stage_runs(stage_run_id) on delete cascade,
  model text not null,
  prompt_version text,
  raw_response_json jsonb,
  normalized_output_json jsonb,
  validation_errors_json jsonb,
  fixed boolean not null default false,
  status intelligence_status not null,
  schema_version text not null default 'v1',
  created_at timestamptz not null default now()
);

-- ----------------------------
-- Master tables
-- ----------------------------
create table locations_master (
  location_id uuid primary key default gen_random_uuid(),
  name text not null,
  locality text,
  city text,
  state text,
  country text,
  lat double precision,
  lng double precision,
  place_type text,
  created_at timestamptz not null default now()
);

create table collections_master (
  collection_id uuid primary key default gen_random_uuid(),
  name text not null,
  collection_type text not null,
  city text,
  state text,
  country text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (name, collection_type, coalesce(city,''), coalesce(state,''), coalesce(country,''))
);

create table entities_master (
  entity_id uuid primary key default gen_random_uuid(),
  normalized_name text not null,
  entity_type text not null,
  default_category supported_category,
  location_id uuid references locations_master(location_id) on delete set null,
  google_maps_query text,
  canonical_tags_json jsonb,
  created_at timestamptz not null default now(),
  status text not null default 'active'
);

create index idx_entities_master_name on entities_master(normalized_name);

-- ----------------------------
-- Processed/link tables
-- ----------------------------
create table source_entities (
  source_entity_id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(source_id) on delete cascade,
  run_id uuid not null references pipeline_runs(run_id) on delete cascade,
  entity_id uuid references entities_master(entity_id) on delete set null,
  category supported_category not null,
  name text not null,
  city text,
  state text,
  country text,
  locality text,
  tags_json jsonb,
  details_json jsonb,
  source_evidence text,
  confidence double precision not null check (confidence >= 0 and confidence <= 1),
  preprocess_version text not null default 'v1',
  created_at timestamptz not null default now()
);

create table source_categories (
  source_category_id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(source_id) on delete cascade,
  run_id uuid not null references pipeline_runs(run_id) on delete cascade,
  category supported_category not null,
  confidence double precision not null check (confidence >= 0 and confidence <= 1),
  is_weak_mention boolean not null default false,
  created_at timestamptz not null default now(),
  unique (source_id, run_id, category, is_weak_mention)
);

create table source_visibility_views (
  visibility_id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(source_id) on delete cascade,
  run_id uuid not null references pipeline_runs(run_id) on delete cascade,
  show_in_json jsonb not null,
  do_not_show_in_json jsonb not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (source_id, run_id)
);

-- ----------------------------
-- User saved domain
-- ----------------------------
create table user_saved_items (
  saved_item_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  source_id uuid not null references sources(source_id) on delete cascade,
  entity_id uuid references entities_master(entity_id) on delete set null,
  saved_category supported_category,
  custom_title text,
  note text,
  saved_at timestamptz not null default now(),
  status text not null default 'active'
);

create index idx_user_saved_items_user_saved_at on user_saved_items(user_id, saved_at desc);

-- ----------------------------
-- Daily metrics
-- ----------------------------
create table pipeline_metrics_daily (
  metric_date date not null,
  stage pipeline_stage not null,
  platform source_platform not null,
  total_requests integer not null default 0,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  p50_ms integer,
  p95_ms integer,
  primary key (metric_date, stage, platform)
);

-- ----------------------------
-- Reel analytics
-- ----------------------------
create table reel_analytics_runs (
  id uuid primary key default gen_random_uuid(),
  client_run_id text not null unique,
  user_id uuid references users(user_id) on delete set null,
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

create table reel_analytics_attempts (
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
  created_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (run_id, attempt_number)
);

create table reel_analytics_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references reel_analytics_runs(id) on delete cascade,
  attempt_number integer,
  event_name text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table reel_analytics_entities (
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

create table reel_jobs (
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
