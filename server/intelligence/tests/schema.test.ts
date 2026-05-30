import assert from "node:assert/strict";
import test from "node:test";
import { intelligenceOutputSchema } from "../schema";

test("schema rejects unsupported category", () => {
  const result = intelligenceOutputSchema.safeParse({
    source: { url: null, platform: "youtube", title: null, creator: null, sourceType: "unknown" },
    placeCollections: [],
    categoriesPresent: ["food"],
    weakMentions: [],
    showIn: { eat: false, do: false, stay: false, see: false },
    structuredEntities: [],
    entities: [],
    visibility: { showIn: [], doNotShowIn: [], reason: null },
    status: "ready",
  });

  assert.equal(result.success, false);
});

test("schema accepts strict valid output", () => {
  const result = intelligenceOutputSchema.safeParse({
    source: { url: "https://example.com", platform: "website", title: "Title", creator: null, sourceType: "mixed_discovery" },
    placeCollections: [],
    categoriesPresent: ["see"],
    weakMentions: [{ text: "eat", reason: "Generic mention" }],
    showIn: { eat: false, do: false, stay: false, see: true },
    structuredEntities: [
      {
        name: "Gateway",
        category: "see",
        locality: null,
        city: "Mumbai",
        state: "Maharashtra",
        country: "India",
        address: null,
        confidence: "high",
        googleMapsQuery: "Gateway Mumbai",
        evidenceText: "Gateway mention",
      },
    ],
    entities: [
      {
        category: "see",
        name: "Gateway",
        entityType: "landmark",
        city: "Mumbai",
        state: "Maharashtra",
        country: "India",
        locality: null,
        tags: ["landmark"],
        details: {},
        level2: {
          category: "see",
          placeType: "landmark",
          experienceTag: null,
          vibeTags: [],
          entryFeeSignal: null,
        },
        googleMapsQuery: "Gateway Mumbai",
        sourceEvidence: "Gateway mention",
        confidence: "high",
      },
    ],
    visibility: { showIn: ["see"], doNotShowIn: ["eat", "do", "stay"], reason: "ok" },
    status: "ready",
  });

  assert.equal(result.success, true);
});
