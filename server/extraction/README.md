# Extraction Pipeline (Wandreel)

This folder is the single source of truth for all link-extraction logic.

## What happens when a link is captured

1. Request enters `POST /api/metadata/extract` with `{ url, mode }`.
2. URL is canonicalized (`url.ts`) and blocked if unsafe/private.
3. Platform is detected (`youtube`, `instagram`, `web`).
4. Metadata extraction runs (`metadata.ts`):
- YouTube: try `scripts/fetch_youtube_metadata.py`
- Instagram: try `scripts/fetch_instagram_metadata.py`
- Fallback: fetch HTML and parse OG/title/description
5. If mode is `quick`, pipeline returns immediately with metadata.
6. If mode is `deep`, enrichment runs conditionally:
- Transcript (`transcript.ts`): YouTube captions -> Whisper fallback
- OCR (`ocr.ts`): frame text extraction for video/social links
7. Unified JSON response is returned.

## Extraction v2 contract

When `EXTRACTION_V2_ENABLED=true` (default), response also includes:
- `source`, `platform`, `canonicalUrl`
- `stageStatus` and `stages` for `basicMetadata`, `caption`, `transcript`, `ocr`
- `stageTimingsMs` and `stageFailures`
- `combinedTextRaw`, `combinedTextClean`, `cleanupStats`
- `sla` (same numbers as `perf`, maintained for compatibility)

Stage status semantics:
- `success`: stage produced expected output
- `partial`: stage ran but returned low/no signal
- `failed`: stage skipped/unsupported or failed hard

## Preferred Testing Entry

- Use common notebook for full pipeline testing: `../pipeline_test.ipynb`

## Folder map

- `pipeline.ts`: orchestrates quick/deep flow.
- `metadata.ts`: metadata extraction entrypoint and provider fallbacks.
- `transcript.ts`: speech-text enrichment hook.
- `ocr.ts`: frame OCR enrichment hook.
- `pythonRunner.ts`: safe Python script execution wrapper.
- `url.ts`: URL canonicalization, platform detection, host safety checks.
- `types.ts`: shared contracts used by all extraction steps.
- `scripts/`: migrated Pinshort extraction scripts.

## Why this structure scales

- One pipeline contract for API, jobs, and workers.
- Provider-specific extraction is isolated; easy to swap implementations.
- Conditional deep steps keep average latency and compute cost lower.
- Canonical URL enables future dedupe and cache keys.
- Stage-level SLA fields enable p50/p95 observability without changing consumer contracts.
