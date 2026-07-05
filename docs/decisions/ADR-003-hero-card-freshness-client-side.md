# ADR-003: Why Hero Card Freshness Is Client-Side First

## Status

Accepted

## Context

Once Hero Card scoring became deterministic, users could repeatedly see the exact same card. The product needed a quick freshness guard before building server-side exposure tracking, candidate rotation, or dismiss flows.

## Decision

Implement Hero Card freshness first on the client using user-scoped localStorage and a 24-hour cooldown for exact repeats.

## Alternatives Considered

- server-side exposure tracking first
- database-persisted suppression state
- cross-device synced freshness state
- no freshness until multiple candidates are returned

## Why This Was Chosen

- minimal implementation cost
- no backend schema changes
- no new API contract required
- safe for both PWA and Capacitor Android
- enough to reduce obvious exact-repeat fatigue immediately

## Consequences

Positive:

- fast to ship
- low risk
- easy to replace later

Tradeoffs:

- freshness is device-local, not cross-device
- backend does not know what was actually shown
- exact-repeat suppression can hide the hero entirely if no alternative candidate is available

