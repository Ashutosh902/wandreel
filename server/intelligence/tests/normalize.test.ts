import assert from "node:assert/strict";
import test from "node:test";
import { isInstagramMetadataBoilerplateName, normalizeIntelligenceOutput, sanitizeIntelligenceOutputEntityNames } from "../normalize";

test("normalizer maps aliases, dedupes, clamps confidence and sets categoriesPresent", () => {
  const out = normalizeIntelligenceOutput({
    source: { platform: "youtube", sourceType: "travel_discovery_video", title: "Trip", creator: "A" },
    categoriesPresent: ["food"],
    weakMentions: [{ text: "food", reason: "generic mention" }],
    entities: [
      {
        category: "food",
        name: "Eco Park",
        entityType: "park_activity",
        city: "Patna",
        tags: ["boating"],
        details: { activityType: "outdoor", timeTag: "evening" },
        sourceEvidence: "boating and cycling",
        confidence: 1.7,
      },
      {
        category: "do",
        name: "Eco Park",
        entityType: "park_activity",
        city: "Patna",
        tags: ["cycling"],
        details: { activityType: "outdoor", timeTag: "weekend" },
        sourceEvidence: "cycling",
        confidence: -1,
      },
    ],
  });

  assert.equal(out.entities.length, 2);
  assert.deepEqual(out.categoriesPresent.sort(), ["do", "eat"].sort());
  assert.equal(["high", "medium", "low"].includes(out.entities[0].confidence), true);
  assert.equal(["high", "medium", "low"].includes(out.entities[1].confidence), true);
  assert.equal(typeof out.showIn.do, "boolean");
});

test("normalizer downgrades weak food mentions to weakMentions", () => {
  const out = normalizeIntelligenceOutput({
    source: { platform: "website", sourceType: "unknown" },
    entities: [
      {
        category: "eat",
        name: "Local Food",
        entityType: "generic_food",
        sourceEvidence: "try local restaurants and delicious food",
      },
    ],
    weakMentions: [],
  });

  assert.equal(out.entities.length, 0);
  assert.equal(out.weakMentions.some((w) => w.text === "eat"), true);
  assert.equal(out.status, "no_supported_entity_found");
});

test("normalizer maps level2 vibe tags to allowed chip vocabulary", () => {
  const out = normalizeIntelligenceOutput({
    source: { platform: "instagram", sourceType: "restaurant_recommendation" },
    entities: [
      {
        category: "eat",
        name: "Barkaas Patna",
        entityType: "restaurant",
        sourceEvidence: "Spicy food and street style mention",
        confidence: "medium",
        details: {
          cuisineType: "Mughlai",
          vibeTags: ["street style", "trending", "random_unknown"],
          dietaryTags: ["vegetarian options", "spicy"],
        },
      },
    ],
  });

  assert.equal(out.entities.length, 1);
  const entity = out.entities[0];
  assert.deepEqual(entity.level2.category, "eat");
  assert.deepEqual(entity.level2.vibeTags.includes("Street-style"), true);
  assert.deepEqual(entity.level2.vibeTags.includes("Trending"), true);
  assert.deepEqual(entity.level2.vibeTags.includes("random_unknown"), false);
  assert.deepEqual(entity.tags.includes("Street-style"), true);
});

test("normalizer attaches intent and maps old categories to new l1", () => {
  const out = normalizeIntelligenceOutput({
    source: { platform: "instagram", sourceType: "sightseeing_recommendation" },
    entities: [
      {
        category: "see",
        name: "Tumpak Sewu Waterfall",
        entityType: "waterfall",
        sourceEvidence: "Most stunning waterfall I have visited. Waterfall viewpoint.",
        confidence: "high",
        details: {
          placeType: "waterfall",
          experienceTag: "viewpoint",
        },
        intent: {
          l1: "explore",
          l2: "Waterfall",
          l3: ["Waterfall viewpoint", "Bridge view", "Good view", "Too many words for a micro intent"],
        },
      },
    ],
  });

  assert.equal(out.entities[0]?.intent?.l1, "explore");
  assert.equal(out.entities[0]?.intent?.l2, "Waterfall");
  assert.deepEqual(out.entities[0]?.intent?.l3, ["Waterfall viewpoint", "Bridge view"]);
});

test("normalizer repairs invalid l2 and removes saved visited from intent", () => {
  const out = normalizeIntelligenceOutput({
    source: { platform: "website", sourceType: "restaurant_recommendation" },
    entities: [
      {
        category: "eat",
        name: "Beige",
        entityType: "cafe",
        sourceEvidence: "Coffee spot in Marathahalli",
        confidence: "medium",
        intent: {
          l1: "taste",
          l2: "Saved",
          l3: ["Saved", "Coffee spot", "Visited", "Marathahalli hangout"],
        },
      },
    ],
  });

  assert.equal(out.entities[0]?.intent?.l1, "taste");
  assert.equal(out.entities[0]?.intent?.l2, "Cafe");
  assert.deepEqual(out.entities[0]?.intent?.l3, ["Coffee spot", "Marathahalli hangout"]);
});

test("sanitizer rejects instagram metadata boilerplate place names", () => {
  assert.equal(
    isInstagramMetadataBoilerplateName("8,041 likes, 29 comments - rishikarajputchaudhary on April 19, 2026: \"Cutes"),
    true,
  );
  assert.equal(
    isInstagramMetadataBoilerplateName("&quot;8,041 likes, 29 comments - creator on April 19, 2026&quot;"),
    true,
  );
});

test("sanitizer keeps normal venue names", () => {
  assert.equal(isInstagramMetadataBoilerplateName("Queen's Pod"), false);
  assert.equal(isInstagramMetadataBoilerplateName("Eva Cafe"), false);
  assert.equal(isInstagramMetadataBoilerplateName("The Travel Cafe Gangtok"), false);
});

test("sanitizer replaces rejected only entity with safe placeholder", () => {
  const sanitized = sanitizeIntelligenceOutputEntityNames({
    source: {
      url: "https://www.instagram.com/p/test",
      platform: "instagram",
      title: "Untitled",
      creator: null,
      sourceType: "mixed_discovery",
    },
    placeCollections: [],
    categoriesPresent: ["eat"],
    weakMentions: [],
    showIn: { eat: true, do: false, stay: false, see: false },
    structuredEntities: [
      {
        name: "8,041 likes, 29 comments - rishikarajputchaudhary on April 19, 2026: \"Cutes",
        category: "eat",
        locality: "Tadong",
        city: "Gangtok",
        state: "Sikkim",
        country: "India",
        address: null,
        confidence: "medium",
        googleMapsQuery: "bad query",
        evidenceText: "metadata",
      },
    ],
    entities: [
      {
        category: "eat",
        name: "8,041 likes, 29 comments - rishikarajputchaudhary on April 19, 2026: \"Cutes",
        entityType: "place",
        city: "Gangtok",
        state: "Sikkim",
        country: "India",
        locality: "Tadong",
        tags: [],
        details: {},
        level2: { category: "eat", cuisineType: null, mealType: null, dietaryTags: [], vibeTags: [], priceTier: null },
        googleMapsQuery: "bad query",
        sourceEvidence: "metadata",
        confidence: "medium",
      },
    ],
    visibility: {
      showIn: ["eat"],
      doNotShowIn: ["do", "stay", "see"],
      reason: "Original reason",
    },
    status: "ready",
  });

  assert.equal(sanitized.events.length, 1);
  assert.equal(sanitized.output.structuredEntities[0]?.name, "Detected place");
  assert.equal(sanitized.output.structuredEntities[0]?.confidence, "low");
  assert.equal(sanitized.output.entities[0]?.name, "Detected place");
  assert.equal(sanitized.output.status, "needs_review");
  assert.equal(sanitized.output.visibility.reason, "instagram_metadata_boilerplate");
});
