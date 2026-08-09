# Knowledge-Gap-Driven Adaptive Enrichment

Verified against the configured PostgreSQL runtime on 2026-08-09 using the real Save API, durable job table, `PlaceEnrichmentJobStore`, extraction pipeline, intelligence pipeline, and `place_source_evidence` persistence.

## Architecture

The worker reads structured canonical evidence before extraction and classifies each knowledge kind as `missing`, `weak`, `sufficient`, `stale`, or `conflicting`. The initial core kinds are:

- `best_time`
- `recommended_item`
- `crowd_note`
- `seating_tip`
- `pricing`
- `parking`
- `ambience`

Unknown structured kinds found in evidence are retained in the assessment, so coverage is not limited to this initial list.

The deterministic capability map assigns costs and realistic knowledge targets to caption, transcript, OCR, visual, comments, and web-signal actions. The planner selects low-cost actions for narrow gaps, uses broad A1 exploration for an empty place, and retains A2/A3 as deeper execution infrastructure when relevant gaps remain.

Stop reasons currently include:

- `relevant_knowledge_coverage_sufficient`
- `current_source_has_no_useful_capability_for_remaining_gaps`
- `maximum_extraction_budget_reached`

Every normal job writes `enrichment_routing_audit` evidence containing initial/final coverage, identified and remaining gaps, considered/selected/skipped actions, facts added, attempt decisions, stop reason, and estimated work avoided. Jobs that stop before extraction also write this audit with `attemptsRun: 0`.

## Runtime Proof

Controlled sources used isolated URLs under `http://lvh.me:4317/adaptive-1786296798324/source-*`. Canonical place: `f86de08f-051b-4716-ab6c-5e07690fa0d4`.

| Scenario | Save latency | Initial decision | Runtime result | Stop reason |
| --- | ---: | --- | --- | --- |
| Empty/weak place | 2721 ms | All seven kinds missing; caption, transcript, OCR, visual selected | A1, A2, A3 ran; six kinds gained; parking remained | `maximum_extraction_budget_reached` |
| Rich place, parking missing | 2653 ms | Only parking missing; caption selected | One attempt; transcript/OCR/visual all recorded `attempted: false`; parking added | `relevant_knowledge_coverage_sufficient` |
| No useful gap | 2625 ms | All seven kinds sufficient | Zero extraction attempts; full ladder and three estimated model calls avoided | `relevant_knowledge_coverage_sufficient` |
| Stale pricing | 2559 ms | Pricing classified `stale`; caption selected | One attempt; transcript/OCR/visual all recorded `attempted: false`; fresh pricing added | `relevant_knowledge_coverage_sufficient` |

The targeted and stale scenarios each avoided two ladder attempts, five extraction stages, and one estimated model call. The no-gap scenario avoided all six considered stages and the full ladder.

Persisted structured facts included `best_time=5 PM`, `recommended_item=the butter garlic prawns`, `crowd_note=weekends gets crowded`, `seating_tip=upstairs`, `ambience=cozy`, `pricing=Rs 700`, `parking=difficult`, and refreshed `pricing=for mains is Rs 850`, with confidence, source URL, and expiry retained.

## Verification Commands

```powershell
npm run typecheck:server
npx tsx --test server\placeEnrichment\adaptiveRouting.test.ts server\placeEnrichment\facts.test.ts server\placeEnrichment\store.test.ts server\extraction\tests\ladderRouting.test.ts
npx tsx tmp\verify-adaptive-enrichment-runtime.ts
```

The runtime verifier uses local-only lease settings to prevent another deployed worker connected to the shared database from claiming controlled jobs. This does not change normal queue behavior. It atomically reserves the API-created durable row and executes it through the real worker implementation.

## Limitations

- Capability mappings are deterministic heuristics and should evolve from observed contribution rates.
- Cost values are relative estimates, not provider billing amounts.
- Conflict detection is intentionally conservative but still compares normalized values rather than domain-specific equivalence, such as overlapping time windows.
- Broad A1 still preserves the current extraction mechanics; finer action-level controls can be added when there is runtime evidence that their additional complexity saves meaningful cost.
