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
6. Run smoke tests before announcing release.

## Preflight Commands

- `npm run deploy:preflight`
- `npm run deploy:preflight:win`

These commands fail fast when env, DNS, HTTP reachability, or CORS checks are not production-ready.

## Non-goals (for this phase)

- Database migration automation
- CI/CD redesign
- Queue infra rollout

## Suggested next scalable step

Move API to Cloudflare-native edge runtime (Workers + Queue + KV/R2 where needed) after schema and traffic patterns stabilize.
