/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { isEngagementBoilerplateName, isPlaceNeedsManualReview, shouldShowImmediateDraftPlaces } from "./addDraftVisibility";
import type { DetectedPlace } from "./addFlowState";

function createPlace(overrides: Partial<DetectedPlace> = {}): DetectedPlace {
  return {
    id: "place-1",
    runId: 1,
    sourceUrl: "https://example.com/reel",
    retryCount: 0,
    name: "Beige",
    category: "Taste",
    locality: "Marathahalli",
    source: "Instagram",
    imageUrl: "https://example.com/photo.jpg",
    fullAddress: "Marathahalli, Bengaluru",
    videoUrl: "https://example.com/reel",
    confidence: "high",
    evidenceText: "Caption mentions Beige in Marathahalli",
    intent: null,
    placeId: "maps-1",
    lat: null,
    lng: null,
    city: null,
    state: null,
    country: null,
    ...overrides,
  };
}

test("engagement boilerplate names are rejected", () => {
  assert.equal(isEngagementBoilerplateName("2,319 likes, 29 comments"), true);
  assert.equal(isEngagementBoilerplateName("@creator · Jun 18"), true);
  assert.equal(isEngagementBoilerplateName("Beige"), false);
});

test("manual review flags polluted place cards", () => {
  assert.equal(
    isPlaceNeedsManualReview(createPlace({ name: "2,319 likes, 29 comments" })),
    true,
  );
  assert.equal(
    isPlaceNeedsManualReview(createPlace({ name: "Detected place", placeId: null, evidenceText: null })),
    true,
  );
  assert.equal(isPlaceNeedsManualReview(createPlace()), false);
});

test("immediate draft keeps pending placeholder for needs_review or polluted entities", () => {
  const polluted = createPlace({
    name: "2,319 likes, 29 comments",
    confidence: "high",
    placeId: null,
    evidenceText: "Draft heuristic inference from extracted metadata",
  });
  const clean = createPlace();

  assert.deepEqual(shouldShowImmediateDraftPlaces([clean], "needs_review"), []);
  assert.deepEqual(shouldShowImmediateDraftPlaces([polluted], "ready"), []);
  assert.deepEqual(shouldShowImmediateDraftPlaces([clean], "ready"), [clean]);
});
