# Deployment (Cloudflare)

This folder is the single source of truth for Wandreel production deployment on Cloudflare.

## Scope

- Frontend hosting: Cloudflare Pages
- API hosting: Cloudflare-compatible origin (current Node API) behind Cloudflare DNS/proxy
- Domain: `wandreel.com` with `www -> wandreel.com` redirect
- SSL/TLS: Full (strict)

## Docs Index

- Cloudflare setup: `cloudflare/setup.md`
- Production env template: `cloudflare/env.production.example`
- Cutover checklist: `checklists/cutover.md`
- Smoke tests: `checklists/smoke-tests.md`
- Rollback checklist: `checklists/rollback.md`
- Preflight scripts: `scripts/preflight.mjs`, `scripts/run-preflight.ps1`

## Deployment Strategy

1. Configure DNS + SSL + redirects in Cloudflare.
2. Deploy frontend to Pages and bind custom domain.
3. Route API subdomain (`api.wandreel.com`) to backend origin.
4. Set production env vars and CORS/cookie domain policy.
5. Run smoke tests before announcing release.

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
