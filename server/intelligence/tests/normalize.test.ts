import assert from "node:assert/strict";
import test from "node:test";
import { normalizeIntelligenceOutput } from "../normalize";

test("normalizer maps aliases, dedupes, clamps confidence and sets categoriesPresent", () => {
  const out = normalizeIntelligenceOutput({
    source: { platform: "youtube", sourceType: "travel_discovery_video", title: "Trip", creator: "A" },
    categoriesPresent: ["food"],
    weakMentions: ["food"],
    entities: [
      {
        category: "food",
        name: "Eco Park",
        entityType: "park_activity",
        city: "Patna",
        tags: ["boating"],
        details: {},
        sourceEvidence: "boating and cycling",
        confidence: 1.7,
      },
      {
        category: "do",
        name: "Eco Park",
        entityType: "park_activity",
        city: "Patna",
        tags: ["cycling"],
        details: {},
        sourceEvidence: "cycling",
        confidence: -1,
      },
    ],
  });

  assert.equal(out.entities.length, 2);
  assert.deepEqual(out.categoriesPresent.sort(), ["do", "eat"].sort());
  assert.equal(out.entities[0].confidence <= 1 && out.entities[0].confidence >= 0, true);
  assert.equal(out.entities[1].confidence <= 1 && out.entities[1].confidence >= 0, true);
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
  assert.equal(out.weakMentions.includes("eat"), true);
  assert.equal(out.status, "no_supported_entity_found");
});
