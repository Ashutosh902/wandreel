# Hero Card

This document explains the current Hero Card architecture in Wandreel after V4 tuning. It is intended for an engineer who needs enough context to continue the feature without reconstructing the branch from Git history.

The Hero Card is currently a rule-based, non-AI system spanning:

- backend candidate generation and scoring
- API shaping for one selected card plus alternatives
- frontend fetch, freshness, and rendering
- CTA execution using existing navigation
- client-side saved ideas for later follow-up
- lightweight metadata hygiene for presentation only

# Vision

The Hero Card turns a large saved-place inventory into one actionable next step on the home screen.

It is not:

- a marketing banner
- an editorial promo slot
- a recommendation engine yet

It is:

- user-state-driven
- based on the user's own saved places
- designed to help the user act on what they already saved

# Evolution

## MVP

- added `GET /api/hero-card`
- returned one simple rule-based card
- rendered it above bucketlist and recently added

Why:

- prove home personalization quickly
- stay deterministic and non-AI

## V2 Scoring

- moved from first-match rules to candidate generation
- added `priorityScore`, `reasonCodes`, and richer metadata
- category-specific cards outrank generic city cards

Why:

- first-match logic was brittle
- category intent needed to beat generic geography

## CTA V1

- connected Hero Card actions to existing Home, Category, Map, and Add flows
- itinerary remained a placeholder toast

Why:

- a hero without action is not useful enough

## Freshness V1

- added client-side 24-hour cooldown in localStorage
- suppressed exact repeats for the same user

Why:

- deterministic rules created obvious repetition

## Save Idea MVP

- added a lightweight `Save idea` action on the Hero Card
- stores saved Hero Card ideas in per-user localStorage
- does not affect Hero Card ranking, freshness, or selection

Why:

- users may want to bookmark a travel idea without forcing it to stay on Home
- this is safe for PWA and Capacitor while backend persistence is still undefined

## V3 Alternatives

- backend returned selected card plus up to 3 alternatives
- backend added `cardKey`
- frontend tried alternatives if the top card was suppressed

Why:

- Freshness V1 could hide the hero entirely

## V4 Tuning

- `cardKey` now includes rule identity and CTA identity
- redundant alternatives are filtered out
- city-card logic ignores admin-region pseudo-cities such as `Bangalore Division`
- `targetLocality` uses the most frequent valid locality instead of the first matching place
- meaningful secondary-category candidates can appear as alternatives

Why:

- real-data QA showed card-key collisions
- alternatives could be repetitive instead of fresh
- raw city and locality fields were too noisy for direct hero use
- mixed-interest users needed more diverse alternatives

# Backend Architecture

## Endpoint

- `GET /api/hero-card`

Location:

- [server/index.ts](/C:/Users/ashut/OneDrive/Desktop/Study/wandreel/server/index.ts)

Behavior:

- requires auth
- loads saved places via `listSavedPlaces`
- builds scored candidates from those saved places
- returns the top card at the top level
- returns up to 3 non-redundant alternatives

The response remains backward compatible because the selected card still sits at the top level.

## Rule Engine

Core function:

- `buildHeroCardFromSavedPlaces`

Key helpers:

- `normalizeHeroField`
- `titleCaseLabel`
- `normalizeHeroComparisonValue`
- `isHeroAdminRegionCity`
- `isUsableHeroCity`
- `isVenueLikeHeroLocality`
- `pickHeroTargetLocality`
- `buildHeroCardKey`
- `buildHeroSemanticIdentity`
- `buildHeroCardMetadata`
- `buildFallbackHeroCard`

The logic is still intentionally colocated in `server/index.ts` for iteration speed.

## Candidate Generation

Current flow:

1. normalize saved places into internal hero inputs
2. group by category
3. group by hero-usable city values
4. generate eligible candidates
5. assign score, metadata, reason codes, and `cardKey`
6. sort by `priorityScore`
7. select the top card
8. remove exact and semantic duplicates from the remaining candidates
9. return up to 3 alternatives

Current candidate families:

- fallback
- Taste-heavy / food trail
- Explore-heavy / weekend route
- dominant category
- secondary category
- itinerary-ready
- dominant city

## Scoring

Current scoring intent:

- specific category intent beats generic city insight
- high-volume itinerary suggestions remain available for broad users
- meaningful secondary interests can appear as alternatives
- city cards remain lower-confidence and lower-priority

Approximate score ranges:

- Taste-heavy: `96 + confidence bump`
- Explore-heavy: `95 + confidence bump`
- dominant category: `80 + share bump`
- secondary Taste: `88 + share bump`
- secondary Explore: `87 + share bump`
- generic secondary category: `84 + share bump`
- itinerary-ready: `74 + volume bump`
- dominant city: `62 + city-share bump`
- fallback: `5` or `10`

These values are heuristic, not mathematical constants. They encode product usefulness, not statistical certainty.

## Selection

Current selection process:

1. if total saves `< 3`, return fallback and no alternatives
2. otherwise build all eligible candidates
3. sort descending by score
4. choose the top card
5. remove any remaining candidates that:
   - share the same `cardKey`
   - or are semantically redundant because they target the same category or city with the same matching place set
6. return up to 3 remaining alternatives

# Metadata Contract

Top-level response fields:

- `type`
- `cardKey`
- `title`
- `subtitle`
- `ctaLabel`
- `ctaAction`
- `priorityScore`
- `reasonCodes`
- `metadata`
- `alternatives`

Metadata fields:

- `rule`
- `targetCity`
- `targetLocality`
- `targetCategory`
- `totalSavedPlaces`
- `matchingPlaceIds`
- `queryParams`
- `reasonCodes`
- `priorityScore`

The metadata is intentionally redundant so frontend CTA execution never has to infer meaning from text copy.

# Hero Card Types

## Fallback

Triggers:

- total saves `< 3`
- or no stronger candidate exists

CTA:

- `add_first_place`
- `grow_saved_places`

## Taste-heavy

Triggers:

- top category is `Taste`
- Taste count `>= 5`

CTA:

- `build_food_trail`

## Explore-heavy

Triggers:

- top category is `Explore`
- Explore count `>= 5`

CTA:

- `plan_weekend_explore`

## Dominant Category

Triggers:

- top category exists
- count `>= 4`
- share `>= 40%`

CTA:

- `view_dominant_category`

## Secondary Category

Triggers:

- non-top category exists
- count `>= 5`
- and either count `>= 20` or share `>= 20%`

CTA:

- `build_food_trail` for Taste
- `plan_weekend_explore` for Explore
- `view_dominant_category` for other categories

Purpose:

- surface a meaningful secondary interest
- improve alternative diversity for mixed-interest users

## Itinerary-ready

Triggers:

- total saves `>= 12`

CTA:

- `create_itinerary`

## Dominant City

Triggers:

- top city exists
- city count `>= 3`
- city share `>= 45%`
- city comes only from `metadata.city`
- city passes hygiene checks and is not an admin-region pseudo-city

CTA:

- `view_city_plan`

# Rule Priority

## Why category cards beat city cards

Category cards usually imply a clearer next action.

Examples:

- many Taste saves -> build a food trail
- many Explore saves -> build a weekend route

That is more actionable than:

- many saves are in one city

## Why itinerary-ready stays available

Itinerary-ready is broad but useful for heavy savers. It gives high-volume users a way to act even when their categories are spread out.

## Why secondary-category candidates exist

Real users often have one dominant habit and one strong secondary habit. V4 allows the secondary habit to appear as an alternative instead of returning only near-duplicate Taste or city cards.

# Metadata Hygiene

Hero Card now applies small presentation-layer hygiene rules without modifying raw saved-place data.

## City hygiene

Hero Card ignores city values that look like admin regions, such as:

- `Bangalore Division`
- `Patna Division`

This affects Hero Card grouping and city-card eligibility only. It does not rewrite stored saved-place metadata.

## Locality hygiene

`targetLocality` is chosen from the most frequent valid locality among the matching places.

It is omitted when:

- no locality repeats strongly enough
- the locality looks venue-like rather than area-like
- the signal is too weak to be representative

This prevents the hero from picking an arbitrary first locality or a venue name such as a restaurant title.

# cardKey

The backend now emits the preferred semantic card identity.

Current `cardKey` inputs:

- `type`
- `rule`
- `ctaAction`
- `targetCategory`
- `targetCity`
- sorted `matchingPlaceIds`

This prevents different rule families from collapsing into one identity. For example:

- `taste_trail`
- `dominant_category`

should not share a `cardKey` even if they target the same Taste place set.

# Frontend Architecture

Frontend integration lives primarily in:

- [src/ui/home/HomeScreen.tsx](/C:/Users/ashut/OneDrive/Desktop/Study/wandreel/src/ui/home/HomeScreen.tsx)

Current flow:

1. authenticated users fetch `/api/hero-card`
2. frontend reads local freshness state
3. frontend tries the selected card first
4. if the selected card is suppressed, frontend tries alternatives in order
5. the first eligible card is rendered
6. CTA execution reuses existing Discover, Map, and Add flows
7. optional `Save idea` stores the current card payload in per-user localStorage

Freshness still remains client-side first.

Saved ideas are also client-side first. They are separate from freshness and do not feed back into selection yet.

# Current Limitations

Still intentionally not implemented:

- full candidate list in the API response
- server-side exposure tracking
- backend persistence for saved Hero Card ideas
- saved-ideas screen or management UI
- dismiss UI
- refresh UI
- cross-device freshness sync
- AI ranking
- context-aware ranking using weather, time, season, events, or proximity
- planner route beyond the current placeholder CTA

# Files Involved

Backend:

- [server/index.ts](/C:/Users/ashut/OneDrive/Desktop/Study/wandreel/server/index.ts)
  Rule engine, hygiene helpers, candidate scoring, API response shaping.

- [server/auth/postgresAuth.ts](/C:/Users/ashut/OneDrive/Desktop/Study/wandreel/server/auth/postgresAuth.ts)
  Saved-place and auth access used by the hero endpoint.

- [server/indexObservability.test.ts](/C:/Users/ashut/OneDrive/Desktop/Study/wandreel/server/indexObservability.test.ts)
  Hero-card precedence, metadata, card-key, hygiene, and alternatives coverage.

Frontend:

- [src/ui/home/HomeScreen.tsx](/C:/Users/ashut/OneDrive/Desktop/Study/wandreel/src/ui/home/HomeScreen.tsx)
  Fetch, freshness, alternative fallback, CTA execution, saved-idea localStorage.

- [src/ui/home/HeroCard.tsx](/C:/Users/ashut/OneDrive/Desktop/Study/wandreel/src/ui/home/HeroCard.tsx)
  Presentation component and lightweight `Save idea` action.

Documentation:

- [docs/api/hero-card.md](/C:/Users/ashut/OneDrive/Desktop/Study/wandreel/docs/api/hero-card.md)
- [docs/decisions/ADR-002-hero-card-scoring.md](/C:/Users/ashut/OneDrive/Desktop/Study/wandreel/docs/decisions/ADR-002-hero-card-scoring.md)
- [docs/decisions/ADR-003-hero-card-freshness-client-side.md](/C:/Users/ashut/OneDrive/Desktop/Study/wandreel/docs/decisions/ADR-003-hero-card-freshness-client-side.md)
- [docs/decisions/ADR-004-hero-card-alternatives.md](/C:/Users/ashut/OneDrive/Desktop/Study/wandreel/docs/decisions/ADR-004-hero-card-alternatives.md)
- [docs/decisions/ADR-005-hero-card-derived-metadata-hygiene.md](/C:/Users/ashut/OneDrive/Desktop/Study/wandreel/docs/decisions/ADR-005-hero-card-derived-metadata-hygiene.md)

# Decision Log

## Why Hero Card filters dirty metadata instead of mutating raw saved places

Alternatives considered:

- trust raw `city` and `locality` values directly
- rewrite stored saved-place metadata globally
- infer replacement city values aggressively

Why the current approach was chosen:

- real user data showed noisy city and locality fields
- Hero Card only needs a cleaner presentation layer
- filtering is safer than silently rewriting saved-place data

## Why alternatives are de-duplicated semantically

Alternatives considered:

- keep strict score order no matter what
- de-duplicate only exact `cardKey` collisions

Why the current approach was chosen:

- real-data QA showed near-duplicate Taste cards were not useful as alternatives
- freshness and rotation need diversity, not just multiple objects

# Practical Notes

- Start with `buildHeroCardFromSavedPlaces` if you need to extend scoring.
- Real-data QA matters here because noisy city and locality fields are hard to spot in toy fixtures.
- If you add more candidate families, update both semantic de-duplication and `cardKey` design at the same time.
