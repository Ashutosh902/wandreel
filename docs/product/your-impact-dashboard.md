# Your Impact Dashboard

The Wallet dashboard is community-impact reporting, not a payment or withdrawal surface.

## API contract

`GET /api/economy/impact` returns the authenticated user's current wallet, month summary, impact summary, contribution score, 30-day summary, six-month trend, top recommendations, cache metadata, and query-plan notes in one response.

The transaction history remains served by `GET /api/economy/ledger`.

## Contribution formula

The score is 0-100 and never uses wallet balance.

- Recommendations: 30 points, capped at 50 unique global recommendations.
- Community saves: 30 points, capped at 100 save-time snapshot saves.
- Recommendation quality: 20 points, capped at 5 community saves per recommendation.
- Recent activity: 20 points, capped at 20 combined recommendations and community saves in the past 30 days.

Server-side levels:

- Explorer: 0+
- Trailblazer: 20+
- Guide: 40+
- Local Expert: 60+
- City Curator: 80+
- Master Explorer: 95+

## Aggregation strategy

The endpoint ensures the wallet row, then runs one PostgreSQL CTE query over `user_saved_places`, `coin_save_events`, and `coin_transactions`.

It uses `coin_save_events.recommender_snapshot_json` as the save-time audit source, so late recommendations do not change prior community-save counts or top-recommendation rewards.

Coins saved are calculated as successful Discover saves by the user multiplied by the current external-import minus Discover-save cost delta.

## Indexes

Migration `0005_your_impact_indexes.sql` adds:

- `idx_user_saved_places_place_global_created` for global recommendation lookups by place and user.
- `idx_coin_save_events_place_source_created` for recommendation performance and trend aggregation.
- `idx_coin_save_events_user_source_created` for Discover-save savings aggregation.
- `idx_coin_transactions_wallet_type_created` for reward and spend summaries.

## Caching

Impact responses are user-specific and cacheable for 60 seconds.

The server invalidates a user's impact cache when signup grants, save charges, recommender rewards, or saved-place writes change the underlying wallet or recommendation state.
