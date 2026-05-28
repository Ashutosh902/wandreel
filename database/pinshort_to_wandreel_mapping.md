# Pinshort -> Wandreel Table Mapping (v1)

## User/Auth
- `customer_info` -> `users`
- `auth_otp` -> `auth_otp`
- `auth_journey_events` -> `auth_journey_events`
- (new) `user_preferences` retained as dedicated table in Wandreel

## User behavior
- `user_activity_events` -> `user_activity_events`
- `customer_hist` -> `user_source_submissions` + pipeline history tables
- `user_saved_pins` -> `user_saved_items`

## Source cache + enrichment
- `url_source_cache` -> `sources`
- `url_transcript_cache` -> `extraction_outputs_raw` (transcript segment) + stage history
- `url_category_enrichment` -> `intelligence_outputs_raw` + processed link tables
- `enrichment_ingredients` -> `source_entities.details_json`/tags (entity-specific, no recipe-specific table in Wandreel)

## Category/validation control
- `user_url_category_resolution` -> `source_categories` + `source_visibility_views` + future user-override table
- `category_validation_events` -> `intelligence_outputs_raw` + analytics stream
- `category_validation_feedback` -> future `user_feedback_events` (not in v1 SQL)
- `customer_validation_metrics` -> `pipeline_metrics_daily` + analytics warehouse

## Worker/job orchestration
- `category_worker_jobs` + `process_url_jobs` -> `pipeline_runs` + `pipeline_stage_runs`

## New Wandreel master model
- `locations_master`
- `collections_master`
- `entities_master`
- `source_entities`
- `source_categories`
- `source_visibility_views`

## Notes
- Password is always stored as `password_hash` only.
- Keep raw stage outputs versioned (immutable), never overwrite prior run payloads.
- Use `source_id` + `run_id` as lineage spine for end-to-end auditability.
