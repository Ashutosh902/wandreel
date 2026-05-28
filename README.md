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
- Discover readability pass applied: hero/bucketlist/category/recent text contrast and spacing improved without redesign.
- Recently added section now follows premium horizontal peek-carousel behavior with controlled clipping and snap scrolling.
- Final micro-polish pass completed for international-standard readability and spacing while preserving the existing visual direction.
- Taste category detail now uses a compact, nearest-first, location-aware list layout (with reusable category-detail scaffolding for future category rollouts).
- Taste category detail refinement pass: darker compact header, simplified utility copy/chips/cards, and `View map` now opens Map with Taste-only filtering context.
- Taste category screen is now list-first: hero/utility text removed, chips+`View map` prioritized, and card tap opens a bottom-sheet place preview with address, directions, and video link.
- Taste listing pass now adds in-list search, expanded food filter chips, and compact thumbnail-led rows for faster saved-restaurant scanning.
- Taste spacing polish pass improves top-stack hierarchy (search, title/action, chips, first list row) for cleaner premium readability.
- Taste micro-polish pass removes thumbnail text artifacts and tightens list row/title alignment for cleaner scan quality.
- Category list system is now unified across Taste/Activity/Stay/Explore with category-specific search, chips, themed accents, and shared bottom-sheet details.
- Add tab now implements the approved Wandreel capture UI (quick-capture header, paste-link card, branded analyze loader, detected chips, preview card, and local save feedback).
- Add tab polish pass refined paste-card spacing/alignment, improved refresh-button placement, and tightened empty detected placeholder proximity while preserving existing analyze flow.
- Map tab now includes a visual radius coverage overlay, in-range pin emphasis, and nearby count feedback linked to the distance slider.
- Map visuals were further refined toward Pinshort-style restaurant map clarity (softer base, subtler radius, clearer in-range hierarchy).
- Map top area now follows a cleaner two-row hierarchy: simplified single-line location bar and better-spaced secondary category pill row.
- Map pins now open a bottom-sheet preview with image, title, address, category-relevant details, and quick directions.
- Global shell stabilization applied: shared fixed phone frame, bottom-nav-outside-scroll architecture, internal non-map scrolling, non-scrollable map surface, and login sheet anchoring above persistent nav.
- Responsive shell split applied: desktop keeps centered rounded mock phone preview, while mobile (`<=640px`) uses full-screen edge-to-edge shell with safe-area-aware nav/content spacing.
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
