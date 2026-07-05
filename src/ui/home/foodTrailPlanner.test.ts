/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { buildFoodTrailPlan, resolveDefaultFoodTrailTiming } from "./foodTrailPlanner";
import type { SavedPlaceRecord } from "./savedPlaces";

function createPlace(overrides: Partial<SavedPlaceRecord>): SavedPlaceRecord {
  return {
    id: overrides.id || "place-1",
    placeId: overrides.placeId || overrides.id || "place-1",
    title: overrides.title || "Sample Place",
    category: "Taste",
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

test("default food trail timing avoids late-night same-day breakfast logic", () => {
  const result = resolveDefaultFoodTrailTiming(new Date("2026-07-05T23:10:00"));
  assert.equal(result, "tomorrow");
});

test("food trail plan becomes evening-oriented for today evening", () => {
  const plan = buildFoodTrailPlan(
    [
      createPlace({ id: "meal-1", title: "Pasta House" }),
      createPlace({ id: "dessert-1", title: "Gelato Bar" }),
      createPlace({ id: "cafe-1", title: "Corner Cafe" }),
    ],
    "today_evening",
    { now: new Date("2026-07-05T17:30:00") },
  );

  assert.equal(plan.trailStyleLabel, "Dinner and dessert trail");
  assert.equal(plan.suggestedStartTimeLabel, "7:30 PM");
  assert.deepEqual(plan.stops.map((stop) => stop.role), ["Meal", "Dessert", "Cafe"]);
});

test("food trail rebuild seed rotates stop selection deterministically", () => {
  const places = [
    createPlace({ id: "cafe-1", title: "Morning Cafe" }),
    createPlace({ id: "meal-1", title: "Lunch House" }),
    createPlace({ id: "snack-1", title: "Street Snack Point" }),
    createPlace({ id: "dessert-1", title: "Dessert Lab" }),
  ];

  const firstPlan = buildFoodTrailPlan(places, "weekend", { now: new Date("2026-07-05T10:00:00"), rebuildSeed: 0 });
  const rebuiltPlan = buildFoodTrailPlan(places, "weekend", { now: new Date("2026-07-05T10:00:00"), rebuildSeed: 1 });

  assert.notDeepEqual(firstPlan.stops.map((stop) => stop.placeId), rebuiltPlan.stops.map((stop) => stop.placeId));
});
