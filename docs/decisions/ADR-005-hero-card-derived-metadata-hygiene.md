# ADR-005: Why Hero Card Applies Derived Metadata Hygiene

# Status

Accepted

# Context

Real-data QA on a user with 143 saved places exposed three practical problems:

- different rule families could collapse into the same `cardKey`
- alternatives could be repetitive instead of fresh
- raw `city` and `locality` metadata was noisy for direct Hero Card use

Examples from real data included:

- admin-region pseudo-cities such as `Bangalore Division`
- locality values that were really venue names
- first-item locality selection that did not represent the broader place set

The saved-place records themselves were still useful and should not be silently rewritten just to improve Hero Card output.

# Decision

Hero Card will apply small presentation-layer hygiene rules during candidate generation without mutating stored saved-place data.

This includes:

- using `rule` and `ctaAction` inside `cardKey`
- filtering admin-region city values from city-card logic
- choosing `targetLocality` from the most frequent valid locality instead of the first place
- dropping exact and semantic duplicate alternatives

# Alternatives Considered

## Trust raw metadata directly

Rejected because:

- real data produced poor city-card and locality outputs
- freshness suffered when different rules shared the same semantic identity

## Rewrite raw saved-place metadata globally

Rejected because:

- it mixes Hero Card presentation concerns with core storage concerns
- raw place data may still be valuable for debugging, future repair pipelines, or later model-based normalization

## Build a larger normalization pipeline first

Rejected for now because:

- the immediate product issue is Hero Card usefulness
- a full normalization pipeline is heavier than needed for this tuning pass

# Why This Approach Was Chosen

- fixes real user-facing Hero Card issues immediately
- preserves raw saved-place fidelity
- keeps the tuning small, testable, and reversible
- improves freshness and alternative diversity without adding new product surfaces

# Consequences

Positive:

- card identity is more stable and less collision-prone
- city cards avoid obvious admin-region mistakes
- locality summaries are more representative
- alternatives are more diverse

Tradeoffs:

- Hero Card now owns a small amount of presentation-layer metadata interpretation
- raw saved-place quality issues still exist elsewhere in the system
- future subsystems may still need a more general normalization layer

# Follow-up

Likely next steps:

- expand metadata quality rules if more real-data issues appear
- revisit whether metadata normalization should move into a shared personalization or data-cleaning layer later
- continue real-data QA on additional users before adding AI ranking
