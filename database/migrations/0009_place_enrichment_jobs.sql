create table if not exists place_enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  user_id uuid references users(id) on delete set null,
  saved_place_id uuid references user_saved_places(id) on delete set null,
  canonical_place_id uuid references places(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'partial', 'failed')),
  attempts integer not null default 0,
  max_attempts integer not null default 4 check (max_attempts > 0),
  lease_owner text,
  lease_expires_at timestamptz,
  source_url text,
  source_platform text,
  trigger_reason text not null default 'save',
  last_error text,
  next_retry_at timestamptz not null default now(),
  last_started_at timestamptz,
  completed_at timestamptz,
  payload_json jsonb not null default '{}'::jsonb,
  result_summary_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_place_enrichment_jobs_status_retry
  on place_enrichment_jobs(status, next_retry_at, created_at);

create index if not exists idx_place_enrichment_jobs_place_created
  on place_enrichment_jobs(canonical_place_id, created_at desc)
  where canonical_place_id is not null;

create index if not exists idx_place_enrichment_jobs_saved_place
  on place_enrichment_jobs(saved_place_id, created_at desc)
  where saved_place_id is not null;
