import assert from "node:assert/strict";
import test from "node:test";
import { postProcessTinyCaptionOutput } from "../pipeline";
import type { IntelligenceOutput, IntelligenceRequest } from "../types";

function buildInstagramReq(description: string): IntelligenceRequest {
  return {
    source: {
      mode: "deep",
      metadata: {
        sourceUrl: "https://www.instagram.com/p/test/",
        canonicalUrl: "https://www.instagram.com/p/test",
        platform: "instagram",
        title: "Instagram caption test",
        description,
        siteName: "Instagram",
        imageUrl: null,
        fetchedAtIso: new Date().toISOString(),
        provider: "instagram_script",
      },
      transcript: { attempted: false, used: false, source: null, text: "", reason: null },
      ocr: { attempted: false, used: false, text: "", reason: null },
      source: "https://www.instagram.com/p/test/",
      platform: "instagram",
      canonicalUrl: "https://www.instagram.com/p/test",
    },
  };
}

function buildTinyOutput(name = "The Fresh Factory"): IntelligenceOutput {
  return {
    source: {
      url: "https://www.instagram.com/p/test",
      platform: "instagram",
      title: "Instagram caption test",
      creator: null,
      sourceType: "mixed_discovery",
    },
    placeCollections: [],
    categoriesPresent: ["eat"],
    weakMentions: [],
    showIn: { eat: true, do: false, stay: false, see: false },
    structuredEntities: [
      {
        name,
        category: "eat",
        locality: null,
        city: "Bengaluru",
        state: "Karnataka",
        country: "India",
        address: null,
        confidence: "medium",
        googleMapsQuery: `${name} Bengaluru`,
        evidenceText: "Derived from caption evidence",
        intent: { l1: "taste", l2: "Restaurant", l3: [] },
      },
    ],
    entities: [
      {
        category: "eat",
        name,
        entityType: "place",
        city: "Bengaluru",
        state: "Karnataka",
        country: "India",
        locality: null,
        tags: [],
        details: {},
        level2: {
          category: "eat",
          cuisineType: null,
          mealType: null,
          dietaryTags: [],
          vibeTags: [],
          priceTier: null,
        },
        intent: { l1: "taste", l2: "Restaurant", l3: [] },
        googleMapsQuery: `${name} Bengaluru`,
        sourceEvidence: "Derived from caption evidence",
        confidence: "medium",
      },
    ],
    visibility: {
      showIn: ["eat"],
      doNotShowIn: ["do", "stay", "see"],
      reason: "Derived from tiny caption response.",
    },
    status: "ready",
  };
}

test("tiny fast path post-processing expands recommendation captions into multiple cards", () => {
  const req = buildInstagramReq(
    "Farmers market at 6 am @thefreshfactoryindia with live music set by @denoykp @lional_lishoy\n\nMy top recommendations /\n@superbrew.in for authentic Japanese ceremonial grade matcha\n@nariandkage for freshly made cheese and spreads\n@sprout.og loved their mornings buns and multigrain cookies",
  );

  const result = postProcessTinyCaptionOutput(buildTinyOutput(), req);

  assert.equal(result.structuredEntities.length, 4);
  assert.deepEqual(
    result.structuredEntities.map((entity) => entity.name),
    ["The Fresh Factory", "Superbrew", "Nariandkage", "Sprout"],
  );
});

test("tiny fast path post-processing does not create fake place cards for creator handles alone", () => {
  const req = buildInstagramReq(
    "Morning walk with @creatorone and @creatortwo\n\nFollow @bloggerdaily for more city updates",
  );

  const result = postProcessTinyCaptionOutput(buildTinyOutput("Single Place"), req);

  assert.equal(result.structuredEntities.length, 1);
  assert.deepEqual(
    result.structuredEntities.map((entity) => entity.name),
    ["Single Place"],
  );
});
