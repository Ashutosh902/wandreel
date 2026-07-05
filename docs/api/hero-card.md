# Hero Card API

This document describes the current Hero Card API contract after V4 tuning.

# Endpoint

- `GET /api/hero-card`

# Authentication

- requires an authenticated user session
- uses the logged-in user's saved places as input

# Current Behavior

The endpoint:

- loads the user's saved places
- builds internal hero candidates
- scores them
- returns the single selected final card
- returns up to 3 alternatives after the selected card
- filters dirty city values for hero logic only
- removes exact and semantic duplicate alternatives before returning them

The API does not expose the full internal candidate list. It returns the selected card plus a small ordered alternatives array for freshness and lightweight rotation.

Saved Hero Card ideas are currently a frontend-only MVP. The API does not persist or return them.

# Response Shape

```json
{
  "type": "city_category_insight",
  "cardKey": "{\"type\":\"city_category_insight\",\"rule\":\"taste_trail\",\"ctaAction\":\"build_food_trail\",\"targetCategory\":\"Taste\",\"targetCity\":\"\",\"matchingPlaceIds\":[\"place-1\",\"place-2\"]}",
  "title": "Your food trail is ready",
  "subtitle": "You have 5 Taste saves. Bundle them into a cafe and food crawl for your next outing.",
  "ctaLabel": "Build food trail",
  "ctaAction": "build_food_trail",
  "priorityScore": 100,
  "reasonCodes": ["taste_heavy", "category_specific", "high_confidence"],
  "metadata": {
    "rule": "taste_trail",
    "targetCity": null,
    "targetLocality": "Anjuna",
    "targetCategory": "Taste",
    "totalSavedPlaces": 12,
    "matchingPlaceIds": ["place-1", "place-2"],
    "queryParams": {
      "category": "Taste",
      "placeIds": ["place-1", "place-2"]
    },
    "reasonCodes": ["taste_heavy", "category_specific", "high_confidence"],
    "priorityScore": 100
  },
  "alternatives": [
    {
      "type": "city_category_insight",
      "cardKey": "{\"type\":\"city_category_insight\",\"rule\":\"secondary_explore\",\"ctaAction\":\"plan_weekend_explore\",\"targetCategory\":\"Explore\",\"targetCity\":\"\",\"matchingPlaceIds\":[\"place-9\",\"place-10\",\"place-11\",\"place-12\"]}",
      "title": "Your Explore list can power a weekend plan",
      "subtitle": "You already have 4 Explore saves that could turn into a strong route of their own.",
      "ctaLabel": "Plan weekend route",
      "ctaAction": "plan_weekend_explore",
      "priorityScore": 94,
      "reasonCodes": ["secondary_category", "explore_secondary", "category_specific"],
      "metadata": {
        "rule": "secondary_explore",
        "targetCity": null,
        "targetLocality": "Calangute",
        "targetCategory": "Explore",
        "totalSavedPlaces": 12,
        "matchingPlaceIds": ["place-9", "place-10", "place-11", "place-12"],
        "queryParams": {
          "category": "Explore",
          "placeIds": ["place-9", "place-10", "place-11", "place-12"]
        },
        "reasonCodes": ["secondary_category", "explore_secondary", "category_specific"],
        "priorityScore": 94
      }
    },
    {
      "type": "city_category_insight",
      "cardKey": "{\"type\":\"city_category_insight\",\"rule\":\"itinerary_ready\",\"ctaAction\":\"create_itinerary\",\"targetCategory\":\"\",\"targetCity\":\"\",\"matchingPlaceIds\":[\"place-1\",\"place-2\",\"place-3\",\"place-4\",\"place-5\",\"place-6\"]}",
      "title": "You have enough saves for a real itinerary",
      "subtitle": "With 12 saved places across Wandreel, your next trip can move from scattered ideas to a proper plan.",
      "ctaLabel": "Create itinerary",
      "ctaAction": "create_itinerary",
      "priorityScore": 77,
      "reasonCodes": ["itinerary_ready", "high_save_volume"],
      "metadata": {
        "rule": "itinerary_ready",
        "targetCity": null,
        "targetLocality": null,
        "targetCategory": null,
        "totalSavedPlaces": 12,
        "matchingPlaceIds": ["place-1", "place-2", "place-3", "place-4", "place-5", "place-6"],
        "queryParams": {
          "placeIds": ["place-1", "place-2", "place-3", "place-4", "place-5", "place-6"],
          "totalSavedPlaces": 12
        },
        "reasonCodes": ["itinerary_ready", "high_save_volume"],
        "priorityScore": 77
      }
    }
  ]
}
```

# Alternatives Behavior

- `alternatives` contains up to 3 candidates
- order is already descending by `priorityScore`
- the selected card is not duplicated inside `alternatives`
- alternatives with the same `cardKey` are removed
- alternatives that target the same category or city with the same matching place set are also removed

Each alternative includes:

- `cardKey`
- `priorityScore`
- `reasonCodes`
- `metadata`
- the same title, subtitle, and CTA fields as the selected card

# Current CTA Actions

Known actions currently used by the frontend:

- `add_first_place`
- `grow_saved_places`
- `build_food_trail`
- `plan_weekend_explore`
- `view_dominant_category`
- `view_city_plan`
- `create_itinerary`

# Metadata Contract

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

The frontend uses this metadata to:

- understand the semantic meaning of the card
- execute CTAs using existing category and map views
- support freshness and fallback selection across alternatives
- save the current card as a client-side idea for later

# cardKey

The backend returns a stable `cardKey` for the selected card and every alternative.

Current key inputs:

- `type`
- `rule`
- `ctaAction`
- `metadata.targetCategory`
- `metadata.targetCity`
- sorted `metadata.matchingPlaceIds`

This prevents different rule families with the same place set from collapsing into one identity.

# Metadata Hygiene

Hero Card applies a few small hygiene rules without mutating stored saved-place data:

- city values that look like admin regions such as `Bangalore Division` are ignored for city-card logic
- `targetLocality` is chosen from the most frequent valid locality among matching places
- venue-like localities are ignored when choosing `targetLocality`
- raw saved-place metadata remains unchanged

# Current Limitations

- no full candidate list in the response
- no exposure tracking
- no freshness instructions from the backend
- no server-side dismissal state
- no backend persistence for saved Hero Card ideas

# Likely Future Changes

- wider alternative pools for richer rotation
- server-aware exposure or dismissal signals
- context-aware ranking
- planner-oriented response types once planner exists
