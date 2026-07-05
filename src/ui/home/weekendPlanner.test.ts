/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { buildWeekendPlan, isWeekendPlannerAction, resolveDefaultWeekendPlannerTiming } from "./weekendPlanner";
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
    locality: overrides.locality || "Dhanaut",
    city: overrides.city || "Patna",
    state: overrides.state || "Bihar",
    country: null,
    fullAddress: "",
    videoUrl: "",
    imageUrl: "",
    tags: [],
    createdAtMs: 1,
    ...overrides,
  };
}

test("weekday defaults to next weekend", () => {
  assert.equal(resolveDefaultWeekendPlannerTiming(new Date("2026-07-06T10:00:00")), "next_weekend");
});

test("weekend planner actions route plan cards into the dedicated planner", () => {
  assert.equal(isWeekendPlannerAction("view_city_plan"), true);
  assert.equal(isWeekendPlannerAction("plan_weekend_explore"), true);
  assert.equal(isWeekendPlannerAction("view_dominant_category", "Explore"), true);
  assert.equal(isWeekendPlannerAction("view_dominant_category", "Taste"), false);
});

test("weekend planner uses mixed saved city places", () => {
  const plan = buildWeekendPlan(
    [
      createPlace({ id: "taste-1", category: "Taste", title: "Breakfast House" }),
      createPlace({ id: "explore-1", category: "Explore", title: "Patna Museum" }),
      createPlace({ id: "activity-1", category: "Activity", title: "Kayak Club" }),
      createPlace({ id: "taste-2", category: "Taste", title: "Coffee Break", metaPrimary: "Cafe" }),
    ],
    "next_weekend",
    { now: new Date("2026-07-06T10:00:00"), rebuildSeed: 0 },
  );

  assert.deepEqual(plan.stops.map((stop) => stop.category), ["Explore", "Taste", "Activity", "Taste"]);
});
