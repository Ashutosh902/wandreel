# Personalization Engine

Owner subsystem:

- Personalization Engine

# Purpose

The Personalization Engine should convert saved places, behavior, and future context signals into a structured understanding of the user.

# Current Status

Partially implicit, not yet a standalone engine.

Today, personalization is mostly inferred through:

- saved-place counts
- category concentration
- city concentration
- simple hero-card heuristics

# Current Responsibilities

- none as a dedicated module yet

The logic is still distributed across product surfaces and early heuristics.

# Future Direction

- explicit user preference summaries
- affinity scores by category, city, and trip style
- recency and behavior weighting
- reusable signals for Hero Card, Discovery, Planner, and Recommendations

# Key Questions

- what user state should be computed eagerly versus on demand?
- how should behavior differ from saved-place inventory?
- where should personalization summaries be stored and refreshed?

