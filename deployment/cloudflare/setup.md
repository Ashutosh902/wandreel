# Cloudflare Setup

## 1) Domain and DNS

- Add `wandreel.com` zone in Cloudflare.
- Keep nameservers fully delegated to Cloudflare.
- Records:
  - `@` -> frontend (Pages custom domain)
  - `www` -> redirect to `https://wandreel.com`
  - `api` -> backend origin (proxied orange cloud)

## 2) SSL/TLS

- SSL/TLS mode: `Full (strict)`
- Enable Always Use HTTPS.
- Enable Automatic HTTPS Rewrites.

## 3) Redirect Rules

Create a redirect rule:
- If host is `www.wandreel.com`
- Redirect to `https://wandreel.com${uri}`
- Status: `301`

## 4) Pages Project

- Build command: `npm run build`
- Output directory: `dist`
- Node version: `20+`
- Connect repo branch (main/prod branch)
- Frontend API target is controlled by the build env var `VITE_API_BASE_URL`.
- For Fly backend validation before DNS cutover, set `VITE_API_BASE_URL=https://wandreel-api.fly.dev`.
- After `api.wandreel.com` is repointed, switch `VITE_API_BASE_URL` back to `https://api.wandreel.com`.

## 5) API Route

- Public API base: `https://api.wandreel.com`
- Ensure backend accepts origin `https://wandreel.com`
- Optional: allow `https://www.wandreel.com` temporarily during migration

## 6) Caching/Security

- Cache static assets aggressively (`dist/assets/*`).
- Do not cache dynamic API responses by default.
- Add WAF baseline protections for `/api/*`.

## 7) Observability

- Enable Cloudflare analytics.
- Enable request logs at origin/load balancer.
- Track 4xx/5xx per endpoint:
  - `/api/metadata/extract`
  - `/api/intelligence/extract`
  - `/api/intelligence/jobs/:jobId`
