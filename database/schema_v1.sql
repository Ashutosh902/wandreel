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
  phone text unique,
  username text,
  password_hash text not null,
  created_at timestamptz not null default now(),
  status text not null default 'active'
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
