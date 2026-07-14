create index if not exists idx_user_saved_places_place_global_created
  on user_saved_places(place_id, user_id, created_at)
  where metadata_json->>'sharedVisibility' = 'global'
    or coalesce((metadata_json->>'isGlobal')::boolean, false) = true;

create index if not exists idx_coin_save_events_place_source_created
  on coin_save_events(place_id, source, created_at desc);

create index if not exists idx_coin_save_events_user_source_created
  on coin_save_events(user_id, source, created_at desc);

create index if not exists idx_coin_transactions_wallet_type_created
  on coin_transactions(wallet_user_id, type, created_at desc)
  where wallet_user_id is not null;
