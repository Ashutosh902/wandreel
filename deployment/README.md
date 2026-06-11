# Deployment

This folder is the single source of truth for Wandreel production deployment.

## Scope

- Frontend hosting and deploys: Cloudflare via `wrangler`
- API hosting: Render
- Database: Neon Postgres
- Frontend app domain: `app.wandreel.com`
- Public API domain: `api.wandreel.com`
- Apex/web redirects and DNS: Cloudflare
- SSL/TLS: Full (strict)

## Actual Deployment Stack

Wandreel currently depends on these services in production:

1. Cloudflare + `wrangler`
   - frontend asset deploy
   - custom domains
   - DNS/proxy
   - SSL/TLS

2. Render
   - Node/Express API hosting
   - origin behind `api.wandreel.com`

3. Neon
   - Postgres database

4. External service dependencies
   - Google: login and Maps/Places APIs
   - OpenAI: extraction/intelligence APIs

## Docs Index

- Cloudflare setup: `cloudflare/setup.md`
- Production env template: `cloudflare/env.production.example`
- Cutover checklist: `checklists/cutover.md`
- Smoke tests: `checklists/smoke-tests.md`
- Rollback checklist: `checklists/rollback.md`
- Preflight scripts: `scripts/preflight.mjs`, `scripts/run-preflight.ps1`

## Deployment Strategy

1. Deploy frontend with `wrangler` / Cloudflare.
2. Point `app.wandreel.com` to the frontend deployment in Cloudflare.
3. Keep `api.wandreel.com` routed to the Render backend origin through Cloudflare DNS/proxy.
4. Ensure Neon connection/env vars are set correctly in the backend environment.
5. Set production env vars and CORS/cookie domain policy.
6. Ensure extraction runtime bootstrap is enabled for Render so Python media dependencies and FFmpeg-compatible tooling are installed on demand.
6. Run smoke tests before announcing release.

## Preflight Commands

- `npm run deploy:preflight`
- `npm run deploy:preflight:win`
- `npm run extract:runtime:check`

These commands fail fast when env, DNS, HTTP reachability, or CORS checks are not production-ready.

## Extraction Runtime On Render

Production extraction for both YouTube and Instagram depends on Python-side media helpers that are not provided by a plain Node host.

- `server/extraction/pythonRunner.ts` now bootstraps Python packages on demand into a writable runtime directory.
- Bootstrap is script-specific so YouTube and Instagram only install the packages they need:
  - Instagram metadata: `instaloader`, `requests`
  - YouTube metadata/transcript: `yt-dlp`, `youtube-transcript-api`
  - Shared frame extraction: `yt-dlp`, `imageio-ffmpeg`
  - Whisper paths: `faster-whisper` on top of shared media packages
  - OCR fallback: shared media + Instagram helpers + Pillow/pytesseract
- `imageio-ffmpeg` is used as the production FFmpeg fallback when system FFmpeg is not present.

Recommended Render backend env:

- `LAYER1_AUTO_BOOTSTRAP_PYDEPS=true`
- `LAYER1_RUNTIME_PYDEPS_DIR=/tmp/wandreel-layer1-pydeps`
- `LAYER1_ALLOW_BUNDLED_PYDEPS_FALLBACK=true`

Recommended source-specific auth/runtime env:

- `INSTAGRAM_SESSIONID` for Instagram-authenticated fetch fallback when public access is weak
- `LAYER1_WHISPER_MODEL=small` or another production-safe Whisper size
- `LAYER1_WHISPER_DEVICE=cpu` unless the host is explicitly provisioned for GPU runtime

Validation steps after deploy:

- `POST /api/metadata/extract` with a YouTube URL and confirm `platform: "youtube"` plus non-empty transcript or frame-debug runtime info.
- `POST /api/metadata/extract` with an Instagram URL and confirm `videoFrameCount > 0` in debug output when the reel is frame-extractable.
- `python server/extraction/scripts/check_runtime_health.py` or `npm run extract:runtime:check` on the host to verify `instaloader`, `yt_dlp`, and `imageio_ffmpeg` resolve correctly.

## Non-goals (for this phase)

- Database migration automation
- CI/CD redesign
- Queue infra rollout

## Suggested next scalable step

Move API to Cloudflare-native edge runtime (Workers + Queue + KV/R2 where needed) after schema and traffic patterns stabilize.
