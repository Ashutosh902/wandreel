create table if not exists stroll_curation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  stroll_id uuid not null references strolls(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  trigger_mode text not null default 'initial' check (trigger_mode in ('initial', 'retry', 'recovery')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  next_run_at timestamptz not null default now(),
  started_at timestamptz,
  succeeded_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_stroll_curation_jobs_one_active
  on stroll_curation_jobs(stroll_id)
  where status in ('queued', 'running');

create index if not exists idx_stroll_curation_jobs_claimable
  on stroll_curation_jobs(status, next_run_at, lease_expires_at);

create index if not exists idx_stroll_curation_jobs_user_stroll_created
  on stroll_curation_jobs(user_id, stroll_id, created_at desc);
