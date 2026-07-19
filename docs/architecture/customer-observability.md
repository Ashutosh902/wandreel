# Customer Journey and Failure Observability

This layer connects authenticated sessions, meaningful product events, operation lifecycles, action-scoped location, and failures. It is a correlation layer only; feature-specific audit records such as `reel_analytics_attempts`, `stroll_curation_jobs`, Stroll snapshots, and coin ledger rows remain the source of detailed domain truth.

## Product Events

`app_usage_events` is the central product-event timeline. A product event is a meaningful customer or system-visible action, such as opening the app, viewing a screen, starting Add, submitting a link, saving a place, opening the wallet, creating a Stroll, or receiving a Stroll generation outcome.

The server validates event types. Clients may send anonymous IDs, route/source hints, outcome, duration, entity identifiers, operation IDs, and bounded metadata. The server ignores client-supplied user IDs and associates authenticated events from the session cookie.

The app intentionally does not track raw mouse movement, continuous scrolling, keystrokes, clipboard contents, full pasted URLs, or every UI interaction.

## Session Lifecycle

`auth_sessions` remains the authenticated-session identifier. It now includes `last_seen_at`, `ended_at`, `end_reason`, `client_platform`, `app_version`, and bounded `device_metadata_json`.

Session tokens are never stored in observability metadata. Only the existing token hash remains in `auth_sessions`.

## Identifier Propagation

Use these IDs together:

- `session_id`: authenticated app session from `auth_sessions.id`.
- `request_id`: per API request, accepted from `X-Request-ID` or generated server-side.
- `correlation_id`: cross-step flow ID, such as an Add client run ID or Stroll ID.
- `operation_run_id`: durable normalized parent for an important multi-step operation.

Example Add reconstruction:

```text
app_usage_events(add_flow_started/link_submitted)
-> operation_runs(add_extraction)
-> reel_analytics_runs/reel_analytics_attempts/attempt_stage_runs
-> operation_runs(place_save)
-> user_saved_places/user_place_interactions
-> operation_runs(wallet_debit_reward)
-> coin_save_events/coin_transactions
-> app_usage_events(place_save_succeeded or place_save_failed)
-> failure_events when customer-visible failure occurs
```

Example Stroll reconstruction:

```text
app_usage_events(stroll_creation_started)
-> operation_runs(stroll_creation)
-> strolls
-> app_usage_events(stroll_generation_started)
-> stroll_curation_jobs
-> operation_runs(stroll_generation)
-> operation_runs(stroll_context_build/stroll_snapshot_persistence)
-> stroll_generation_snapshots/stroll_candidate_snapshots
-> app_usage_events(stroll_generation_succeeded or stroll_generation_failed)
-> failure_events for failed jobs or shadow-mode failures
```

## Operation Lifecycle

`operation_runs` records common operation status, timing, attempts, provider/model hints, idempotency key, and small input/output summaries. It does not replace detailed feature tables.

Initial operation types include:

- `add_extraction`
- `place_save`
- `wallet_debit_reward`
- `stroll_creation`
- `stroll_generation`
- `stroll_context_build`
- `stroll_snapshot_persistence`

## Failures

`failure_events` is for customer-impacting or operationally important failures: visible save/extraction/auth/Stroll failures, exhausted retries, transaction failures, background-job failures, provider failures tied to a customer operation, and shadow-mode failures.

Noisy stack traces and high-volume runtime logs belong in hosting or external observability tooling, not PostgreSQL. Failure metadata is bounded and should be redacted.

Severity:

- `info`: notable but not harmful.
- `warning`: degraded or isolated failure.
- `error`: customer-visible failure or failed important operation.
- `critical`: financial/data integrity or broad outage risk.

Scope:

- `customer`
- `system`
- `provider`
- `background_job`
- `financial`

## Location Privacy

`user_location_contexts` captures action-scoped location only when a feature requires it. Supported sources are `device`, `manual_city`, `map_selection`, `stroll_start`, and `ip_approximate`.

Precise coordinates should be attached to feature actions such as Stroll start or explicit map selection, not generic analytics. Generic events should prefer city/locality or no location context. Device/map/Stroll precise contexts receive a short expiration timestamp by default.

## Retention

Recommended retention:

- Product events: 6-12 months.
- Session metadata: 3-6 months.
- Precise location contexts: 7-30 days, shortest practical period.
- Failure records: 6-12 months, longer only for high-severity investigations.
- Wallet and financial audit data: retain under the existing permanent ledger policy.

## PostgreSQL vs External Logs

PostgreSQL owns product-event auditability, session lifecycle, operation lifecycles, customer-visible failures, and action-scoped location. External logs own noisy stack traces, runtime diagnostics, provider raw logs, deployment logs, and high-cardinality infrastructure telemetry.
