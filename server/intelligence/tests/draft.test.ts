import assert from "node:assert/strict";
import test from "node:test";
import { buildDraftIntelligenceOutput, inferOcrHeuristicCandidate } from "../draft";

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
