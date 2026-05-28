# Intelligence Layer (Wandreel)

This folder is the single source of truth for LLM enrichment from extraction output.

## Contract

Input: extraction payload from `server/extraction`.

Output: strict structured discovery JSON with:
- `source`
- `placeCollections`
- `categoriesPresent`
- `weakMentions`
- `entities`
- `visibility`
- `status`

Supported categories are only: `eat | do | stay | see`.

## Flow

1. Build strict system + user prompts.
2. Call GPT-5 nano with structured output wrapper.
3. Validate with Zod.
4. If invalid, auto-fix deterministically:
- category alias mapping
- null/default normalization
- confidence clamping
- entity dedupe
- visibility/category cleanup
5. Revalidate.
6. If still invalid, mark `status="needs_review"` and return validation errors.

## API

- `POST /api/intelligence/extract`
  - body: `{ source: ExtractionResult, mode?: "sync" | "async" }`
  - sync: returns final output directly
  - async: returns `jobId` and status

- `GET /api/intelligence/jobs/:jobId`
  - returns job status and result/error when complete

## Preferred Testing Entry

- Use common notebook for full flow testing: `../pipeline_test.ipynb`

## Notes

- No DB persistence in this phase.
- Google Place resolution is intentionally out of scope; only `googleMapsQuery` is generated.
- Queue backend is in-memory for now via pluggable store interface.
