# Wandreel Handoff (LLM Quick Context)

This file is a fast onboarding note for any new LLM/engineer joining the project.

## Repo & Branch

- Repo: `https://github.com/Ashutosh902/wandreel`
- Branch: `main`
- Recent baseline commit: `b06d0f4` (location picker mode + suggestion handling improvements)

## Product Context

- Wandreel is a mobile-first PWA: **“From scroll to stroll”**
- Main tabs: `Discover`, `Map`, `Add`, `Connect`, `Login/Profile`
- Core categories: `Taste`, `Activity`, `Stay`, `Explore`
- Goal: convert saved links/reels into structured places and category-ready cards

## Tech Stack

- Frontend: React + TypeScript + Vite
- Backend API: Express (TypeScript)
- Auth/session: Postgres-backed sessions (HttpOnly cookie)
- Data pipelines:
  - Extraction: `server/extraction/*`
  - Intelligence: `server/intelligence/*`

## Must-Read Docs

1. `README.md` (global architecture, APIs, env flags, current output)
2. `src/ui/README.md` (UI module ownership + phased changes)

## Key Architecture Rules (Do Not Break)

1. Keep fixed bottom nav persistent across screens.
2. Keep mobile shell behavior:
   - Desktop: centered phone mockup
   - Mobile/PWA (`<=640px`): full-screen edge-to-edge shell
3. Bottom nav remains outside scroll containers.
4. Map surface remains non-scrollable; list pages scroll internally.
5. Avoid redesign unless explicitly requested.

## Current Important Behaviors

### 1) Location bar behavior (recent)

- `Change` opens a location picker.
- Users can search and select suggested locations.
- Selected location becomes app current location.
- Picker includes `Current location` to restore device GPS location.
- Internal mode persisted:
  - `manual` = selected location should not be auto-overwritten by GPS refresh
  - `device` = current follows device GPS

Relevant files:
- `src/ui/layout/UxProvider.tsx`
- `src/ui/home/LocationSelector.tsx`
- `src/ui/map/MapScreen.tsx`
- `server/index.ts` (`/api/location/suggest`, `/api/location/resolve-place`, `/api/location/reverse-geocode`)

### 2) Bottom sheets

- Category/map/login sheets must open cleanly with nav-safe layering.
- Sheets should not appear clipped or hidden behind bottom nav.

Relevant files:
- `src/ui/home/home.css`
- `src/ui/map/map.css`
- `src/ui/profile/profile.css`

### 3) Add flow

- Draft-first detection UX exists.
- Async final intelligence replaces draft.
- Queue persists locally until user action (save/remove).

Relevant files:
- `src/ui/home/AddScreen.tsx`
- `server/index.ts` (`/api/metadata/*`, `/api/intelligence/*`)

## API Endpoints (High-Use)

- Health: `GET /health`
- Location:
  - `GET /api/location/reverse-geocode?lat=..&lng=..`
  - `GET /api/location/suggest?q=...`
  - `GET /api/location/resolve-place?placeId=...`
- Extraction:
  - `POST /api/metadata/extract`
  - `POST /api/metadata/extract/deep-async`
  - `GET /api/metadata/jobs/:jobId`
- Intelligence:
  - `POST /api/intelligence/extract`
  - `GET /api/intelligence/jobs/:jobId`
- Auth/session:
  - `GET /api/auth/session/me`
  - `POST /api/auth/google/verify`
  - `POST /api/auth/email/request-otp`
  - `POST /api/auth/email/verify-otp`
  - `POST /api/auth/logout`
- Saved places:
  - `GET /api/saved-places`
  - `POST /api/saved-places`
  - `DELETE /api/saved-places/:placeId`

## Environment Variables

Minimum practical set:

- `GOOGLE_MAPS_API_KEY` (or `GOOGLE_PLACES_API_KEY`)
- `VITE_GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_ID`
- `DATABASE_URL`
- `CLIENT_ORIGIN`

Optional flags (see README for full):
- `EXTRACTION_V2_ENABLED`
- `INTELLIGENCE_STRUCTURED_ENABLED`
- `CATEGORY_LEVEL2_ENABLED`
- `PLACE_RESOLUTION_ENABLED`

## Runbook

```bash
npm install
npm run dev
npm run dev:api
npm run build
npm run typecheck:server
```

## Known Local Caveat

- `server/extraction/pydeps/` may exist locally with permission-locked binaries.
- Treat it as local runtime dependency cache; do not rely on it being committed.

## Working Style Requested by Project Owner

- Think long-term and scalable (millions of users).
- Keep responses concise unless asked for deep explanation.
- Before major code changes, state expected user-visible output impact.
- Keep README/docs updated per phase.

