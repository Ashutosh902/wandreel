import assert from "node:assert/strict";
import test from "node:test";
import { normalizeIntelligenceOutput } from "../normalize";

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
