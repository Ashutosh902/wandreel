# Database Operational Maturity

Wandreel remains PostgreSQL-first for transactional truth, customer history, operational correlation, and financial auditability. This layer adds cleanup, health reporting, smoke testing, and scaling visibility without introducing Redis, Kafka, sharding, or secondary databases prematurely.

## Source of truth

PostgreSQL owns:

- authenticated sessions and bounded session metadata
- customer product events and operation lifecycles
- customer-impacting and financial failure correlation
- saved places, canonical places, and source evidence
- Strolls, Stroll jobs, generation snapshots, and candidate snapshots
- wallet balances, ledger transactions, save events, and reward pools
- action-scoped location contexts

External logs or future observability tooling own:

- raw stack traces
- verbose provider request and response logs
- deployment and infrastructure logs
- high-frequency debug logs
- host-level CPU, memory, and runtime telemetry
- distributed traces and alert delivery

## Retention classes

Permanent or business-governed retention:

- `coin_transactions`
- `coin_save_events`
- `coin_reward_pools`
- canonical places and place evidence
- customer-visible saved place ownership
- immutable Stroll generation and candidate snapshots

Time-limited operational retention:

- session metadata after expiry: default `180` days
- product events: default `365` days
- resolved low-severity failures: default `365` days
- precise location context coordinates: default `30` days before anonymization
- operation input and output summaries: default `180` days before payload scrubbing

Environment overrides:

- `DB_RETENTION_AUTH_SESSION_DAYS`
- `DB_RETENTION_PRODUCT_EVENT_DAYS`
- `DB_RETENTION_RESOLVED_FAILURE_DAYS`
- `DB_RETENTION_PRECISE_LOCATION_DAYS`
- `DB_RETENTION_OPERATION_PAYLOAD_DAYS`

## Cleanup execution

Run dry-run first:

```powershell
npm run db:cleanup -- --dry-run
```

Run a specific category:

```powershell
npm run db:cleanup -- --only location --batch-size 500
```

Supported categories:

- `auth-sessions`
- `product-events`
- `failures`
- `location`
- `operation-payloads`

Location cleanup anonymizes latitude, longitude, and accuracy first, and records `anonymized_at`. It does not continuously track customers and does not delete financial or immutable Stroll records.

## Health reporting

Internal admin endpoint:

```text
GET /api/internal/database-health
```

CLI:

```powershell
npm run db:health
```

The report covers:

- migration and connection health
- wallet reconciliation and ledger mismatches
- Stroll, snapshot, and curation-job integrity
- canonical place duplication and unresolved saved places
- failed-operation and failure-event reconciliation
- stuck operations and correlation coverage
- auth session hygiene
- cleanup candidate counts
- high-growth table volume and dead-tuple estimates

## Stuck operations

Default report-only thresholds:

- `add_extraction`: 10 minutes
- `place_save`: 2 minutes
- `stroll_generation`: 15 minutes
- `stroll_context_build`: 5 minutes
- `stroll_snapshot_persistence`: 5 minutes
- `wallet_debit_reward`: 2 minutes

Override with:

- `DB_TIMEOUT_ADD_EXTRACTION_MINUTES`
- `DB_TIMEOUT_PLACE_SAVE_MINUTES`
- `DB_TIMEOUT_STROLL_GENERATION_MINUTES`
- `DB_TIMEOUT_STROLL_CONTEXT_BUILD_MINUTES`
- `DB_TIMEOUT_STROLL_SNAPSHOT_PERSISTENCE_MINUTES`
- `DB_TIMEOUT_WALLET_OPERATION_MINUTES`

This layer reports timeouts and missing failure correlation; it does not silently replay financial actions.

## Smoke testing

```powershell
npm run smoke:db-foundations
```

The smoke test uses an explicit rollback transaction so production verification does not leave stray rows behind. Set `DB_SMOKE_ALLOW_PRODUCTION=1` when running in production.

## Scaling thresholds

Watch these indicators before adding new datastores:

- sustained high dead-tuple counts on `app_usage_events`, `operation_runs`, or `failure_events`
- table or index growth that pushes hot operational tables into multi-hundred-megabyte territory
- cleanup backlog that stays non-zero across repeated runs
- repeated stuck operations or prolonged health warnings

At that point, consider partitioning, archiving, read replicas, external analytics, or cache layers based on measured pressure.

## Rollback

Rollback remains forward-fix oriented:

- additive schema from `0008` should remain in place if code is rolled back
- stop running the new scripts or endpoint consumers if necessary
- ship a forward-fix migration rather than destructive schema removal unless explicitly approved

## Rule

PostgreSQL remains Wandreel's transactional source of truth. Additional datastores should only be introduced for measured workload requirements that PostgreSQL cannot serve reliably or economically.
