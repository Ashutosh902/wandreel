# Pending Tasks

This file is the lightweight parking lot for future Wandreel work.

Use it for:
- ideas we want to keep
- follow-up fixes that are not urgent
- production hardening tasks
- polish items to revisit later

Suggested entry format:

## YYYY-MM-DD

- Area: short task title
  - Context: why this matters
  - Trigger: when we should pick it up
  - Notes: optional implementation hints

---

## 2026-06-02

- Infra: switch Render backend from `npm run dev:api` to a production start command
  - Context: Render is currently running the Express API through a dev-style command.
  - Trigger: next backend reliability pass.
  - Notes: add a proper production script, then update Render start command.

- Auth: verify production Google login end to end on desktop, mobile browser, and installed PWA
  - Context: production frontend/backend connection is now live.
  - Trigger: next QA pass after cache settles.
  - Notes: confirm account chooser, session persistence, logout, and relogin behavior.

- PWA: confirm installed mobile app picks up latest bundles after reinstall/update
  - Context: stale cached assets caused earlier mismatch between desktop and phone.
  - Trigger: next mobile QA pass.
  - Notes: verify Discover hero, Saved World zero state, and Login sheet behavior.

- Deploy: align deployment docs with actual production hostnames
  - Context: some deployment docs still reference `wandreel.com` where live app behavior now depends on `app.wandreel.com`.
  - Trigger: next deployment-doc cleanup pass.
  - Notes: update frontend origin, API origin, and CORS examples.
