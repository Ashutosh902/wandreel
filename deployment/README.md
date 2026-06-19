# Deployment

This folder is the single source of truth for Wandreel production deployment.

## Scope

- Frontend hosting and deploys: Cloudflare via `wrangler`
- API hosting: Fly.io
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

2. Fly.io
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
3. Deploy the API to Fly and validate the generated `.fly.dev` hostname before any DNS cutover.
4. Repoint `api.wandreel.com` to the Fly backend origin through Cloudflare DNS/proxy only after validation passes.
5. Ensure Neon connection/env vars are set correctly in the backend environment.
6. Keep Neon as the external Postgres provider; do not create Fly Postgres for this app.
7. Set production env vars and CORS/cookie domain policy.
8. Set backend secrets with `fly secrets set`; do not commit secrets into the repo.
9. Ensure extraction runtime bootstrap is enabled so Python media dependencies and FFmpeg-compatible tooling are available in the container/runtime.
10. Run smoke tests before announcing release.

## Preflight Commands

- `npm run deploy:preflight`
- `npm run deploy:preflight:win`
- `npm run extract:runtime:check`

These commands fail fast when env, DNS, HTTP reachability, or CORS checks are not production-ready.

## API Deployment On Fly.io

- `fly.toml` defines the API app as `wandreel-api` in region `bom`.
- `Dockerfile` installs the Node runtime plus Python 3, `pip`, and `ffmpeg` for extraction support.
- `npm run start:prod` is the provider-neutral production entrypoint and currently matches the existing Render bootstrap.
- Keep the frontend on Cloudflare; this Fly setup is for the API only.
- Frontend API calls already use `import.meta.env.VITE_API_BASE_URL` with a localhost fallback, so local dev can keep using `http://localhost:8787` while Cloudflare builds can target Fly by setting `VITE_API_BASE_URL=https://wandreel-api.fly.dev`.
- Use `fly secrets set` for all backend secrets such as `DATABASE_URL`, OpenAI keys, Google keys, and any Instagram auth fallback tokens.
- Do not provision Fly Postgres; continue using the external Neon `DATABASE_URL`.

## Extraction Runtime

Production extraction for both YouTube and Instagram depends on Python-side media helpers that are not provided by a plain Node host.

- `server/extraction/pythonRunner.ts` now bootstraps Python packages on demand into a writable runtime directory.
- `npm run start:prod` and `npm run start:render` both prewarm the `instagram` and `media` runtime profiles during API startup, then log a single extraction runtime health record before the server begins accepting traffic.
- Bootstrap is script-specific so YouTube and Instagram only install the packages they need:
  - Instagram metadata: `instaloader`, `requests`
  - YouTube metadata/transcript: `yt-dlp`, `youtube-transcript-api`
  - Shared frame extraction: `yt-dlp`, `imageio-ffmpeg`
  - Whisper paths: `faster-whisper` on top of shared media packages
  - OCR fallback: shared media + Instagram helpers + Pillow/pytesseract
- `imageio-ffmpeg` is used as the production FFmpeg fallback when system FFmpeg is not present. Startup creates a temporary `ffmpeg` shim on `PATH` so `ffmpeg -version` succeeds even when the executable originates from the Python package rather than the base image.

Recommended Fly workflow:

- Create the app if needed: `fly apps create wandreel-api`
- Set the primary region: `fly regions set bom -a wandreel-api`
- Set secrets with `fly secrets set ... -a wandreel-api`
- Deploy after secrets are present: `fly deploy -a wandreel-api`

Recommended backend env/secrets:

- `LAYER1_AUTO_BOOTSTRAP_PYDEPS=true`
- `LAYER1_RUNTIME_PYDEPS_DIR=/tmp/wandreel-layer1-pydeps`
- `LAYER1_ALLOW_BUNDLED_PYDEPS_FALLBACK=true`

Recommended source-specific auth/runtime env:

- `INSTAGRAM_SESSIONID` for Instagram-authenticated fetch fallback when public access is weak
- `LAYER1_WHISPER_MODEL=small` or another production-safe Whisper size
- `LAYER1_WHISPER_DEVICE=cpu` unless the host is explicitly provisioned for GPU runtime

Validation steps after deploy:

- Check the Fly-issued `.fly.dev` URL first before repointing `api.wandreel.com`.
- To test the hosted frontend against Fly without changing DNS, set the frontend build env `VITE_API_BASE_URL=https://wandreel-api.fly.dev` in Cloudflare Pages for the test build only.
- `POST /api/metadata/extract` with a YouTube URL and confirm `platform: "youtube"` plus non-empty transcript or frame-debug runtime info.
- `POST /api/metadata/extract` with an Instagram URL and confirm `videoFrameCount > 0` in debug output when the reel is frame-extractable.
- `python server/extraction/scripts/check_runtime_health.py` or `npm run extract:runtime:check` on the host to verify `instaloader`, `yt_dlp`, and `imageio_ffmpeg` resolve correctly.
- Check Fly logs for `[extraction-runtime-startup]` and confirm:
  - `ytDlpAvailable: true`
  - `ytDlpVersion` is populated
  - `ffmpegAvailable: true`
  - `ffmpegVersion` is populated
  - `ffmpegCommandAvailable: true`

## Non-goals (for this phase)

- Database migration automation
- CI/CD redesign
- Queue infra rollout

## Suggested next scalable step

Evaluate whether the API should later move to a more queue-oriented or edge-adjacent architecture after schema and traffic patterns stabilize.
