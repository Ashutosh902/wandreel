/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { createFoodTrailDemoPlaces, isFoodTrailDemoEnabled } from "./foodTrailPlannerDemo";

test("demo preview stays disabled unless explicitly enabled", () => {
  assert.equal(isFoodTrailDemoEnabled("", true), false);
  assert.equal(isFoodTrailDemoEnabled("?demo=0", true), false);
  assert.equal(isFoodTrailDemoEnabled("?demo=1", false), false);
  assert.equal(isFoodTrailDemoEnabled("?demo=1", true), true);
});

test("demo preview places are safe local Taste samples for planner QA", () => {
  const places = createFoodTrailDemoPlaces();

  assert.ok(places.length >= 4);
  assert.ok(places.every((place) => place.category === "Taste"));
  assert.ok(places.some((place) => /breakfast|cafe/i.test(`${place.metaPrimary} ${place.metaSecondary} ${place.title}`)));
  assert.ok(places.some((place) => /biryani|dinner|meal/i.test(`${place.metaPrimary} ${place.metaSecondary} ${place.title}`)));
  assert.ok(places.some((place) => /dessert|gelato|waffle/i.test(`${place.metaPrimary} ${place.metaSecondary} ${place.title}`)));
  assert.ok(places.some((place) => /snack|street food|chaat/i.test(`${place.metaPrimary} ${place.metaSecondary} ${place.title}`)));
  assert.ok(new Set(places.map((place) => place.locality)).size >= 2);
});
