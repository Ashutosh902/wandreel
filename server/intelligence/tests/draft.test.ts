import assert from "node:assert/strict";
import test from "node:test";
import { buildDraftIntelligenceOutput, inferOcrHeuristicCandidate } from "../draft";
import { prioritizeOcrVenueEntities } from "../pipeline";

test("draft heuristic prefers scenic Explore places over Instagram boilerplate", () => {
  const output = buildDraftIntelligenceOutput({
    mode: "deep",
    metadata: {
      sourceUrl: "https://www.instagram.com/p/C-xouRYyyEY/",
      canonicalUrl: "https://www.instagram.com/p/C-xouRYyyEY/",
      platform: "instagram",
      title: "Amit Dhiman on Instagram: &quot;Follow &#064;amit_dhiman___ for such videos",
      description:
        "Nandi Hills is a set of breathtaking hillocks which is a complete nature retreat. From catching the stunning views of the rising and setting sun to camping and trekking, people come here to indulge in a wide variety of activities. The best part of visiting the top of the hill is that you will get to enjoy the view of low lying clouds floating around you. #bangalore #nandihills #sunrise #naturelovers #roadtrip",
      siteName: "Instagram",
      imageUrl: null,
      fetchedAtIso: new Date().toISOString(),
      provider: "instagram_script",
    },
    transcript: null,
    ocr: null,
    source: "https://www.instagram.com/p/C-xouRYyyEY/",
    platform: "instagram",
    canonicalUrl: "https://www.instagram.com/p/C-xouRYyyEY/",
    combinedTextRaw: "",
    combinedTextClean: "",
  });

  assert.equal(output.structuredEntities.length, 1);
  assert.equal(output.structuredEntities[0].name, "Nandi Hills");
  assert.equal(output.structuredEntities[0].category, "see");
});

test("ocr heuristic prefers venue-like candidate over slogan-like copy", () => {
  const candidate = inferOcrHeuristicCandidate({
    mode: "deep",
    metadata: {
      sourceUrl: "https://example.com/reel",
      canonicalUrl: "https://example.com/reel",
      platform: "instagram",
      title: "Untitled",
      description: "",
      siteName: "Instagram",
      imageUrl: null,
      fetchedAtIso: new Date().toISOString(),
      provider: "instagram_script",
    },
    transcript: null,
    ocr: {
      attempted: true,
      used: true,
      text: "YOU, ME & COFFEE BY THE SEA\nEva cafe, Anjuna\nMy HAPPY PLACE",
      reason: null,
    },
    source: "https://example.com/reel",
    platform: "instagram",
    canonicalUrl: "https://example.com/reel",
    combinedTextRaw: "",
    combinedTextClean: "",
  });

  assert.ok(candidate);
  assert.equal(candidate?.name, "Eva Cafe");
  assert.equal(candidate?.locality, "Anjuna");
});

test("draft heuristic returns needs_review when OCR is only slogan-like generic copy", () => {
  const output = buildDraftIntelligenceOutput({
    mode: "deep",
    metadata: {
      sourceUrl: "https://example.com/reel",
      canonicalUrl: "https://example.com/reel",
      platform: "instagram",
      title: "Creator on Instagram: vibes",
      description: "✨",
      siteName: "Instagram",
      imageUrl: null,
      fetchedAtIso: new Date().toISOString(),
      provider: "instagram_script",
    },
    transcript: { attempted: false, used: false, source: null, text: "", reason: "not_attempted" },
    ocr: {
      attempted: true,
      used: true,
      text: "YOU, ME & COFFEE BY THE SEA\nMY HAPPY PLACE",
      reason: null,
    },
    source: "https://example.com/reel",
    platform: "instagram",
    canonicalUrl: "https://example.com/reel",
    combinedTextRaw: "",
    combinedTextClean: "",
  });

  assert.equal(output.status, "needs_review");
  assert.equal(output.structuredEntities[0].name, "Detected place");
  assert.equal(output.structuredEntities[0].evidenceText, "OCR text insufficient");
});

test("generic caption phrase must not become entity name", () => {
  const output = buildDraftIntelligenceOutput({
    mode: "deep",
    metadata: {
      sourceUrl: "https://example.com/reel",
      canonicalUrl: "https://example.com/reel",
      platform: "instagram",
      title: "Untitled",
      description: "Cutest pinteresty cafe in Sikkim",
      siteName: "Instagram",
      imageUrl: null,
      fetchedAtIso: new Date().toISOString(),
      provider: "instagram_script",
      commentEvidence: {
        attempted: true,
        timedOut: false,
        pinnedComment: null,
        topComments: [],
        creatorReplies: [],
        commentsFetchedCount: 0,
        commentRepliesFetchedCount: 0,
        creatorReplyCount: 0,
        provider: "instagram_script",
        reason: null,
      },
    },
    transcript: null,
    ocr: null,
    source: "https://example.com/reel",
    platform: "instagram",
    canonicalUrl: "https://example.com/reel",
    combinedTextRaw: "",
    combinedTextClean: "",
  });

  assert.equal(output.structuredEntities[0].name, "Detected place");
  assert.equal(output.visibility.reason, "caption_has_category_no_venue_name");
});

test("metadata boilerplate must not become entity name", () => {
  const output = buildDraftIntelligenceOutput({
    mode: "deep",
    metadata: {
      sourceUrl: "https://example.com/reel",
      canonicalUrl: "https://example.com/reel",
      platform: "instagram",
      title: "8041 likes, 29 comments - rishikarajputchaudhary on April 19, 2026",
      description: "",
      siteName: "Instagram",
      imageUrl: null,
      fetchedAtIso: new Date().toISOString(),
      provider: "instagram_script",
      commentEvidence: {
        attempted: false,
        timedOut: false,
        pinnedComment: null,
        topComments: [],
        creatorReplies: [],
        commentsFetchedCount: 0,
        commentRepliesFetchedCount: 0,
        creatorReplyCount: 0,
        provider: "instagram_script",
        reason: null,
      },
    },
    transcript: null,
    ocr: null,
    source: "https://example.com/reel",
    platform: "instagram",
    canonicalUrl: "https://example.com/reel",
    combinedTextRaw: "",
    combinedTextClean: "",
  });

  assert.equal(output.structuredEntities[0].name, "Detected place");
});

test("creator reply venue address outranks generic caption text", () => {
  const output = buildDraftIntelligenceOutput({
    mode: "deep",
    metadata: {
      sourceUrl: "https://example.com/reel",
      canonicalUrl: "https://example.com/reel",
      platform: "instagram",
      title: "Untitled",
      description: "Cutest pinteresty cafe in Sikkim",
      siteName: "Instagram",
      imageUrl: null,
      fetchedAtIso: new Date().toISOString(),
      provider: "instagram_script",
      commentEvidence: {
        attempted: true,
        timedOut: false,
        pinnedComment: null,
        topComments: [],
        creatorReplies: ["Queen's Pod, 16 Adampool, Lumsey, Tadong, Gangtok, Sikkim 737102"],
        commentsFetchedCount: 1,
        commentRepliesFetchedCount: 1,
        creatorReplyCount: 1,
        provider: "instagram_script",
        reason: null,
      },
    },
    transcript: null,
    ocr: null,
    source: "https://example.com/reel",
    platform: "instagram",
    canonicalUrl: "https://example.com/reel",
    combinedTextRaw: "",
    combinedTextClean: "",
  });

  assert.equal(output.structuredEntities[0].name, "Queen's Pod");
  assert.equal(output.structuredEntities[0].locality, "Tadong");
  assert.equal(output.status, "ready");
});

test("final OCR ranking keeps venue-like entity ahead of slogan-like output", () => {
  const source = {
    mode: "deep",
    metadata: {
      sourceUrl: "https://example.com/reel",
      canonicalUrl: "https://example.com/reel",
      platform: "instagram",
      title: "Untitled",
      description: "",
      siteName: "Instagram",
      imageUrl: null,
      fetchedAtIso: new Date().toISOString(),
      provider: "instagram_script",
    },
    transcript: null,
    ocr: {
      attempted: true,
      used: true,
      text: "YOU, ME & COFFEE: BY THE SEA Eva \" cafe Anjua\nYOU, ME & COFFEE BY THE SEA Lvatale Anjuna Ry ICE",
      reason: null,
    },
    source: "https://example.com/reel",
    platform: "instagram",
    canonicalUrl: "https://example.com/reel",
    combinedTextRaw: "",
    combinedTextClean: "",
  } as const;

  const output = prioritizeOcrVenueEntities({
    source: {
      url: "https://example.com/reel",
      platform: "instagram",
      title: null,
      creator: null,
      sourceType: "mixed_discovery",
    },
    placeCollections: [],
    categoriesPresent: ["eat"],
    weakMentions: [],
    showIn: { eat: true, do: false, stay: false, see: false },
    structuredEntities: [
      {
        name: "YOU, ME & COFFEE: BY THE SEA",
        category: "eat",
        locality: null,
        city: null,
        state: null,
        country: "India",
        address: null,
        confidence: "high",
        googleMapsQuery: "YOU, ME & COFFEE: BY THE SEA",
        evidenceText: "OCR line",
      },
      {
        name: "Eva Cafe",
        category: "eat",
        locality: "Anjuna",
        city: null,
        state: null,
        country: "India",
        address: null,
        confidence: "medium",
        googleMapsQuery: "Eva Cafe Anjuna",
        evidenceText: "OCR line",
      },
    ],
    entities: [],
    visibility: {
      showIn: ["eat"],
      doNotShowIn: ["do", "stay", "see"],
      reason: "Model output",
    },
    status: "ready",
  }, source);

  assert.equal(output.structuredEntities[0]?.name, "Eva Cafe");
  assert.equal(output.structuredEntities.some((entity) => entity.name === "YOU, ME & COFFEE: BY THE SEA"), false);
});

test("final OCR ranking suppresses slogan-only OCR entities into needs_review", () => {
  const source = {
    mode: "deep",
    metadata: {
      sourceUrl: "https://example.com/reel",
      canonicalUrl: "https://example.com/reel",
      platform: "instagram",
      title: "Creator on Instagram: vibes",
      description: "✨",
      siteName: "Instagram",
      imageUrl: null,
      fetchedAtIso: new Date().toISOString(),
      provider: "instagram_script",
    },
    transcript: { attempted: false, used: false, source: null, text: "", reason: "not_attempted" },
    ocr: {
      attempted: true,
      used: true,
      text: "YOU, ME & COFFEE\nMY HAPPY PLACE",
      reason: null,
    },
    source: "https://example.com/reel",
    platform: "instagram",
    canonicalUrl: "https://example.com/reel",
    combinedTextRaw: "",
    combinedTextClean: "",
  } as const;

  const output = prioritizeOcrVenueEntities({
    source: {
      url: "https://example.com/reel",
      platform: "instagram",
      title: null,
      creator: null,
      sourceType: "mixed_discovery",
    },
    placeCollections: [],
    categoriesPresent: ["eat"],
    weakMentions: [],
    showIn: { eat: true, do: false, stay: false, see: false },
    structuredEntities: [
      {
        name: "YOU, ME & COFFEE",
        category: "eat",
        locality: null,
        city: null,
        state: null,
        country: "India",
        address: null,
        confidence: "high",
        googleMapsQuery: "YOU, ME & COFFEE",
        evidenceText: "OCR line",
      },
    ],
    entities: [],
    visibility: {
      showIn: ["eat"],
      doNotShowIn: ["do", "stay", "see"],
      reason: "Model output",
    },
    status: "ready",
  }, source);

  assert.equal(output.status, "needs_review");
  assert.equal(output.structuredEntities.length, 0);
  assert.equal(output.visibility.reason, "OCR text insufficient");
});
