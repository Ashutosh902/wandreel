create table if not exists places (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  normalized_name text not null,
  primary_category text,
  latitude double precision,
  longitude double precision,
  city text,
  locality text,
  google_place_id text,
  canonical_status text not null default 'active' check (canonical_status in ('active', 'ambiguous', 'closed', 'merged', 'deleted')),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_places_google_place_id
  on places(google_place_id)
  where google_place_id is not null;

create index if not exists idx_places_normalized_city_locality
  on places(normalized_name, city, locality);

create index if not exists idx_places_normalized_coordinates
  on places(normalized_name, latitude, longitude)
  where latitude is not null and longitude is not null;

create table if not exists place_source_evidence (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places(id) on delete cascade,
  fact_type text not null,
  fact_value_json jsonb not null default '{}'::jsonb,
  source_type text not null,
  source_url text,
  source_record_id text,
  confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  observed_at timestamptz not null default now(),
  verified_at timestamptz,
  expires_at timestamptz,
  extraction_version text,
  intelligence_version text,
  evidence_fingerprint text not null,
  original_payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_place_source_evidence_fingerprint
  on place_source_evidence(place_id, fact_type, evidence_fingerprint);

create index if not exists idx_place_source_evidence_place_fact_observed
  on place_source_evidence(place_id, fact_type, observed_at desc);

create index if not exists idx_place_source_evidence_source_record
  on place_source_evidence(source_type, source_record_id)
  where source_record_id is not null;

alter table if exists user_saved_places
  add column if not exists canonical_place_id uuid references places(id) on delete set null;

create index if not exists idx_user_saved_places_canonical_place
  on user_saved_places(canonical_place_id)
  where canonical_place_id is not null;

create table if not exists user_place_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  canonical_place_id uuid references places(id) on delete set null,
  saved_place_id uuid references user_saved_places(id) on delete set null,
  legacy_place_id text,
  stroll_id uuid references strolls(id) on delete set null,
  interaction_type text not null check (interaction_type in (
    'saved',
    'unsaved',
    'viewed',
    'selected_for_stroll',
    'removed_from_stroll',
    'swapped_in',
    'swapped_out',
    'accepted_stroll',
    'visited'
  )),
  interaction_source text not null default 'system',
  metadata_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_user_place_interactions_user_occurred
  on user_place_interactions(user_id, occurred_at desc);

create index if not exists idx_user_place_interactions_place_occurred
  on user_place_interactions(canonical_place_id, occurred_at desc)
  where canonical_place_id is not null;

create table if not exists stroll_generation_snapshots (
  id uuid primary key default gen_random_uuid(),
  stroll_id uuid not null references strolls(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  generation_attempt integer not null check (generation_attempt > 0),
  context_schema_version text not null,
  curation_version text not null,
  request_context_json jsonb not null default '{}'::jsonb,
  user_context_snapshot_json jsonb not null default '{}'::jsonb,
  environment_context_snapshot_json jsonb not null default '{}'::jsonb,
  source_freshness_summary_json jsonb not null default '{}'::jsonb,
  diagnostics_json jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  unique (stroll_id, generation_attempt)
);

create index if not exists idx_stroll_generation_snapshots_user_generated
  on stroll_generation_snapshots(user_id, generated_at desc);

create table if not exists stroll_candidate_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references stroll_generation_snapshots(id) on delete cascade,
  canonical_place_id uuid references places(id) on delete set null,
  legacy_place_id text,
  eligible boolean not null,
  exclusion_reason text check (exclusion_reason in (
    'MISSING_COORDINATES',
    'WRONG_CITY',
    'DUPLICATE_PLACE',
    'GEOGRAPHIC_OUTLIER',
    'INSUFFICIENT_EVIDENCE',
    'EXPLICITLY_EXCLUDED',
    'ALREADY_SELECTED',
    'PLACE_UNAVAILABLE'
  )),
  deterministic_score numeric,
  candidate_rank integer,
  selected boolean not null default false,
  scoring_factors_json jsonb not null default '{}'::jsonb,
  evidence_summary_json jsonb not null default '{}'::jsonb,
  source_freshness_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check ((eligible = true and exclusion_reason is null) or (eligible = false and exclusion_reason is not null))
);

create index if not exists idx_stroll_candidate_snapshots_snapshot_rank
  on stroll_candidate_snapshots(snapshot_id, candidate_rank);

create index if not exists idx_stroll_candidate_snapshots_place
  on stroll_candidate_snapshots(canonical_place_id)
  where canonical_place_id is not null;

create or replace function prevent_stroll_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Stroll generation snapshots are immutable';
end;
$$;

drop trigger if exists trg_prevent_stroll_generation_snapshot_update on stroll_generation_snapshots;
create trigger trg_prevent_stroll_generation_snapshot_update
before update or delete on stroll_generation_snapshots
for each row execute function prevent_stroll_snapshot_mutation();

drop trigger if exists trg_prevent_stroll_candidate_snapshot_update on stroll_candidate_snapshots;
create trigger trg_prevent_stroll_candidate_snapshot_update
before update or delete on stroll_candidate_snapshots
for each row execute function prevent_stroll_snapshot_mutation();
