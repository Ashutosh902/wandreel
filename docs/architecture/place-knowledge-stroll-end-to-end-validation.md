# Place Knowledge to Stroll End-to-End Validation

Validated on 2026-08-09/10 against the normal local API, the configured real PostgreSQL database, real Instagram sources, the durable enrichment worker, and the configured OpenAI provider. Secrets, session cookies, OTPs, and raw credentials are excluded from this report.

## Decision

The Place Knowledge architecture and its Stroll integration are ready for controlled production use. Stroll now consumes a normalized, truth-aware, quality-scored read model rather than raw extraction or evidence rows. Real runtime validation found and fixed one provider-completion defect. No schema redesign or agent framework was needed.

The remaining concrete product concern is ingestion performance and source accessibility: valid description-based identification took 2.4-14.0 seconds in this run, OCR identification took 45.4 seconds, and unresolved sources took 18.6-75.9 seconds. Save itself remained independent at 2.52-2.91 seconds, but that synchronous Save latency should still be profiled separately.

## Runtime Setup

- API: `http://127.0.0.1:8787`, normal production code path.
- Database: configured remote PostgreSQL; migrations `0000` through `0009` were present, including `0009_place_enrichment_jobs.sql`.
- Worker: durable `place_enrichment_jobs` worker with a dedicated audit lease owner so each claim/execution was observable.
- Models observed: structured enrichment `gpt-5.4-mini`; Stroll stop enrichment `gpt-5-nano`.
- Save policy: only `ready` entities with medium/high confidence were persisted. Manual-review, generic, and unresolved candidates were not forced into Save.
- Raw evidence: `tmp/final-place-knowledge-stroll-runtime.json`.
- Final persisted Stroll: `tmp/final-persisted-stroll-runtime-accepted.json`.
- Knowledge-backed Stroll proofs: `tmp/final-periyar-knowledge-stroll-runtime.json` and `tmp/final-knowledge-backed-stroll-runtime.json`.

## Implemented Contract

`loadNormalizedPlaceKnowledge` exposes current and historical claim collections above grounded facts, truth maintenance, and `knowledge_quality_v1`. Claims retain value, qualifiers, truth state, quality score/band/reason codes, support/evidence IDs, source diversity, direct/inferred grounding signals, and freshness. Stroll does not parse captions, transcripts, OCR, enrichment jobs, or raw `place_source_evidence`.

`selectPlaceKnowledgeForStroll` deterministically ranks relevant current claims using kind/category/interests/theme/time, truth state, and quality. Quality prioritizes but does not authorize: weak supported claims remain eligible. Historical claims are explicitly omitted, and selecting one side of a dispute also selects its counterpart.

Per-stop generation metadata records canonical place ID, supplied/selected/omitted claims, quality/truth/qualifiers, used and invalid claim IDs, and statement-level A/B/C grounding classifications. Category C always rejects generated place-specific copy. This metadata stays internal.

## Real-Source Results

| Source | Identification route | Identification | Save | Canonical place | Background enrichment | Normalized knowledge | Stroll result |
| --- | --- | ---: | ---: | --- | --- | --- | --- |
| `DbdLJxhxaaL` | A1 description | 13.365 s | 2.875 s | Kadhailal | `partial`, A1/A2/A3, 111 s | no supported contextual claim | accepted B-only persisted copy after fix |
| `DZHxER4ADbW` | A1/A2/A3 to manual review | 75.884 s | not saved | none | not started | none | not run |
| `DbN-fxytegJ` | A1 description | 10.137 s | 2.803 s | Ribbon & Balloon | `partial`, A1/A2/A3, 72 s | `ambience=rich and special`, usable 0.7985 | safe rejection in original run |
| `DaxnOvDRNsl` | A1 description | 14.040 s | 2.520 s | spice.ofasia | `partial`, A1/A2/A3, 131 s | no supported contextual claim | accepted B-only persisted copy after fix |
| `DZEYXA2sBqD` | A1 description | 10.330 s | 2.873 s | Metta BuddhaRam Temple | `partial`, A1/A2/A3, 110 s | no supported contextual claim | safe rejection in original run |
| `DV5m_LFEU_Q` | A1 description | 2.432 s | 2.544 s | Periyar Reserve | `partial`, adaptive ladder, 4 s | `activity=boat ride`; `operator=Cardamom County`, both strong 0.8341 | accepted A/A grounded copy |
| `DX3WMtKsPlT` | A1 OCR | 45.389 s | 2.642 s | Eva Cafe | `partial`, two background stages, 31 s | no current supported contextual claim | safe rejection in original run |
| `DXTwG1jkpBh` | A1/A2/A3 to manual review | 43.651 s | not saved | none | not started | none | not run |
| `DXWyRTOD-GW` | A1/A2/A3 to manual review | 18.635 s | not saved | none | not started | none | not run |
| `DZ4AACopZ0t` | A1 description | 10.854 s | 2.911 s | Hoskote Biryani House | `partial`, A1/A2/A3, 112 s | no current supported contextual claim | safe rejection in original run |
| `C-xouRYyyEY` | A1 description | 10.111 s | 2.591 s | Nandi Hills | `partial`, A1/A2/A3, 72 s | `activity=trekking`, usable 0.7985 | accepted A/A grounded copy |

Eight sources produced valid canonical saves. Three failed identification safely and created neither a canonical place nor a background job. Every successful Save returned `running` before its 4-131 second background work completed.

## Database Evidence

For Nandi Hills, PostgreSQL contained one canonical `places` row and one terminal `partial` job. The job was claimed once, ran three extraction-ladder stages, ended at `retry_2`, and recorded `maximum_extraction_budget_reached`. Its supported `knowledge_activities` evidence retained:

```json
{
  "kind": "activity",
  "value": "trekking",
  "truthState": "supported",
  "quality": {
    "score": 0.7985,
    "band": "usable",
    "version": "knowledge_quality_v1",
    "reasonCodes": [
      "fresh_evidence",
      "strong_provenance",
      "validated_direct_grounding",
      "exact_evidence_location",
      "single_source_only"
    ]
  },
  "support": {
    "count": 1,
    "sourceCount": 1,
    "sourceTypes": ["instagram_caption"]
  },
  "grounding": {
    "allValidated": true,
    "supportTypes": ["direct"],
    "signals": ["caption"]
  }
}
```

The persisted evidence row also had confidence `0.7`, source type `instagram_caption`, extraction version `deep_v2`, `observed_at`, `verified_at`, `expires_at`, and an evidence fingerprint. The same place retained source metadata, location metadata, Google Maps resolution, structured intelligence, grounding audit, routing audit, and source audit rows with extractor/model metadata where applicable.

The Nandi source audit correctly distinguished outcomes: caption/website/creator/location/Maps/structured intelligence contributed; transcript failed because Instagram returned empty media; OCR was attempted and returned `vision_ocr_empty`; visual was attempted and returned `no_verified_candidates`; comments timed out. Successful evidence survived all failures, making `partial` legitimate and diagnosable.

## Reuse and Multi-Source

An unchanged second save of `DbdLJxhxaaL` returned HTTP 200. Job count remained `1 -> 1`, knowledge evidence count remained `2 -> 2`, and the normalized current/historical read was byte-stable when evaluated at the same timestamp. The Save response does not expose an enrichment-reuse annotation, so the decision is proven through durable invariants rather than a response-only flag. This is an observability limitation, not a reuse failure.

No two real audited links resolved to the same canonical place. The controlled PostgreSQL quality fixture therefore remains the multi-source proof: an equivalent `recommended_item=butter garlic prawns` claim progressed from one source to three independent sources, support count `1 -> 4`, source count `1 -> 3`, and score `0.8338 -> 0.9568` without duplicate semantic claims. The normalized read-model regression also verifies independent support IDs/source types without reparsing prose.

## Stroll Proof

The real two-stop Bangalore Stroll (`Kadhailal`, `spice.ofasia`) used the normal no-preselected-stops curation path and reached `ready` in 6.232 seconds. It persisted one generation snapshot and three candidate snapshots (two selected, one omitted), including normalized read status and deterministic selection details. Both accepted stop descriptions contained only Category B generic connective copy; supplied/used claim counts were zero and accepted Category C count was zero.

The direct real-provider Periyar stop consumed two normalized claims and produced:

```text
The stop highlights a boat ride at Periyar Reserve.
Noted in the stroll knowledge claims as a boat ride organized by Cardamom County.
```

Both exact claim IDs were cited, both statements were Category A, and accepted Category C count was zero. Nandi Hills similarly cited its exact `activity=trekking` claim and produced two Category A statements. Neither path reparsed the Instagram source.

The validator regressions separately prove unsupported food facts are Category C and rejected, conditional qualifiers must be preserved, and disputed claims cannot be stated as settled truth.

## Defects Found and Fixed

1. `gpt-5-nano` consumed the former 220-token output budget entirely as reasoning and emitted no JSON. Stroll now requests minimal reasoning, allows a 600-token budget, and reports incomplete/invalid provider responses as provider failures. Real responses completed in about 1.8-2.2 seconds after the fix.
2. The model treated a model-facing canonical place ID as a claim ID when no claims were supplied. Canonical identity remains in internal attribution but is no longer sent inside compact Place Knowledge; the prompt now explicitly permits only supplied `claimId` values and requires `[]` when there are no claims.
3. Migration advisory locking used pool-level queries, allowing lock and unlock to execute on different PostgreSQL sessions. Migration execution now retains one checked-out client for the session-scoped lock lifecycle.
4. The real-PostgreSQL test included `public` in its isolated search path, allowing the production `schema_migrations` table and runtime rows to leak into test counts. The isolated test now uses only its generated schema and passes all five migration, concurrency, snapshot, immutability, and backfill cases.

A four-place Bangalore test also failed safely as `geographically_incoherent`; narrowing to the two coherent places succeeded. This was expected planner protection, not a defect.

## Verification

- Focused grounding, truth, quality, read-model, adaptive-routing, enrichment-store, Stroll selection, attribution, and snapshot tests: 72/72 passed.
- Migration regressions: 10/10 passed.
- Real PostgreSQL information-foundation tests: 5/5 passed in an isolated migrated schema.
- Server typecheck: passed.
- Production build: passed. Existing warnings remain for a large main client chunk and deprecated Vite `inlineDynamicImports` configuration.
- Lint: 0 errors, 10 existing React hook/unused-directive warnings.
- `git diff --check`: passed.
- Broad suite: 432 passed, 18 skipped, 10 failed. The failures are outside this milestone: Google-auth/session route mocks, saved-place route mocks, one auth-storage expectation, and three frontend Node test entries that access `import.meta.env`. They remain explicitly unresolved; this report does not present the entire repository suite as green.

## Readiness Assessment

- **Ingestion:** functionally safe but not uniformly fast. Eight of eleven sources resolved; inaccessible/ambiguous sources did not create junk places. Identification latency is the main observed product concern.
- **Async enrichment:** proven independent. Save returned in 2.52-2.91 seconds while background work continued for up to 131 seconds.
- **Evidence handoff:** proven by caption-derived Periyar/Nandi knowledge and OCR-derived Eva Cafe identification continuity.
- **Grounding:** supported facts retain exact evidence linkage, direct/inferred signal, confidence, provenance, and freshness.
- **Truth maintenance:** conditional, disputed, perspective, and superseded behavior remains preserved by deterministic tests and controlled PostgreSQL runtime scenarios.
- **Quality scoring:** deterministic, decomposable, versioned, and visible; it prioritizes rather than globally authorizes.
- **Read model:** downstream consumers can query typed collections without parsing raw evidence. Current versus historical claims remain distinct.
- **Stroll:** genuinely consumes selected normalized claims and records exact attribution. Real Periyar and Nandi claims changed accepted stop copy.
- **Hallucination boundary:** no Category C statement was accepted in final runtime. Unsafe outputs fail closed while generic connective copy remains allowed.
- **Schema robustness:** all supported real facts fit the existing kind/value/qualifier/relationship abstraction. No demonstrated qualifier, relationship, truth, or quality loss requires redesign.
- **Production blockers:** no Place Knowledge architecture blocker remains. Operational priorities are Instagram media access reliability and synchronous identification/Save latency profiling.

## Agentic Reassessment

Remain deterministic. The runtime exposed provider budgeting, prompt-boundary, source-access, and latency issues, none of which would be solved by an LLM routing planner, agentic research loop, or LLM conflict judge. Adaptive routing plus deterministic truth, quality, selection, and attribution currently provides the needed control and auditability.
