/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyFoodTrailHeroEligibility,
  applyWeekendPlanHeroEligibility,
  FOOD_TRAIL_READY_THRESHOLD,
  type HeroCardEligibilityCard,
} from "./heroCardEligibility";
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
    locality: overrides.locality || "Indiranagar",
    city: overrides.city || "Bengaluru",
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

function createFoodTrailCard(overrides?: Partial<HeroCardEligibilityCard>): HeroCardEligibilityCard {
  return {
    type: "city_category_insight",
    title: "Your food trail is ready",
    subtitle: "Build a food trail from your saved places.",
    ctaLabel: "Build food trail",
    ctaAction: "build_food_trail",
    metadata: {},
    ...overrides,
  };
}

test("0 city Taste saves do not show a ready food trail card", () => {
  const card = applyFoodTrailHeroEligibility(
    createFoodTrailCard({ metadata: { targetCity: "Bengaluru" } }),
    [
      createPlace({ id: "mumbai-1", city: "Mumbai" }),
      createPlace({ id: "mumbai-2", city: "Mumbai" }),
    ],
    "Bengaluru, Karnataka",
  );

  assert.equal(card, null);
});

test("1-2 city Taste saves become an almost-ready card", () => {
  const card = applyFoodTrailHeroEligibility(
    createFoodTrailCard({ metadata: { targetCity: "Bengaluru" } }),
    [
      createPlace({ id: "blr-1", city: "Bengaluru" }),
      createPlace({ id: "blr-2", city: "Bengaluru" }),
      createPlace({ id: "mum-1", city: "Mumbai" }),
    ],
    "Bengaluru, Karnataka",
  );

  assert.ok(card);
  assert.equal(card?.title, "Food trail almost ready");
  assert.equal(card?.ctaLabel, "Add places");
  assert.equal(card?.ctaAction, "grow_saved_places");
  assert.equal(card?.subtitle, "Save 1 more food places in Bengaluru.");
});

test("3+ city Taste saves keep the ready food trail card", () => {
  const places = Array.from({ length: FOOD_TRAIL_READY_THRESHOLD }, (_, index) => (
    createPlace({ id: `blr-${index + 1}`, city: "Bengaluru" })
  ));

  const card = applyFoodTrailHeroEligibility(
    createFoodTrailCard({ metadata: { targetCity: "Bengaluru" } }),
    places,
    "Bengaluru, Karnataka",
  );

  assert.ok(card);
  assert.equal(card?.ctaAction, "build_food_trail");
  assert.equal(card?.title, "Your food trail is ready");
  assert.deepEqual(card?.metadata.matchingPlaceIds, ["blr-1", "blr-2", "blr-3"]);
});

test("Taste saves in another city do not make the current city ready", () => {
  const card = applyFoodTrailHeroEligibility(
    createFoodTrailCard(),
    [
      createPlace({ id: "mum-1", city: "Mumbai" }),
      createPlace({ id: "mum-2", city: "Mumbai" }),
      createPlace({ id: "mum-3", city: "Mumbai" }),
      createPlace({ id: "blr-1", city: "Bengaluru" }),
    ],
    "Bengaluru, Karnataka",
  );

  assert.ok(card);
  assert.equal(card?.title, "Food trail almost ready");
  assert.equal(card?.subtitle, "Save 2 more food places in Bengaluru.");
});

test("weekend plan cards prefer city over locality and become ready only with mixed city places", () => {
  const card = applyWeekendPlanHeroEligibility(
    {
      type: "city_category_insight",
      title: "Plan ready",
      subtitle: "Placeholder",
      ctaLabel: "Plan weekend",
      ctaAction: "view_city_plan",
      metadata: {},
    },
    [
      createPlace({ id: "taste-1", category: "Taste", locality: "Dhanaut", city: "Patna", state: "Bihar" }),
      createPlace({ id: "explore-1", category: "Explore", locality: "Boring Road", city: "Patna", state: "Bihar" }),
      createPlace({ id: "activity-1", category: "Activity", locality: "Kankarbagh", city: "Patna", state: "Bihar" }),
      createPlace({ id: "mumbai-1", category: "Explore", locality: "Bandra", city: "Mumbai", state: "Maharashtra" }),
    ],
    "Dhanaut, Bihar",
  );

  assert.ok(card);
  assert.equal(card?.metadata.targetCity, "Patna");
  assert.equal(card?.ctaAction, "view_city_plan");
  assert.deepEqual(card?.metadata.matchingPlaceIds, ["taste-1", "explore-1", "activity-1"]);
});

test("other-city saves do not make the current city weekend plan ready", () => {
  const card = applyWeekendPlanHeroEligibility(
    {
      type: "city_category_insight",
      title: "Plan ready",
      subtitle: "Placeholder",
      ctaLabel: "Plan weekend",
      ctaAction: "view_city_plan",
      metadata: {},
    },
    [
      createPlace({ id: "mum-1", category: "Taste", locality: "Bandra", city: "Mumbai", state: "Maharashtra" }),
      createPlace({ id: "mum-2", category: "Explore", locality: "Bandra", city: "Mumbai", state: "Maharashtra" }),
      createPlace({ id: "mum-3", category: "Activity", locality: "Bandra", city: "Mumbai", state: "Maharashtra" }),
      createPlace({ id: "patna-1", category: "Taste", locality: "Dhanaut", city: "Patna", state: "Bihar" }),
    ],
    "Dhanaut, Bihar",
  );

  assert.ok(card);
  assert.equal(card?.title, "Patna plan almost ready");
  assert.equal(card?.ctaAction, "grow_saved_places");
});
