# Stroll Information Foundation

Owner subsystem:

- Stroll planning and place intelligence

# Purpose

The Stroll information foundation separates four kinds of information that used to be blended together through `user_saved_places`:

- Global knowledge: canonical place identity and facts that can be shared across users.
- Customer memory: durable user-place events such as saved, unsaved, selected for a stroll, and visited.
- Request context: the temporary intent for one Stroll generation attempt.
- Snapshots: immutable records of what Wandreel considered and why it made a specific generation decision.

The first rollout keeps `deterministic_saved_places_v1` as the customer-visible curation source. The new builder runs in shadow mode and writes audit data for comparison.

# Database Model

The foundation migration creates:

- `places`: canonical global place identity.
- `place_source_evidence`: append-only evidence for facts, source records, confidence, freshness, and extraction versions.
- `user_place_interactions`: durable customer-place memory events.
- `stroll_generation_snapshots`: one immutable row per generation attempt.
- `stroll_candidate_snapshots`: one immutable row per considered candidate.

Compatibility note: `user_saved_places.place_id` already existed as a legacy text/external identifier. To avoid a destructive migration, the canonical FK is `user_saved_places.canonical_place_id`. Existing saved-place columns remain intact.

# Canonical Resolution

Saved places resolve to `places` in this order:

1. Google Place ID.
2. Reliable external source identifier from source metadata.
3. Normalized name and nearby coordinates.
4. Normalized name and city/locality.
5. New canonical place creation.

The resolver uses transaction-scoped advisory locking around the resolution key and unique indexes for strong identifiers. Ambiguous matches return an ambiguous result instead of being auto-merged.

# Evidence

Evidence rows preserve:

- fact type and value;
- source type;
- source URL or source record ID;
- confidence;
- observed time;
- optional expiration;
- extraction and intelligence versions;
- original payload.

Evidence is inserted with a deterministic fingerprint. New evidence does not overwrite historical evidence.

# Customer Memory

`user_place_interactions` stores raw durable events. The initial supported interaction types are:

- `saved`
- `unsaved`
- `viewed`
- `selected_for_stroll`
- `removed_from_stroll`
- `swapped_in`
- `swapped_out`
- `accepted_stroll`
- `visited`

No derived taste profile is created in this phase.

# Context Builder

`buildStrollContext()` is internal. It gathers the Stroll request, saved places, canonical identities, recent user-place interactions, shared/global candidates, source evidence summaries, freshness, deterministic scoring inputs, and candidate eligibility decisions.

The returned context is normalized and versioned with `stroll_context_v1`; it is not a raw database-row dump.

# Candidate Decisions

Hard filters are stored separately from ranking factors. Candidate snapshots can record these exclusion reasons:

- `MISSING_COORDINATES`
- `WRONG_CITY`
- `DUPLICATE_PLACE`
- `GEOGRAPHIC_OUTLIER`
- `INSUFFICIENT_EVIDENCE`
- `EXPLICITLY_EXCLUDED`
- `ALREADY_SELECTED`
- `PLACE_UNAVAILABLE`

The deterministic ranking factors preserved from the existing curation are:

- interest
- category
- geography
- metadata quality
- confidence

# Shadow Mode

During saved-place Stroll generation, the visible `stroll_stops` are still written by `deterministic_saved_places_v1`. After that transaction commits, the shadow builder runs in a separate transaction.

Shadow failures are logged as `stroll_context_shadow_failed` and do not break Stroll creation. Diagnostics include candidate overlap, selected-place overlap, canonical resolution rate, excluded-candidate counts, missing/stale evidence, builder duration, and snapshot persistence failures.

# Migration And Rollback

The migration is additive. Rollback for application behavior is disabling shadow mode with:

```text
STROLL_CONTEXT_SHADOW_ENABLED=false
```

Because the new tables are not yet customer-visible sources, disabling shadow mode preserves current production behavior. Historical snapshot and evidence rows should remain immutable; corrections should be made through later compensating records rather than updates.

# Backfill

Existing saved places can be backfilled with:

```text
npx tsx scripts/backfill-stroll-information-foundation.ts --batch-size=100
```

Use `--loop` to continue until the current backlog is exhausted. The command runs migrations first, locks a batch with `for update skip locked`, resolves or creates canonical places, writes evidence, updates `canonical_place_id`, and prints resolved/created/skipped/ambiguous/failed counts.

# Real PostgreSQL Validation

The real database test is opt-in:

```text
STROLL_INFO_REAL_PG=1 npm run test:stroll-info:real-pg
```

It creates an isolated schema, runs the production migrations from a clean state, and verifies table creation, concurrent canonical resolution, shadow snapshot persistence, snapshot immutability, and backfill idempotency.

# Path To Primary Curation

The direct `user_saved_places` curation path should only be replaced after shadow metrics prove that canonical resolution coverage, evidence freshness, selected-place overlap, and generation latency are stable. AI ranking, embeddings, dedicated hours tables, weather providers, and derived taste models remain out of scope for this phase.
