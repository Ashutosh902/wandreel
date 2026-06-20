/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { isInstagramMetadataBoilerplateText, sanitizeDetectedPlace } from "./addEntitySanitizer";
import type { DetectedPlace } from "./addFlowState";

function createPlace(overrides: Partial<DetectedPlace> = {}): DetectedPlace {
  return {
    id: "place-1",
    runId: 1,
    sourceUrl: "https://example.com/reel",
    retryCount: 0,
    name: "Eva Cafe",
    category: "Taste",
    locality: "Anjuna",
    source: "Instagram Reel",
    imageUrl: "https://example.com/img.jpg",
    fullAddress: "Anjuna, Goa",
    videoUrl: "https://example.com/reel",
    confidence: "high",
    evidenceText: "OCR candidate",
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

test("frontend sanitizer rejects instagram metadata boilerplate names", () => {
  assert.equal(
    isInstagramMetadataBoilerplateText("8,043 likes, 29 comments - rishikarajputchaudhary on April 19, 2026: &quot;Cutes"),
    true,
  );
});

test("frontend sanitizer replaces junk display names with Detected place", () => {
  const sanitized = sanitizeDetectedPlace(createPlace({
    name: "8,043 likes, 29 comments - rishikarajputchaudhary on April 19, 2026: &quot;Cutes",
    confidence: "high",
  }));

  assert.equal(sanitized.sanitized, true);
  assert.equal(sanitized.place.name, "Detected place");
  assert.equal(sanitized.place.confidence, "low");
});

test("frontend sanitizer keeps valid place names", () => {
  assert.equal(sanitizeDetectedPlace(createPlace({ name: "Eva Cafe" })).place.name, "Eva Cafe");
  assert.equal(sanitizeDetectedPlace(createPlace({ name: "Queen's Pod" })).place.name, "Queen's Pod");
  assert.equal(sanitizeDetectedPlace(createPlace({ name: "The Travel Cafe Gangtok" })).place.name, "The Travel Cafe Gangtok");
});
