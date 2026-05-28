# Wandreel (Phase 0)

Tagline: **From scroll to stroll**

Fresh React + TypeScript + Vite PWA baseline created for pivot planning.

## Current Output

- Branded landing screen with Wandreel name and tagline.
- Mobile opening splash appears on app open for 2.0 seconds.
- Discover bucketlist category tiles use refined image crop alignment to eliminate visible top white strip artifacts.
- Discover hero section now uses a Golghar, Patna image-backed background instead of the previous flat gradient.
- Discover top bar is compacted: wordmark/tagline removed and location pill centered between logo mark and notifications.
- Discover category tiles (`Taste`, `Activity`, `Stay`, `Explore`) now open dedicated drill-down pages while keeping bottom navigation intact.
- Category drill-down pages now include dummy highlights and sample saved places for visibility testing.
- PWA manifest and service worker registration wired (`vite-plugin-pwa`).
- Installable shell metadata configured (name/theme/start URL/display).
- Unified extraction pipeline centralized under `server/extraction`.
- Intelligence pipeline centralized under `server/intelligence`.

## Master Documentation Index

- Product and setup overview: `README.md` (this file)
- End-to-end pipeline test notebook: `server/pipeline_test.ipynb`
- UI architecture and splash policy: `src/ui/README.md`
- Home screen entry: `src/ui/home/HomeScreen.tsx`
- Home screen data/invariants: `src/ui/home/home.data.ts`
- Home screen styles: `src/ui/home/home.css`
- Map screen entry: `src/ui/map/MapScreen.tsx`
- Map data/invariants: `src/ui/map/map.data.ts`
- Map styles: `src/ui/map/map.css`
- Login/Profile screen entry: `src/ui/profile/LoginProfileScreen.tsx`
- Login/Profile styles: `src/ui/profile/profile.css`
- Deployment master guide: `deployment/README.md`
- Cloudflare setup: `deployment/cloudflare/setup.md`
- Production cutover checklist: `deployment/checklists/cutover.md`
- Deployment preflight scripts: `deployment/scripts/preflight.mjs`
- Extraction workflow: `server/extraction/README.md`
- Intelligence workflow: `server/intelligence/README.md`
- Interim database model overview: `database/README.md`
- Pinshort -> Wandreel mapping: `database/pinshort_to_wandreel_mapping.md`
- PostgreSQL v1 draft schema: `database/schema_v1.sql`

## Workflow At A Glance

1. App launch -> opening splash (`every_open`, 2000ms)
2. Share URL -> extraction (`/api/metadata/extract`)
3. Extraction output -> intelligence (`/api/intelligence/extract`)
4. Intelligence output -> preprocessing/mapping -> DB tables
5. User saves and activity tracked in user tables

## APIs

### Metadata/Extraction

- `POST /api/metadata/extract`
- body: `{ "url": "https://example.com", "mode": "quick" | "deep" }`

### Intelligence (LLM)

- `POST /api/intelligence/extract`
- body: `{ "source": <extraction_result>, "mode": "sync" | "async" }`
- sync: returns structured entities immediately
- async: returns `jobId` and status envelope

- `GET /api/intelligence/jobs/:jobId`
- returns async job status/result

## Run

```bash
npm install
npm run dev
npm run dev:api
npm run typecheck:server
npm run test:intelligence
npm run build
```
