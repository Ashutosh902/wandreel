/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocalSavedPlacesPlannerDataSource,
  resolveHeroCardPlannerSelection,
} from "./heroCardPlannerData";
import type { SavedPlaceRecord } from "./savedPlaces";

function createPlace(overrides: Partial<SavedPlaceRecord>): SavedPlaceRecord {
  return {
    id: overrides.id || "place-1",
    placeId: overrides.placeId || overrides.id || "place-1",
    title: overrides.title || "Sample Place",
    category: overrides.category || "Taste",
    distanceKm: 0.1,
    metaPrimary: "",
    metaSecondary: "",
    locality: "",
    city: null,
    state: null,
    country: null,
    fullAddress: "",
    videoUrl: "",
    imageUrl: "",
    tags: [],
    createdAtMs: 1,
    ...overrides,
  };
}

test("planner selection uses real saved places for matching category places", () => {
  const selection = resolveHeroCardPlannerSelection(
    {
      ctaAction: "build_food_trail",
      metadata: {
        targetCategory: "Taste",
        matchingPlaceIds: ["taste-1", "taste-2"],
      },
    },
    createLocalSavedPlacesPlannerDataSource([
      createPlace({ id: "taste-1", category: "Taste", title: "Cafe A" }),
      createPlace({ id: "taste-2", category: "Taste", title: "Cafe B" }),
      createPlace({ id: "explore-1", category: "Explore", title: "Fort C" }),
    ]),
  );

  assert.equal(selection.targetCategory, "Taste");
  assert.deepEqual(selection.getCategoryPlaces("Taste").map((place) => place.title), ["Cafe A", "Cafe B"]);
});

test("planner selection never reads saved-idea payload as planner places", () => {
  const selection = resolveHeroCardPlannerSelection(
    {
      ctaAction: "build_food_trail",
      metadata: {
        targetCategory: "Taste",
        matchingPlaceIds: ["idea-only-id"],
      },
    },
    createLocalSavedPlacesPlannerDataSource([
      createPlace({ id: "taste-1", category: "Taste", title: "Cafe A" }),
      createPlace({ id: "taste-2", category: "Taste", title: "Cafe B" }),
    ]),
  );

  assert.equal(selection.matchingPlaces.length, 0);
  assert.deepEqual(selection.getCategoryPlaces("Taste").map((place) => place.title), ["Cafe A", "Cafe B"]);
});

test("planner selection falls back to saved city places for city cards", () => {
  const selection = resolveHeroCardPlannerSelection(
    {
      ctaAction: "view_city_plan",
      metadata: {
        targetCity: "Bengaluru",
      },
    },
    createLocalSavedPlacesPlannerDataSource([
      createPlace({ id: "taste-1", category: "Taste", city: "Bengaluru", title: "Cafe A" }),
      createPlace({ id: "explore-1", category: "Explore", city: "Bengaluru", title: "Park B" }),
      createPlace({ id: "stay-1", category: "Stay", city: "Mumbai", title: "Hotel C" }),
    ]),
  );

  assert.deepEqual(selection.getCityPlaces().map((place) => place.title), ["Cafe A", "Park B"]);
});
