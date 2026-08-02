alter table if exists user_location_contexts
  add column if not exists anonymized_at timestamptz;

alter table if exists user_location_contexts
  add column if not exists retention_class text;

update user_location_contexts
set retention_class = case
  when source in ('device', 'map_selection', 'stroll_start') then 'precise_location'
  when source = 'ip_approximate' then 'approximate_location'
  else 'city_level'
end
where retention_class is null;

alter table if exists user_location_contexts
  alter column retention_class set default 'city_level';

alter table if exists user_location_contexts
  alter column retention_class set not null;

create index if not exists idx_auth_sessions_expires_created
  on auth_sessions(expires_at, created_at desc);

create index if not exists idx_auth_sessions_ended_at
  on auth_sessions(ended_at)
  where ended_at is not null;

create index if not exists idx_operation_runs_running_started
  on operation_runs(operation_type, started_at asc)
  where status = 'running';

create index if not exists idx_operation_runs_completed_at
  on operation_runs(completed_at desc)
  where completed_at is not null;

create index if not exists idx_failure_events_resolved
  on failure_events(resolved_at, occurred_at desc)
  where resolved_at is not null;

create index if not exists idx_failure_events_operation_run
  on failure_events(operation_run_id, occurred_at desc)
  where operation_run_id is not null;

create index if not exists idx_user_location_contexts_retention_expiry
  on user_location_contexts(retention_class, expires_at)
  where expires_at is not null;

create index if not exists idx_place_source_evidence_observed_at
  on place_source_evidence(observed_at desc);

create index if not exists idx_stroll_curation_jobs_status_started
  on stroll_curation_jobs(status, started_at desc);
