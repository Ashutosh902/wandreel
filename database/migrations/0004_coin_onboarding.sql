create table if not exists coin_onboarding_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  eligible boolean not null default false,
  coin_onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata_json jsonb not null default '{}'::jsonb
);

create index if not exists idx_coin_onboarding_preferences_eligible
  on coin_onboarding_preferences(eligible, coin_onboarding_completed_at);
