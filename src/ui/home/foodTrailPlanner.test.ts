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
    fullAddress: overrides.fullAddress || "",
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

test("morning route prefers breakfast and cafe places over dinner-heavy saved spots", () => {
  const plan = buildFoodTrailPlan(
    [
      createPlace({ id: "breakfast-1", title: "Idli Breakfast Club", metaPrimary: "Breakfast" }),
      createPlace({ id: "cafe-1", title: "Filter Coffee Corner", metaPrimary: "Cafe" }),
      createPlace({ id: "snack-1", title: "Momo Stop", metaPrimary: "Snack" }),
      createPlace({ id: "dinner-1", title: "Biryani Bar", metaPrimary: "Dinner" }),
    ],
    "now_today",
    { now: new Date("2026-07-05T08:30:00") },
  );

  assert.equal(plan.trailStyleLabel, "Breakfast and cafe trail");
  assert.deepEqual(plan.stops.map((stop) => stop.role), ["Breakfast", "Cafe", "Snack"]);
  assert.equal(plan.stops[0]?.placeId, "breakfast-1");
  assert.ok(!plan.stops.some((stop) => stop.placeId === "dinner-1"));
});

test("evening route prefers dinner first and keeps dessert later", () => {
  const plan = buildFoodTrailPlan(
    [
      createPlace({ id: "dinner-1", title: "Biryani House", metaPrimary: "Dinner" }),
      createPlace({ id: "dessert-1", title: "Gelato Bar", metaPrimary: "Dessert" }),
      createPlace({ id: "cafe-1", title: "Corner Cafe", metaPrimary: "Cafe" }),
      createPlace({ id: "breakfast-1", title: "Toast & Eggs", metaPrimary: "Breakfast" }),
    ],
    "today_evening",
    { now: new Date("2026-07-05T17:30:00") },
  );

  assert.equal(plan.trailStyleLabel, "Dinner and dessert trail");
  assert.equal(plan.suggestedStartTimeLabel, "Around 7:30 PM");
  assert.deepEqual(plan.stops.map((stop) => stop.role), ["Dinner", "Dessert", "Cafe"]);
  assert.match(plan.whyRouteLabel, /Starts with a dinner/i);
});

test("late-night route stays approximate instead of reusing daytime planning", () => {
  const plan = buildFoodTrailPlan(
    [
      createPlace({ id: "snack-1", title: "Night Momos", metaPrimary: "Snack" }),
      createPlace({ id: "dessert-1", title: "Kulfi Stop", metaPrimary: "Dessert" }),
      createPlace({ id: "breakfast-1", title: "Morning Brunch Club", metaPrimary: "Breakfast" }),
    ],
    "now_today",
    { now: new Date("2026-07-05T23:20:00") },
  );

  assert.equal(plan.trailStyleLabel, "Late-night bites trail");
  assert.equal(plan.suggestedStartTimeLabel, "Around 10:45 PM");
  assert.deepEqual(plan.stops.map((stop) => stop.role), ["Snack", "Dessert"]);
  assert.match(plan.summaryLabel, /could work later tonight/i);
});

test("food trail rebuild seed can vary selected places when enough options exist", () => {
  const places = [
    createPlace({ id: "lunch-1", title: "Meals House", metaPrimary: "Lunch", locality: "Indiranagar" }),
    createPlace({ id: "lunch-2", title: "Thali Spot", metaPrimary: "Lunch", locality: "Koramangala" }),
    createPlace({ id: "cafe-1", title: "Roastery One", metaPrimary: "Cafe", locality: "Indiranagar" }),
    createPlace({ id: "cafe-2", title: "Coffee Lab", metaPrimary: "Cafe", locality: "Koramangala" }),
    createPlace({ id: "snack-1", title: "Roll Express", metaPrimary: "Snack", locality: "Indiranagar" }),
    createPlace({ id: "snack-2", title: "Street Chaat", metaPrimary: "Snack", locality: "Koramangala" }),
    createPlace({ id: "dessert-1", title: "Cake Studio", metaPrimary: "Dessert", locality: "Indiranagar" }),
    createPlace({ id: "dessert-2", title: "Gelato Lab", metaPrimary: "Dessert", locality: "Koramangala" }),
  ];

  const firstPlan = buildFoodTrailPlan(places, "weekend", { now: new Date("2026-07-05T10:00:00"), rebuildSeed: 0 });
  const rebuiltPlan = buildFoodTrailPlan(places, "weekend", { now: new Date("2026-07-05T10:00:00"), rebuildSeed: 1 });

  assert.notDeepEqual(firstPlan.stops.map((stop) => stop.placeId), rebuiltPlan.stops.map((stop) => stop.placeId));
});
