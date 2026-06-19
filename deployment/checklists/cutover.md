# Cutover Checklist

## Pre-cutover

- [ ] `npm run build` passes.
- [ ] `npm run typecheck:server` passes.
- [ ] `npm run test:intelligence` passes.
- [ ] `npm run deploy:preflight` passes.
- [ ] Production env vars are set in hosting providers.
- [ ] Fly app is created as `wandreel-api` and secrets are set with `fly secrets set`.
- [ ] Fly `.fly.dev` URL passes `/health` and core API smoke checks.
- [ ] Confirm Neon `DATABASE_URL` is configured; do not create Fly Postgres.
- [ ] CORS allows `https://wandreel.com`.
- [ ] SSL/TLS is `Full (strict)`.

## Cutover

- [ ] Attach `wandreel.com` to Cloudflare Pages project.
- [ ] Enable `www -> apex` 301 redirect rule.
- [ ] Switch DNS if not already delegated.
- [ ] Repoint `api.wandreel.com` to Fly only after `.fly.dev` validation passes.
- [ ] Purge Cloudflare cache once.

## Post-cutover (first 30 mins)

- [ ] Validate home loads on mobile and desktop.
- [ ] Validate splash appears on fresh app open.
- [ ] Validate `POST /api/metadata/extract`.
- [ ] Validate `POST /api/intelligence/extract` sync.
- [ ] Validate async job create + fetch path.
- [ ] Watch 4xx/5xx and latency dashboards.

## Sign-off

- [ ] 0 blocker defects.
- [ ] Major flow pass rate >= 95% in smoke tests.
- [ ] Rollback owner on standby for first hour.
