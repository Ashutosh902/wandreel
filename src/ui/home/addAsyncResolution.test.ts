/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { shouldApplyResolvedPlacesUpdate } from "./addAsyncResolution";
import type { DetectedPlace } from "./addFlowState";

function createPlace(overrides: Partial<DetectedPlace> = {}): DetectedPlace {
  return {
    id: "place-1",
    runId: 1,
    sourceUrl: "https://example.com/reel",
    retryCount: 0,
    name: "Detected place",
    category: "Explore",
    locality: "Unknown locality",
    source: "Instagram Reel",
    imageUrl: "https://example.com/img.jpg",
    fullAddress: "Unknown locality",
    videoUrl: "https://example.com/reel",
    confidence: "low",
    evidenceText: null,
    intent: null,
    placeId: null,
    lat: null,
    lng: null,
    city: null,
    state: null,
    country: null,
    ...overrides,
  };
}

test("better async result replaces placeholder card", () => {
  const current = [createPlace()];
  const incoming = [createPlace({
    id: "taste-eva-cafe-0",
    name: "Eva Cafe",
    category: "Taste",
    locality: "Anjuna",
    fullAddress: "Anjuna, Goa",
    confidence: "high",
    evidenceText: "OCR candidate: Eva cafe, Anjuna",
    placeId: "maps-eva",
  })];

  assert.deepEqual(shouldApplyResolvedPlacesUpdate(current, incoming), {
    apply: true,
    reason: "incoming_better_than_placeholder",
  });
});

test("empty async result preserves current card", () => {
  const current = [createPlace()];
  assert.deepEqual(shouldApplyResolvedPlacesUpdate(current, []), {
    apply: false,
    reason: "incoming_empty_preserve_current",
  });
});

test("empty async result does not preserve junk card", () => {
  const current = [createPlace({
    name: "8,043 likes, 29 comments - rishikarajputchaudhary on April 19, 2026...",
    confidence: "low",
    placeId: null,
  })];
  assert.deepEqual(shouldApplyResolvedPlacesUpdate(current, []), {
    apply: true,
    reason: "incoming_empty_replace_junk_with_placeholder",
  });
});
