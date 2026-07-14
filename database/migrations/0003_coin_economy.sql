create table if not exists coin_wallets (
  user_id uuid primary key references users(id) on delete cascade,
  balance_millis bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coin_wallets_nonnegative_balance check (balance_millis >= 0)
);

create table if not exists coin_reward_pools (
  pool_key text primary key,
  balance_millis bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coin_reward_pools_nonnegative_balance check (balance_millis >= 0)
);

insert into coin_reward_pools (pool_key, balance_millis)
values ('discover_recommenders', 0)
on conflict (pool_key) do nothing;

create table if not exists coin_account_flags (
  user_id uuid primary key references users(id) on delete cascade,
  is_blocked boolean not null default false,
  is_fraudulent boolean not null default false,
  is_reward_eligible boolean not null default true,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists coin_save_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  place_id text not null,
  source text not null check (source in ('external_import', 'discover')),
  idempotency_key text not null unique,
  charge_millis bigint not null check (charge_millis >= 0),
  reward_pool_millis bigint not null default 0 check (reward_pool_millis >= 0),
  platform_retention_millis bigint not null default 0 check (platform_retention_millis >= 0),
  recommender_snapshot_json jsonb not null default '[]'::jsonb,
  reward_distribution_json jsonb not null default '[]'::jsonb,
  rounding_policy text not null default 'largest_remainder_user_id_asc',
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, place_id)
);

create table if not exists coin_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  wallet_user_id uuid references users(id) on delete cascade,
  save_event_id uuid references coin_save_events(id) on delete set null,
  idempotency_key text not null unique,
  type text not null check (type in ('signup_grant', 'external_save_charge', 'discover_save_charge', 'reward_pool_credit', 'recommender_reward', 'platform_retention', 'refund', 'adjustment')),
  direction text not null check (direction in ('credit', 'debit', 'pool_credit', 'pool_debit')),
  amount_millis bigint not null check (amount_millis >= 0),
  balance_after_millis bigint,
  related_place_id text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_coin_transactions_wallet_created
  on coin_transactions(wallet_user_id, created_at desc)
  where wallet_user_id is not null;

create index if not exists idx_coin_transactions_save_event
  on coin_transactions(save_event_id);
