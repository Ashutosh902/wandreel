/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { filterPlacesByResolvedCity, resolveLocationContext } from "./locationContext";
import type { SavedPlaceRecord } from "./savedPlaces";

function createPlace(overrides: Partial<SavedPlaceRecord>): SavedPlaceRecord {
  return {
    id: overrides.id || "place-1",
    placeId: overrides.placeId || overrides.id || "place-1",
    title: overrides.title || "Sample Place",
    category: overrides.category || "Explore",
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

test("location context prefers city over locality for plan cards", () => {
  const context = resolveLocationContext(
    "Dhanaut, Bihar",
    [
      createPlace({ locality: "Dhanaut", city: "Patna", state: "Bihar" }),
      createPlace({ id: "2", locality: "Boring Road", city: "Patna", state: "Bihar" }),
    ],
  );

  assert.equal(context.localityName, "Dhanaut");
  assert.equal(context.cityName, "Patna");
  assert.equal(context.regionName, "Bihar");
});

test("resolved city filtering uses city matches even when label starts with locality", () => {
  const result = filterPlacesByResolvedCity(
    [
      createPlace({ id: "1", locality: "Dhanaut", city: "Patna", category: "Taste" }),
      createPlace({ id: "2", locality: "Kankarbagh", city: "Patna", category: "Explore" }),
      createPlace({ id: "3", locality: "Bandra", city: "Mumbai", state: "Maharashtra", category: "Activity" }),
    ],
    "Dhanaut, Bihar",
  );

  assert.equal(result.cityName, "Patna");
  assert.deepEqual(result.places.map((place) => place.id), ["1", "2"]);
});
