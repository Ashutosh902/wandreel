/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  createWeekendPlannerDemoPlaces,
  isWeekendPlannerDemoEnabled,
} from "./weekendPlannerDemo";
import { buildWeekendPlan } from "./weekendPlanner";

test("weekend demo preview stays disabled unless dev mode and demo=1 are both true", () => {
  assert.equal(isWeekendPlannerDemoEnabled("", true), false);
  assert.equal(isWeekendPlannerDemoEnabled("?demo=0", true), false);
  assert.equal(isWeekendPlannerDemoEnabled("?demo=1", false), false);
  assert.equal(isWeekendPlannerDemoEnabled("?demo=1", true), true);
});

test("weekend demo preview uses mixed saved-place samples for planner QA", () => {
  const places = createWeekendPlannerDemoPlaces();

  assert.ok(places.filter((place) => place.category === "Taste").length >= 2);
  assert.ok(places.filter((place) => place.category === "Explore").length >= 2);
  assert.ok(places.filter((place) => place.category === "Activity").length >= 1);
  assert.ok(places.every((place) => place.city === "Patna"));
  assert.ok(new Set(places.map((place) => place.locality)).size >= 2);
});

test("weekend demo places can produce alternate rebuild plans", () => {
  const places = createWeekendPlannerDemoPlaces();
  const initialStops = buildWeekendPlan(places, "next_weekend", { rebuildSeed: 0 }).stops.map((stop) => stop.title);
  const rebuiltStops = buildWeekendPlan(places, "next_weekend", { rebuildSeed: 1 }).stops.map((stop) => stop.title);

  assert.notDeepEqual(rebuiltStops, initialStops);
});
