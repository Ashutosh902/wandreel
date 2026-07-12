import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DISCOVER_HERO_CARD,
  deriveHeroCardKey,
  selectHomeHeroCandidate,
  type HeroCardData,
} from "./useHeroCard";
import type { SavedPlaceRecord } from "./savedPlaces";

function createCard(overrides: Partial<HeroCardData> = {}): HeroCardData {
  return {
    type: "city_category_insight",
    cardKey: "hero-patna-food",
    readyStrollId: undefined,
    heroState: "suggestion",
    title: "Build a Patna food Stroll",
    subtitle: "3 Taste saves can shape today's route.",
    ctaLabel: "Build Stroll",
    ctaAction: "build_food_trail",
    metadata: {
      targetCategory: "Taste",
      targetCity: "Patna",
      matchingPlaceIds: ["taste-1", "taste-2", "taste-3"],
    },
    ...overrides,
  };
}

function createSavedPlace(placeId: string): SavedPlaceRecord {
  return {
    id: placeId,
    placeId,
    title: placeId,
    category: "Taste",
    distanceKm: 0,
    metaPrimary: "Patna",
    metaSecondary: "Patna",
    locality: "Patna",
    city: "Patna",
    state: "Bihar",
    country: "India",
    fullAddress: `${placeId}, Patna`,
    videoUrl: "",
    imageUrl: "",
    tags: [],
    createdAtMs: 1,
  };
}

function createExplorePlace(placeId: string): SavedPlaceRecord {
  return {
    ...createSavedPlace(placeId),
    category: "Explore",
  };
}

test("selectHomeHeroCandidate keeps the currently visible card eligible during cooldown", () => {
  const payload = createCard();
  const selected = selectHomeHeroCandidate({
    payload,
    visibleSavedPlaces: [createSavedPlace("taste-1"), createSavedPlace("taste-2"), createSavedPlace("taste-3")],
    currentLocationLabel: "Patna, Bihar",
    freshnessState: {
      lastShownCardKey: deriveHeroCardKey(payload),
      lastShownAtMs: Date.now(),
      dismissedCardKeys: [],
    },
    visibleHeroCardKey: deriveHeroCardKey(payload),
  });

  assert.equal(selected?.ctaLabel, "Build Stroll");
});

test("selectHomeHeroCandidate falls back to the only eligible card instead of leaving Discover empty", () => {
  const payload = createCard();
  const selected = selectHomeHeroCandidate({
    payload,
    visibleSavedPlaces: [createSavedPlace("taste-1"), createSavedPlace("taste-2"), createSavedPlace("taste-3")],
    currentLocationLabel: "Patna, Bihar",
    freshnessState: {
      lastShownCardKey: deriveHeroCardKey(payload),
      lastShownAtMs: Date.now(),
      dismissedCardKeys: [],
    },
    visibleHeroCardKey: deriveHeroCardKey(DEFAULT_DISCOVER_HERO_CARD),
  });

  assert.equal(selected?.ctaLabel, "Build Stroll");
});

test("selectHomeHeroCandidate still prefers an alternative when the previous card is cooling down", () => {
  const payload = createCard({
    alternatives: [
      {
        ...createCard({
          cardKey: "hero-patna-explore",
          heroState: "suggestion",
          title: "Turn your Patna saves into a weekend Stroll",
          subtitle: "Your saved places can shape a calm route for today.",
          ctaLabel: "Create Stroll",
          ctaAction: "view_city_plan",
          metadata: {
            targetCategory: "Explore",
            targetCity: "Patna",
            matchingPlaceIds: ["taste-1", "taste-2", "taste-3", "explore-1"],
          },
        }),
      },
    ],
  });
  const selected = selectHomeHeroCandidate({
    payload,
    visibleSavedPlaces: [
      createSavedPlace("taste-1"),
      createSavedPlace("taste-2"),
      createSavedPlace("taste-3"),
      createExplorePlace("explore-1"),
    ],
    currentLocationLabel: "Patna, Bihar",
    freshnessState: {
      lastShownCardKey: deriveHeroCardKey(createCard()),
      lastShownAtMs: Date.now(),
      dismissedCardKeys: [],
    },
    visibleHeroCardKey: deriveHeroCardKey(DEFAULT_DISCOVER_HERO_CARD),
  });

  assert.equal(selected?.ctaLabel, "Create Stroll");
});
