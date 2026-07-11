# Wandreel Database (Interim XLSX Model)

This folder holds interim table-like storage using Excel sheets until a full DB is introduced.

## Postgres migrations

Postgres schema changes use ordered SQL files in `database/migrations`.

- Production startup applies migrations through `server/db/migrations.ts`; migrations are the live schema source of truth.
- `server/auth/postgresAuth.ts#ensureAuthSchema()` remains as a legacy compatibility/test helper, but normal startup no longer uses it to create operational tables.
- `0000_operational_baseline.sql` captures the previously runtime-owned operational auth, saved-place, observability, and reel job tables.
- Applied migrations are recorded in `schema_migrations` with SHA-256 checksums.
- The migration runner uses a Postgres advisory lock so only one process applies migrations at a time.
- Existing rows without checksums are backfilled on first run; changed SQL for an already-checksummed migration fails fast and should be handled by a new forward-fix migration.
- New tables, indexes, constraints, and columns must be added through migrations, not by expanding runtime bootstrap code.
- `database/schema_v1.sql` is retained as an older planning/reference contract, not the live production source of truth.

Rollback default is code-only: leave already-applied additive tables/columns dormant and ship a forward-fix migration if needed. Destructive rollback, such as dropping tables or deleting `schema_migrations` rows, requires explicit approval.

## File

- `wandreel_data_model.xlsx`

## Table groups

### User-specific tables
- `users_master`
- `user_preferences`
- `user_saved_items`
- `user_activity_events`

### Pipeline raw (before preprocessing)
- `source_links_raw`
- `extraction_raw`
- `intelligence_raw`

### Master tables
- `locations_master`
- `collections_master`
- `entities_master`

### Processed (after preprocessing)
- `entities_preprocessed`
- `source_category_map`
- `source_entity_map`

### Operations/monitoring
- `pipeline_jobs`
- `pipeline_metrics_daily`

## Raw -> Processed flow
1. New link enters `source_links_raw`.
2. Extraction outputs are stored in `extraction_raw`.
3. Intelligence raw outputs are stored in `intelligence_raw`.
4. Preprocessing normalizes entities into `entities_preprocessed`.
5. Entity/category mappings are built via `source_entity_map` and `source_category_map`.
6. Master dimensions (`locations_master`, `entities_master`, `collections_master`) are updated.

## Notes
- This is temporary modeling for fast iteration.
- IDs are string-based placeholders; move to UUID/DB constraints in next phase.
- Keep this workbook as a contract reference when moving to PostgreSQL.

## Auth integration (current phase)

The app now uses Postgres as canonical auth identity store, while XLSX OTP/user tables remain transitional for legacy phone flow until full cutover.

- Canonical (Postgres): `users`, `auth_sessions`, `auth_email_otps`
- Transitional (XLSX): `users.xlsx`, `auth_otp.xlsx` for legacy phone OTP only

Current API flow:

1. `POST /api/auth/phone/request-otp` (transitional)
   - validates 10-digit phone
   - appends OTP row to `auth_otp.xlsx`
   - creates user row in `users.xlsx` if missing
2. `POST /api/auth/phone/verify-otp` (transitional)
   - checks latest unconsumed phone OTP
   - marks OTP verified/consumed
   - resolves user identity from `users.xlsx`
3. `POST /api/auth/google/verify`
   - verifies Google token/profile
   - creates/reuses user in Postgres by verified email
   - issues HttpOnly session cookie

4. `POST /api/auth/email/request-otp`
   - creates email OTP challenge in Postgres

5. `POST /api/auth/email/verify-otp`
   - verifies OTP, creates/reuses user by verified email
   - issues HttpOnly session cookie

6. `GET /api/auth/session/me`
   - resolves current authenticated user from server session

This keeps identity safe/scalable while allowing a low-risk phased migration off XLSX.
