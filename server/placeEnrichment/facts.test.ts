import test from "node:test";
import assert from "node:assert/strict";
import { extractPlaceKnowledgeFacts } from "./facts";
import type { ExtractionResult } from "../extraction/types";
import type { IntelligencePipelineResult } from "../intelligence/types";

function buildExtraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    mode: "deep",
    metadata: {
      sourceUrl: "https://www.instagram.com/p/example/",
      canonicalUrl: "https://www.instagram.com/p/example/",
      platform: "instagram",
      title: "Sample reel",
      description: "Best time to visit is early morning. Parking is available nearby. Must try the cold coffee.",
      siteName: "Instagram",
      imageUrl: "https://example.com/a.jpg",
      fetchedAtIso: "2026-08-02T00:00:00.000Z",
      provider: "instagram_script",
      commentEvidence: {
        attempted: true,
        timedOut: false,
        pinnedComment: "Go before 8am to avoid the crowd.",
        topComments: ["The vibe is super cozy inside."],
        provider: "instagram_script",
        reason: null,
      },
    },
    transcript: {
      attempted: true,
      used: true,
      source: "whisper",
      text: "We loved the sunset view and you should book in advance on weekends.",
      reason: null,
    },
    ocr: {
      attempted: true,
      used: true,
      text: "Family restaurant",
      reason: null,
    },
    source: "https://www.instagram.com/p/example/",
    platform: "instagram",
    canonicalUrl: "https://www.instagram.com/p/example/",
    ...overrides,
  };
}

function buildIntelligence(): IntelligencePipelineResult {
  return {
    output: {
      source: {
        url: "https://www.instagram.com/p/example/",
        platform: "instagram",
        title: "Sample reel",
        creator: null,
        sourceType: "mixed_discovery",
      },
      placeCollections: [],
      categoriesPresent: ["eat"],
      weakMentions: [],
      showIn: { eat: true, do: false, stay: false, see: false },
      structuredEntities: [{
        name: "Cafe Aurora",
        category: "eat",
        locality: "Anjuna",
        city: "Goa",
        state: "Goa",
        country: "India",
        address: "Anjuna, Goa",
        confidence: "high",
        googleMapsQuery: "Cafe Aurora Anjuna Goa",
        evidenceText: "Caption evidence",
      }],
      entities: [{
        category: "eat",
        name: "Cafe Aurora",
        entityType: "place",
        city: "Goa",
        state: "Goa",
        country: "India",
        locality: "Anjuna",
        tags: [],
        details: {},
        level2: {
          category: "eat",
          cuisineType: "Cafe",
          mealType: null,
          dietaryTags: [],
          vibeTags: [],
          priceTier: null,
        },
        googleMapsQuery: "Cafe Aurora Anjuna Goa",
        sourceEvidence: "Caption evidence",
        confidence: "high",
      }],
      visibility: { showIn: ["eat"], doNotShowIn: ["do", "stay", "see"], reason: null },
      status: "ready",
    },
    validationErrors: [],
    fixed: false,
  };
}

test("extractPlaceKnowledgeFacts classifies reusable structured facts from multiple signals", () => {
  const facts = extractPlaceKnowledgeFacts({
    extraction: buildExtraction(),
    intelligence: buildIntelligence(),
  });

  assert.ok(facts.some((fact) => fact.category === "timing" && /early morning/i.test(fact.text)));
  assert.ok(facts.some((fact) => fact.category === "accessibility" && /parking/i.test(fact.text)));
  assert.ok(facts.some((fact) => fact.category === "food" && /cold coffee/i.test(fact.text)));
  assert.ok(facts.some((fact) => fact.category === "warnings" && /avoid the crowd/i.test(fact.text)));
  assert.ok(facts.some((fact) => fact.category === "atmosphere" && /cozy/i.test(fact.text)));
  assert.ok(facts.some((fact) => fact.category === "recommendations" && /should book/i.test(fact.text)));
  assert.ok(facts.some((fact) => fact.structured?.kind === "best_time" && /early morning/i.test(fact.structured.value)));
  assert.ok(facts.some((fact) => fact.structured?.kind === "parking" && /available/i.test(fact.structured.value)));
  assert.ok(facts.some((fact) => fact.structured?.kind === "recommended_item" && /cold coffee/i.test(fact.structured.value)));
});

test("extractPlaceKnowledgeFacts emits queryable contextual facts for timing, dish, crowd, and seating guidance", () => {
  const extraction = buildExtraction({
    metadata: {
      ...buildExtraction().metadata,
      description: "Go around 5 PM, order the butter garlic prawns, avoid weekends because it gets crowded, and sit upstairs for the sunset view.",
      commentEvidence: {
        attempted: true,
        timedOut: false,
        pinnedComment: null,
        topComments: [],
        provider: "instagram_script",
        reason: null,
      },
    },
    transcript: {
      attempted: true,
      used: true,
      source: "whisper",
      text: "Go around 5 PM, order the butter garlic prawns, avoid weekends because it gets crowded, and sit upstairs for the sunset view.",
      reason: null,
    },
    ocr: {
      attempted: true,
      used: false,
      text: "",
      reason: "vision_ocr_empty",
    },
  });

  const facts = extractPlaceKnowledgeFacts({
    extraction,
    intelligence: buildIntelligence(),
  });

  assert.ok(facts.some((fact) => fact.structured?.kind === "best_time" && fact.structured.value === "5 PM"));
  assert.ok(facts.some((fact) => fact.structured?.kind === "recommended_item" && /butter garlic prawns/i.test(fact.structured.value)));
  assert.ok(facts.some((fact) => fact.structured?.kind === "crowd_note" && /weekends gets crowded/i.test(fact.structured.value)));
  assert.ok(facts.some((fact) => fact.structured?.kind === "seating_tip" && /upstairs/i.test(fact.structured.value)));
  assert.ok(facts.some((fact) => fact.structured?.kind === "seating_tip" && /sunset view/i.test(String(fact.structured.qualifiers?.benefit || ""))));
});

test("extractPlaceKnowledgeFacts captures parking difficulty and price-style phrasing", () => {
  const extraction = buildExtraction({
    metadata: {
      ...buildExtraction().metadata,
      description: "Parking is difficult on weekends, but valet is available after 6 PM. Expect mains around Rs 700.",
      commentEvidence: {
        attempted: true,
        timedOut: false,
        pinnedComment: null,
        topComments: [],
        provider: "instagram_script",
        reason: null,
      },
    },
    transcript: {
      attempted: true,
      used: false,
      source: null,
      text: "",
      reason: "unsupported_platform",
    },
  });

  const facts = extractPlaceKnowledgeFacts({
    extraction,
    intelligence: buildIntelligence(),
  });

  assert.ok(facts.some((fact) => fact.structured?.kind === "parking" && /difficult/i.test(fact.structured.value)));
  assert.ok(facts.some((fact) => fact.structured?.kind === "parking" && /weekends/i.test(String(fact.structured.qualifiers?.when || ""))));
  assert.ok(facts.some((fact) => fact.structured?.kind === "pricing" && /rs\.?\s*700/i.test(fact.structured.value)));
});

test("extractPlaceKnowledgeFacts does not infer best_time from a place name or scenic view", () => {
  const extraction = buildExtraction({
    metadata: {
      ...buildExtraction().metadata,
      title: "Sunset Deck Seafood House",
      description: "The upstairs deck offers a sunset view.",
      commentEvidence: {
        attempted: false,
        timedOut: false,
        pinnedComment: null,
        topComments: [],
        creatorReplies: [],
        provider: "instagram_script",
        reason: null,
      },
    },
    transcript: {
      attempted: true,
      used: true,
      source: "whisper",
      text: "We loved the sunset view.",
      reason: null,
    },
  });

  const facts = extractPlaceKnowledgeFacts({ extraction, intelligence: buildIntelligence() });
  assert.equal(facts.some((fact) => fact.structured?.kind === "best_time"), false);
});
