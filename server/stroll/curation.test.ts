import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeDeterministicStrollCandidates,
  generateDeterministicStrollPlan,
  StrollCurationPipelineError,
  type SavedPlaceForStrollCuration,
} from "./curation";
import type { StrollSummary } from "./types";

function stroll(overrides: Partial<StrollSummary> = {}): StrollSummary {
  return {
    id: "stroll-1",
    name: "Patna Stroll",
    description: null,
    city: "Patna",
    status: "curating",
    source: "manual",
    startDate: null,
    endDate: null,
    requestedStartTime: "10:00",
    travellerCount: 2,
    interests: ["Food", "Heritage"],
    latitude: 25.5941,
    longitude: 85.1376,
    totalDistanceMeters: null,
    estimatedDurationMinutes: null,
    stopCount: 0,
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:00:00.000Z",
    curatedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function place(
  placeId: string,
  title: string,
  category: string,
  lat: number,
  lng: number,
  metadata: Record<string, unknown> = {},
): SavedPlaceForStrollCuration {
  return {
    id: `${placeId}-row`,
    placeId,
    title,
    category,
    metadata: {
      city: "Patna",
      locality: "Patna",
      lat,
      lng,
      confidence: 0.82,
      description: `${title} saved from a reel.`,
      ...metadata,
    },
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:00:00.000Z",
  };
}

test("draft Stroll without predefined stops becomes a deterministic generated plan", () => {
  const savedPlaces = [
    place("food-1", "Old City Litti Cafe", "Taste", 25.5945, 85.1379),
    place("heritage-1", "Golghar", "Explore", 25.6204, 85.1415),
    place("park-1", "Gandhi Maidan", "Explore", 25.6173, 85.1445),
  ];

  const first = generateDeterministicStrollPlan(stroll(), savedPlaces);
  const second = generateDeterministicStrollPlan(stroll(), [...savedPlaces].reverse());

  assert.equal(first.stops.length, 3);
  assert.deepEqual(first.stops.map((stop) => stop.placeId), second.stops.map((stop) => stop.placeId));
  assert.deepEqual(first.stops.map((stop) => stop.sequence), [1, 2, 3]);
  assert.ok(first.totalDistanceMeters > 0);
  assert.ok(first.estimatedDurationMinutes > 0);
});

test("candidate selection filters out mixed-city and coordinate-less saved places", () => {
  const plan = generateDeterministicStrollPlan(stroll(), [
    place("patna-food", "Patna Cafe", "Taste", 25.5945, 85.1379),
    place("patna-heritage", "Patna Museum", "Explore", 25.613, 85.123),
    place("delhi-food", "Delhi Cafe", "Taste", 28.61, 77.2, { city: "Delhi", locality: "Delhi" }),
    { ...place("missing-location", "No Location", "Explore", 25.6, 85.1), metadata: { city: "Patna" } },
  ]);

  assert.deepEqual(plan.stops.map((stop) => stop.placeId).sort(), ["patna-food", "patna-heritage"]);
});

test("candidate analysis separates hard exclusions from ranking factors", () => {
  const savedPlaces = [
    place("patna-food", "Patna Cafe", "Taste", 25.5945, 85.1379),
    place("patna-food", "Patna Cafe Duplicate", "Taste", 25.5946, 85.138),
    place("delhi-food", "Delhi Cafe", "Taste", 28.61, 77.2, { city: "Delhi", locality: "Delhi" }),
    { ...place("missing-location", "No Location", "Explore", 25.6, 85.1), metadata: { city: "Patna" } },
  ];

  const analysis = analyzeDeterministicStrollCandidates(stroll(), savedPlaces, ["patna-food"]);
  const byPlaceId = new Map(analysis.decisions.map((decision) => [decision.legacyPlaceId || decision.title, decision]));
  const selectedPatnaFood = analysis.decisions.find((decision) => decision.legacyPlaceId === "patna-food" && decision.eligible);

  assert.equal(selectedPatnaFood?.eligible, true);
  assert.equal(selectedPatnaFood?.selected, true);
  assert.ok((selectedPatnaFood?.deterministicScore ?? 0) > 0);
  assert.deepEqual(Object.keys(selectedPatnaFood?.scoringFactors ?? {}).sort(), [
    "category",
    "confidence",
    "geography",
    "interest",
    "quality",
  ]);
  assert.equal(analysis.decisions.find((decision) => decision.title === "Patna Cafe Duplicate")?.exclusionReason, "DUPLICATE_PLACE");
  assert.equal(byPlaceId.get("delhi-food")?.exclusionReason, "WRONG_CITY");
  assert.equal(byPlaceId.get("missing-location")?.exclusionReason, "MISSING_COORDINATES");
});

test("ranking prefers interest and metadata quality over weaker saved places", () => {
  const plan = generateDeterministicStrollPlan(stroll({ interests: ["Food"] }), [
    place("weak-heritage", "Unknown Monument", "Explore", 25.62, 85.14, { confidence: 0.2, description: "" }),
    place("strong-food", "Patna Breakfast House", "Taste", 25.595, 85.138, { confidence: 0.95, imageUrl: "https://example.test/img.jpg" }),
    place("second-food", "Kachori Lane", "Taste", 25.596, 85.139, { confidence: 0.9 }),
  ]);

  assert.equal(plan.stops[0]?.placeId, "strong-food");
  assert.ok(plan.stops.some((stop) => stop.reason.includes("Food")));
});

test("category diversity is preserved when Stroll has multiple themes", () => {
  const plan = generateDeterministicStrollPlan(stroll({ interests: ["Food", "Heritage", "Activity"] }), [
    place("food-1", "Food One", "Taste", 25.594, 85.137),
    place("food-2", "Food Two", "Taste", 25.595, 85.138),
    place("food-3", "Food Three", "Taste", 25.596, 85.139),
    place("heritage-1", "Museum One", "Explore", 25.597, 85.14),
    place("activity-1", "Craft Workshop", "Do", 25.598, 85.141),
  ]);

  const selected = new Set(plan.stops.map((stop) => stop.placeId));
  assert.equal(selected.has("heritage-1"), true);
  assert.equal(selected.has("activity-1"), true);
});

test("single-theme Stroll can keep one dominant category", () => {
  const plan = generateDeterministicStrollPlan(stroll({ interests: ["Food"] }), [
    place("food-1", "Food One", "Taste", 25.594, 85.137),
    place("food-2", "Food Two", "Taste", 25.595, 85.138),
    place("food-3", "Food Three", "Taste", 25.596, 85.139),
  ]);

  assert.deepEqual(plan.stops.map((stop) => stop.placeId), ["food-1", "food-2", "food-3"]);
});

test("geographically incoherent results fail clearly", () => {
  assert.throws(
    () =>
      generateDeterministicStrollPlan(stroll(), [
        place("patna-1", "Patna Cafe", "Taste", 25.5945, 85.1379),
        place("far-1", "Far Patna Claim", "Explore", 26.5, 86.2, { city: "Patna", locality: "Patna" }),
      ]),
    (error) => error instanceof StrollCurationPipelineError && error.code === "geographically_incoherent",
  );
});

test("insufficient eligible places failure is explicit", () => {
  assert.throws(
    () =>
      generateDeterministicStrollPlan(stroll(), [
        place("only-1", "Only Cafe", "Taste", 25.5945, 85.1379),
        place("delhi-1", "Delhi Cafe", "Taste", 28.61, 77.2, { city: "Delhi", locality: "Delhi" }),
      ]),
    (error) => error instanceof StrollCurationPipelineError && error.code === "insufficient_eligible_places",
  );
});
