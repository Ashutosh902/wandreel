# ADR-002: Why Hero Card Uses Scoring Instead of Ordered Rules

## Status

Accepted

## Context

The first Hero Card MVP used simple ordered rule matching. That made implementation fast, but it created a major weakness: generic city cards could suppress more specific and useful category opportunities.

## Decision

Use candidate generation plus heuristic scoring instead of a pure ordered rule chain.

## Alternatives Considered

- keep ordered `if/else` rules only
- keep first-match logic but hand-tune rule order further
- jump directly to AI ranking

## Why This Was Chosen

- candidate scoring better expresses product intent
- category-specific cards can consistently outrank generic city cards
- internal candidates are a necessary prerequisite for future rotation
- still easy to understand and test without AI

## Consequences

Positive:

- more flexible prioritization
- clearer product semantics
- easier path to future rotation and ranking

Tradeoffs:

- still deterministic unless freshness/rotation is added
- scores are heuristic and require tuning
- candidate generation currently lives inside `server/index.ts` and should likely be extracted later

