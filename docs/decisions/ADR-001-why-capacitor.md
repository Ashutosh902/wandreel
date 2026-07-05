# ADR-001: Why Capacitor

## Status

Accepted

## Context

Wandreel needs to ship as a web-first product while still supporting an Android app wrapper without maintaining a separate native codebase for the core experience.

## Decision

Use Capacitor as the mobile wrapper strategy for the current product phase.

## Alternatives Considered

- React Native
- fully native mobile apps
- web-only with no wrapper

## Why This Was Chosen

- preserves a single React web codebase
- fastest path to Android packaging
- aligns well with the current PWA-first product structure
- keeps frontend iteration speed high while product direction is still evolving

## Consequences

Positive:

- one shared UI implementation
- faster feature delivery
- lower early engineering overhead

Tradeoffs:

- native polish may require extra work later
- some mobile-specific behaviors must be validated carefully
- long-term native needs may still justify deeper platform investment

