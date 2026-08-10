import test from "node:test";
import assert from "node:assert/strict";
import { extractPlaceKnowledgeFacts, extractPlaceKnowledgeResult, locateEvidenceSpan } from "./facts";
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
  assert.ok(facts.some((fact) => fact.structured?.kind === "crowd_note" && fact.structured.value === "crowded"));
  assert.ok(facts.some((fact) => fact.structured?.kind === "crowd_note" && fact.structured.qualifiers?.when === "weekends"));
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

test("extractPlaceKnowledgeFacts models an activity and its operator relationship", () => {
  const description = "The most beautiful boat ride experience of India. My tour was organised by my stay: Cardamom County, Thekkady.";
  const extraction = buildExtraction({
    metadata: {
      ...buildExtraction().metadata,
      description,
      commentEvidence: {
        attempted: false,
        timedOut: false,
        pinnedComment: null,
        topComments: [],
        provider: "instagram_script",
        reason: null,
      },
    },
    transcript: null,
    ocr: null,
  });

  const facts = extractPlaceKnowledgeFacts({ extraction, intelligence: buildIntelligence() });
  const activity = facts.find((fact) => fact.structured?.kind === "activity");
  const operator = facts.find((fact) => fact.structured?.kind === "operator");

  assert.equal(activity?.structured?.value, "boat ride");
  assert.equal(operator?.structured?.value, "Cardamom County");
  assert.deepEqual(operator?.structured?.qualifiers, {
    relationship: "organised_by",
    activity: "boat ride",
  });
  assert.equal(activity?.grounding?.evidenceText, "boat ride");
  assert.equal(activity?.grounding?.sourceField, "metadata.description");
  assert.equal(
    description.slice(activity?.grounding?.span.start, activity?.grounding?.span.end),
    activity?.grounding?.evidenceText,
  );
  assert.equal(operator?.grounding?.evidenceText, "My tour was organised by my stay: Cardamom County");
  assert.equal(
    description.slice(operator?.grounding?.span.start, operator?.grounding?.span.end),
    operator?.grounding?.evidenceText,
  );
});

test("extractPlaceKnowledgeFacts grounds OCR facts in the exact OCR text span", () => {
  const ocrText = "Welcome to Harbor House. Parking is limited on weekends. Entry fee is Rs 500.";
  const extraction = buildExtraction({
    metadata: {
      ...buildExtraction().metadata,
      description: "",
      commentEvidence: undefined,
    },
    transcript: null,
    ocr: {
      attempted: true,
      used: true,
      text: ocrText,
      reason: null,
      provider: "vision_ocr",
    },
  });

  const facts = extractPlaceKnowledgeFacts({ extraction, intelligence: null });
  const parking = facts.find((fact) => fact.structured?.kind === "parking");

  assert.equal(parking?.sourceSignal, "ocr");
  assert.equal(parking?.grounding?.sourceField, "ocr.text");
  assert.equal(parking?.grounding?.evidenceText, "Parking is limited");
  assert.equal(
    ocrText.slice(parking?.grounding?.span.start, parking?.grounding?.span.end),
    parking?.grounding?.evidenceText,
  );
});

test("extractPlaceKnowledgeFacts retains supporting visual frame references", () => {
  const extraction = buildExtraction({
    metadata: {
      ...buildExtraction().metadata,
      description: "",
      commentEvidence: undefined,
    },
    transcript: null,
    ocr: null,
    visualFallback: {
      attempted: true,
      triggered: true,
      reason: null,
      provider: "shared_visual_fallback",
      confidence: "high",
      needsReview: false,
      screenshots: [
        { url: "https://example.com/frame-1.jpg", origin: "video_frame", label: "frame-1", frameIndex: 1, timestampSec: 4.5 },
        { url: "https://example.com/frame-2.jpg", origin: "video_frame", label: "frame-2", frameIndex: 2, timestampSec: 9 },
      ],
      textQueries: [],
      visualQueries: [],
      candidates: [],
      selectedCandidate: {
        query: "Harbor House Goa",
        source: "vision_search",
        rationale: null,
        candidateName: "Harbor House",
        reason: "Parking is available near the entrance.",
        formattedAddress: "Goa",
        locality: null,
        city: "Goa",
        state: "Goa",
        country: "India",
        placeId: null,
        lat: null,
        lng: null,
        supportFrameLabels: ["frame-2"],
        verificationConfidence: "high",
        rankingScore: 0.92,
        matchedSignals: ["signage"],
      },
      summaryText: "Harbor House verified from signage.",
    },
  });

  const facts = extractPlaceKnowledgeFacts({ extraction, intelligence: null });
  const visualFact = facts.find((fact) => fact.sourceSignal === "visual");

  assert.deepEqual(visualFact?.grounding?.frameReferences, [
    { label: "frame-2", frameIndex: 2, timestampSec: 9 },
  ]);
  assert.equal(visualFact?.grounding?.supportType, "inferred");
  assert.equal(visualFact?.grounding?.validation.method, "visual_evidence_record");
});

test("extractPlaceKnowledgeFacts preserves transcript segment timestamps", () => {
  const extraction = buildExtraction({
    metadata: { ...buildExtraction().metadata, description: "", commentEvidence: undefined },
    transcript: {
      attempted: true,
      used: true,
      source: "whisper",
      text: "Go around 5 PM. Order the butter garlic prawns. Avoid weekends because it gets crowded.",
      reason: null,
      segments: [{
        text: "Go around 5 PM, order the butter garlic prawns, and avoid weekends because it gets crowded.",
        startMs: 21_000,
        endMs: 27_000,
      }],
    },
    ocr: null,
  });
  const facts = extractPlaceKnowledgeFacts({ extraction, intelligence: null });
  for (const kind of ["best_time", "recommended_item", "crowd_note"]) {
    const fact = facts.find((candidate) => candidate.structured?.kind === kind);
    assert.equal(fact?.grounding?.sourceField, "transcript.segments[0].text");
    assert.deepEqual(fact?.grounding?.sourceLocation, { startMs: 21_000, endMs: 27_000 });
    assert.equal(fact?.grounding?.supportType, "direct");
    assert.equal(fact?.grounding?.validation.status, "validated");
  }
  assert.equal(
    facts.find((fact) => fact.structured?.kind === "recommended_item")?.structured?.value,
    "butter garlic prawns",
  );
});

test("extractPlaceKnowledgeFacts preserves OCR frame and bounding-box location", () => {
  const extraction = buildExtraction({
    metadata: { ...buildExtraction().metadata, description: "", commentEvidence: undefined },
    transcript: null,
    ocr: {
      attempted: true,
      used: true,
      text: "Parking is difficult on weekends.",
      reason: null,
      provider: "frame_ocr",
      regions: [{
        text: "Parking is difficult on weekends.",
        frameLabel: "frame-2",
        frameIndex: 2,
        timestampSec: 8.4,
        boundingBox: { x: 10, y: 20, width: 300, height: 50 },
      }],
    },
  });
  const parking = extractPlaceKnowledgeFacts({ extraction, intelligence: null })
    .find((fact) => fact.structured?.kind === "parking");
  assert.deepEqual(parking?.grounding?.sourceLocation, {
    frameLabel: "frame-2",
    frameIndex: 2,
    timestampSec: 8.4,
    boundingBox: { x: 10, y: 20, width: 300, height: 50 },
  });
});

test("inferred support is explicit and lower confidence than a direct claim", () => {
  const extraction = buildExtraction({
    metadata: {
      ...buildExtraction().metadata,
      description: "We parked 800 metres away and walked to the entrance.",
      commentEvidence: undefined,
    },
    transcript: null,
    ocr: null,
  });
  const parking = extractPlaceKnowledgeFacts({ extraction, intelligence: null })
    .find((fact) => fact.structured?.kind === "parking");
  assert.equal(parking?.structured?.value, "difficult");
  assert.equal(parking?.grounding?.supportType, "inferred");
  assert.equal(parking?.confidenceScore, 0.52);
  assert.equal(parking?.grounding?.groundingConfidence, 0.62);
});

test("locateEvidenceSpan validates safely normalized HTML evidence", () => {
  const source = "Creator says: order the butter&nbsp;garlic prawns tonight.";
  const span = locateEvidenceSpan(source, "order the butter garlic prawns");
  assert.equal(span?.method, "normalized_span");
  assert.equal(source.slice(span?.start, span?.end), "order the butter&nbsp;garlic prawns");
});

test("extractPlaceKnowledgeResult rejects fabricated model evidence", () => {
  const intelligence = buildIntelligence();
  intelligence.output.entities[0].sourceEvidence = "Parking is difficult on weekends.";
  const extraction = buildExtraction({
    metadata: { ...buildExtraction().metadata, description: "A quiet waterfront cafe.", commentEvidence: undefined },
    transcript: null,
    ocr: null,
  });
  const result = extractPlaceKnowledgeResult({ extraction, intelligence });
  assert.equal(result.facts.some((fact) => fact.structured?.kind === "parking"), false);
  assert.deepEqual(result.rejections, [{
    sourceSignal: "intelligence",
    claimedEvidenceText: "Parking is difficult on weekends.",
    reason: "claimed_evidence_not_found_in_source",
    model: null,
  }]);
});

test("extractPlaceKnowledgeFacts emits canonical crowd, booking, and conditional ambience claims", () => {
  const extraction = buildExtraction({
    metadata: {
      ...buildExtraction().metadata,
      description: "Crowded on weekends. Booking is not required for the boat ride. The ambience is lively in the evening.",
      commentEvidence: undefined,
    },
    transcript: null,
    ocr: null,
  });
  const facts = extractPlaceKnowledgeFacts({ extraction, intelligence: null });
  const crowd = facts.find((fact) => fact.structured?.kind === "crowd_note");
  const booking = facts.find((fact) => fact.structured?.kind === "booking_required");
  const ambience = facts.find((fact) => fact.structured?.kind === "ambience");
  assert.deepEqual(crowd?.structured, { kind: "crowd_note", value: "crowded", qualifiers: { when: "weekends" } });
  assert.deepEqual(booking?.structured, { kind: "booking_required", value: "false", qualifiers: { activity: "boat ride" } });
  assert.deepEqual(ambience?.structured, { kind: "ambience", value: "lively", qualifiers: { when: "evening" } });
});
