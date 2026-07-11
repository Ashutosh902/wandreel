create table if not exists schema_migrations (
  version text primary key,
  name text not null,
  applied_at timestamptz not null default now()
);

create table if not exists user_stroll_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  onboarding_decision text not null default 'unseen' check (onboarding_decision in ('unseen', 'accepted', 'declined')),
  onboarding_decision_at timestamptz,
  default_traveller_count integer check (default_traveller_count is null or default_traveller_count between 1 and 20),
  default_interests_json jsonb not null default '[]'::jsonb,
  default_start_time text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists strolls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  client_request_id text,
  name text not null,
  description text,
  city text not null,
  status text not null default 'draft' check (status in ('draft', 'queued', 'curating', 'ready', 'failed', 'archived')),
  source text not null default 'manual' check (source in ('onboarding', 'hero', 'manual', 'saved_places')),
  start_date date,
  end_date date,
  requested_start_time text,
  traveller_count integer check (traveller_count is null or traveller_count between 1 and 20),
  interests_json jsonb not null default '[]'::jsonb,
  latitude double precision,
  longitude double precision,
  total_distance_meters integer,
  estimated_duration_minutes integer,
  generation_version text,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  curated_at timestamptz,
  archived_at timestamptz
);

create unique index if not exists idx_strolls_user_client_request
  on strolls(user_id, client_request_id)
  where client_request_id is not null;

create index if not exists idx_strolls_user_status_updated
  on strolls(user_id, status, updated_at desc);

create index if not exists idx_strolls_user_created
  on strolls(user_id, created_at desc);

create table if not exists stroll_stops (
  id uuid primary key default gen_random_uuid(),
  stroll_id uuid not null references strolls(id) on delete cascade,
  place_id text not null,
  sequence integer not null check (sequence > 0),
  reason text,
  generated_description text,
  description_generation_meta_json jsonb,
  estimated_visit_duration_minutes integer,
  arrival_estimate timestamptz,
  departure_estimate timestamptz,
  route_distance_meters integer,
  route_duration_minutes integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_stroll_stops_stroll_sequence
  on stroll_stops(stroll_id, sequence);

create unique index if not exists idx_stroll_stops_stroll_place
  on stroll_stops(stroll_id, place_id);

create index if not exists idx_stroll_stops_place_id
  on stroll_stops(place_id);

create table if not exists hero_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  card_key text not null,
  hero_type text not null default 'city_category_insight',
  cta_action text,
  title text,
  subtitle text,
  metadata_json jsonb not null default '{}'::jsonb,
  matching_place_ids_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists idx_hero_bookmarks_user_card_key
  on hero_bookmarks(user_id, card_key);

create index if not exists idx_hero_bookmarks_user_active
  on hero_bookmarks(user_id, updated_at desc)
  where deleted_at is null;

create table if not exists hero_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  card_key text not null,
  hero_type text,
  action text not null check (action in ('exposed', 'clicked', 'bookmarked', 'unbookmarked', 'dismissed', 'completed')),
  metadata_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_hero_interactions_user_occurred
  on hero_interactions(user_id, occurred_at desc);

create index if not exists idx_hero_interactions_card_key_occurred
  on hero_interactions(card_key, occurred_at desc);
