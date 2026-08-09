# Async Place Enrichment

## Architecture review

What already exists:

- Fast save path through `POST /api/saved-places`.
- Canonical place graph foundation via `places`, `place_source_evidence`, and `canonical_place_id` on `user_saved_places`.
- Durable pipeline lineage through extraction/intelligence attempt tables.
- Existing deep extraction and intelligence pipelines that already produce transcript, OCR, comment evidence, visual candidates, and structured entities.

What is reused:

- `resolveCanonicalPlace()` and `writePlaceEvidence()` from the Stroll information foundation.
- `runExtractionPipeline({ mode: "deep" })` for background transcript/OCR/visual work.
- `runIntelligencePipeline()` for structured place/entity signals.
- Existing `place_source_evidence` as the long-lived, append-only knowledge substrate.

What changed:

- Save now resolves or creates a canonical place immediately after persistence and writes seed evidence without blocking on deep enrichment.
- Save now enqueues a durable `place_enrichment_jobs` background job keyed by canonical place plus source.
- Background enrichment merges transcript, OCR, comment signals, structured entities, and classified place knowledge facts into `place_source_evidence`.
- Non-production debug endpoints allow developers to inspect job state and grouped place knowledge.

What remains untouched:

- User-visible save UX stays immediate.
- Extraction and intelligence APIs remain unchanged for callers.
- Duplicate saved-place protection for the same user still happens before enqueue.

## Schema review

The existing schema already had the right long-lived knowledge store:

- `places` provides canonical place identity.
- `place_source_evidence` already supports typed facts, source provenance, confidence, version stamps, and idempotent fingerprints.

Because of that, no new "big place knowledge table" was needed. The only required schema addition was `place_enrichment_jobs`, which tracks internal async status, retries, leasing, and result summaries.

This design is future-proof because new enrichment categories only require new `fact_type` values inside `place_source_evidence`, not a migration every time a new knowledge class is introduced.

## Phase 2 audit

This phase hardened the canonical graph around six guarantees.

### 1. Confidence scoring

Every enrichment fact now carries both:

- normalized numeric confidence in `place_source_evidence.confidence`
- fact-level confidence metadata inside `fact_value_json`

Examples:

- transcript-backed facts typically land around `0.9`
- OCR-only facts are lower by default
- structured entity and visual resolution signals preserve their own confidence levels

### 2. Provenance

Every enrichment fact now records where it came from through:

- `source_type`
- `source_url`
- `source_record_id`
- fact-level `provenance` inside `fact_value_json`

This supports source-specific trust and future debugging.

### 3. Versioning

Every background enrichment write now carries:

- `extraction_version`
- `intelligence_version`
- fact-level provenance metadata for the model/extractor

This lets future re-enrichment compare old and new model generations instead of blindly replacing history.

### 4. Merge-only incremental enrichment

The graph is append-only at the evidence level.

- evidence fingerprints are deterministic
- writes use `on conflict do nothing`
- reruns add missing evidence but do not replace prior evidence rows

That means transcript, OCR, comments, visual reasoning, and future re-runs all merge into the same place graph.

### 5. Freshness and re-verification

The evidence table already supported freshness through:

- `observed_at`
- `verified_at`
- `expires_at`

This phase started populating those fields explicitly for background enrichment.

Current policy:

- volatile operational facts such as timing, transport, practical info, and comments get shorter staleness windows
- identity/location/resolution facts get longer windows
- the exact source audit snapshot also expires, making it easy to re-check source coverage later

### 6. Extraction-source coverage

Background enrichment now emits explicit evidence or audit coverage for:

- caption
- transcript
- OCR
- frame vision
- comments
- creator metadata
- location metadata
- structured intelligence
- Google Maps resolution
- website/source-page context

Coverage is persisted as an `enrichment_source_audit` evidence row per job.

## Fast path

Fast path work on save is now limited to:

1. Validate and persist the save.
2. Resolve or create the canonical place.
3. Persist seed evidence.
4. Enqueue background enrichment.
5. Return success.

Transcript, OCR, deep extraction, and richer context classification happen after the response.

## Background workflow

1. Claim the next `place_enrichment_jobs` record.
2. Run deep extraction for the saved source URL when available.
3. Run intelligence on the extracted source.
4. Classify reusable place facts from transcript, caption, OCR, comments, visual clues, and intelligence output.
5. Merge all resulting evidence into `place_source_evidence`.
6. Mark the job `completed`, `partial`, or `failed`.

## Idempotency and retries

- Jobs are deduped by canonical place plus source fingerprint.
- Evidence writes use `place_source_evidence` fingerprints and `on conflict do nothing`.
- Failed jobs are retried through `next_retry_at`.
- Partial is used for metadata-only completion, such as missing source URLs.

## Merge strategy

Knowledge is cumulative, not replace-all:

- each structured fact is appended as independently fingerprinted evidence
- reruns only add genuinely new facts
- better future sources or models can add new evidence without deleting prior evidence

The graph intentionally follows this layering:

1. Place identity
2. Evidence rows
3. Reusable structured facts
4. Future derived summaries or embeddings

UI summaries should remain a downstream projection, not the canonical store.

## Source coverage matrix

Current canonical graph contribution path:

- Instagram or website caption/description: `source_caption`
- Transcript: `transcript`
- OCR: `ocr_text`
- Frame vision / visual candidate: `visual_candidate`
- Comments and creator replies: `comment_signal`
- Creator/source metadata: `source_metadata`
- Location metadata and coordinates: `location_metadata`
- Structured intelligence output: `structured_entity_signal`
- Google Maps or place-resolution signal: `place_resolution`
- Coverage diagnostics for the job: `enrichment_source_audit`

## Verification

Developer verification options:

- inspect `place_enrichment_jobs`
- inspect `place_source_evidence`
- call `GET /api/debug/place-enrichment/jobs/:jobId` in non-production
- call `GET /api/debug/places/:placeId/knowledge` in non-production
- inspect `enrichment_source_audit` rows to confirm source-by-source coverage

Validated in this change:

- migration manifest and schema
- knowledge fact classification
- durable enqueue plus canonical-place resolution
- server typecheck
- production build
