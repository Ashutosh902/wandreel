import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryIntelligenceJobStore } from "../jobStore";
import { applyVisualEntityFallback } from "../pipeline";
import type { IntelligenceOutput, IntelligenceRequest } from "../types";

test("async store creates and transitions job states", async () => {
  class FakeStore extends InMemoryIntelligenceJobStore {}
  const store = new FakeStore();

  const job = await store.create({
    source: {
      mode: "quick",
      metadata: {
        sourceUrl: "https://example.com",
        canonicalUrl: "https://example.com/",
        platform: "web",
        title: "Example",
        description: "",
        siteName: null,
        imageUrl: null,
        fetchedAtIso: new Date().toISOString(),
        provider: "html",
      },
      transcript: null,
      ocr: null,
      source: "https://example.com",
      platform: "web",
      canonicalUrl: "https://example.com/",
    },
  });

  assert.ok(["queued", "running"].includes(job.status));

  await new Promise((resolve) => setTimeout(resolve, 50));
  const latest = await store.get(job.id);
  assert.ok(latest);
  assert.ok(["running", "completed", "failed"].includes(latest!.status));
});

test("intelligence promotes scenic visual fallback into a reviewable see entity", async () => {
  const req: IntelligenceRequest = {
    source: {
      mode: "deep",
      metadata: {
        sourceUrl: "https://www.instagram.com/p/test/",
        canonicalUrl: "https://www.instagram.com/p/test",
        platform: "instagram",
        title: "Untitled",
        description: "Most stunning waterfall I have visited",
        siteName: "Instagram",
        imageUrl: "https://example.com/frame.jpg",
        fetchedAtIso: new Date().toISOString(),
        provider: "instagram_script",
      },
      transcript: { attempted: true, used: false, source: null, text: "", reason: "whisper_not_available" },
      ocr: { attempted: true, used: true, text: "You are crossing most dangerous bridge for the view", reason: null },
      visualFallback: {
        attempted: true,
        triggered: true,
        reason: null,
        provider: "shared_visual_fallback",
        confidence: "medium",
        needsReview: true,
        screenshots: [{ url: "https://example.com/frame.jpg", origin: "metadata_image", label: "Instagram" }],
        textQueries: ["Most stunning waterfall I have visited", "You are crossing most dangerous bridge for the view"],
        visualQueries: [],
        candidates: [
          {
            query: "Most stunning waterfall I have visited",
            source: "ocr_text",
            rationale: null,
            candidateName: null,
            formattedAddress: null,
            locality: null,
            city: null,
            state: null,
            country: null,
            placeId: null,
            lat: null,
            lng: null,
            verificationConfidence: "low",
            rankingScore: 0.6,
            matchedSignals: ["context:waterfall"],
          },
        ],
        selectedCandidate: {
          query: "Most stunning waterfall I have visited",
          source: "ocr_text",
          rationale: null,
          candidateName: null,
          formattedAddress: null,
          locality: null,
          city: null,
          state: null,
          country: null,
          placeId: null,
          lat: null,
          lng: null,
          verificationConfidence: "low",
          rankingScore: 0.6,
          matchedSignals: ["context:waterfall"],
        },
        summaryText: "Visual fallback candidate: Most stunning waterfall I have visited | confidence: medium | manual verification recommended",
      },
      source: "https://www.instagram.com/p/test/",
      platform: "instagram",
      canonicalUrl: "https://www.instagram.com/p/test",
      combinedTextRaw: "Most stunning waterfall I have visited\n\nYou are crossing most dangerous bridge for the view",
      combinedTextClean: "Most stunning waterfall I have visited\n\nYou are crossing most dangerous bridge for the view",
    },
  };

  const output: IntelligenceOutput = {
    source: {
      url: "https://www.instagram.com/p/test",
      platform: "instagram",
      title: "Untitled",
      creator: null,
      sourceType: "mixed_discovery",
    },
    placeCollections: [],
    categoriesPresent: [],
    weakMentions: [
      { text: "Most stunning waterfall I have visited", reason: "generic natural feature mention (waterfall)" },
    ],
    showIn: { eat: false, do: false, stay: false, see: false },
    structuredEntities: [],
    entities: [],
    visibility: { showIn: [], doNotShowIn: ["eat", "do", "stay", "see"], reason: "No supported entities found from current metadata." },
    status: "no_supported_entity_found",
  };

  const result = applyVisualEntityFallback(output, req);

  assert.equal(result.status, "needs_review");
  assert.equal(result.showIn.see, true);
  assert.equal(result.entities.length > 0, true);
  assert.equal(result.entities[0].category, "see");
});

test("intelligence uses named visual landmark candidate when extraction found one", async () => {
  const req: IntelligenceRequest = {
    source: {
      mode: "deep",
      metadata: {
        sourceUrl: "https://www.instagram.com/p/test/",
        canonicalUrl: "https://www.instagram.com/p/test",
        platform: "instagram",
        title: "Untitled",
        description: "Most stunning waterfall I have visited",
        siteName: "Instagram",
        imageUrl: "https://example.com/frame.jpg",
        fetchedAtIso: new Date().toISOString(),
        provider: "instagram_script",
      },
      transcript: { attempted: true, used: false, source: null, text: "", reason: "whisper_script_failed" },
      ocr: { attempted: true, used: true, text: "You are crossing most dangerous bridge for the view", reason: null },
      visualFallback: {
        attempted: true,
        triggered: true,
        reason: "vision_framewise_candidates",
        provider: "shared_visual_fallback",
        confidence: "medium",
        needsReview: true,
        screenshots: [{ url: "https://example.com/frame.jpg", origin: "video_frame", label: "frame_2", timestampSec: 5.3 }],
        textQueries: ["Most stunning waterfall I have visited"],
        visualQueries: ["Tumpak Sewu Waterfall Coban Sewu East Java"],
        candidates: [
          {
            query: "Tumpak Sewu Waterfall Coban Sewu East Java",
            source: "vision_search",
            rationale: "Distinctive multi-tiered waterfall in a deep cliff amphitheater with a suspension bridge viewpoint.",
            candidateName: "Tumpak Sewu Waterfall",
            aliases: ["Coban Sewu"],
            categoryHint: "see",
            locationHint: "East Java, Indonesia",
            formattedAddress: null,
            locality: null,
            city: null,
            state: "East Java",
            country: "Indonesia",
            placeId: null,
            lat: null,
            lng: null,
            visualEvidence: "Large curtain-style waterfall and iconic bridge viewpoint.",
            needsReview: true,
            locationVerified: false,
            verificationConfidence: "low",
            rankingScore: 0.71,
            matchedSignals: ["context:waterfall"],
          },
        ],
        selectedCandidate: {
          query: "Tumpak Sewu Waterfall Coban Sewu East Java",
          source: "vision_search",
          rationale: "Distinctive multi-tiered waterfall in a deep cliff amphitheater with a suspension bridge viewpoint.",
          candidateName: "Tumpak Sewu Waterfall",
          aliases: ["Coban Sewu"],
          categoryHint: "see",
          locationHint: "East Java, Indonesia",
          formattedAddress: null,
          locality: null,
          city: null,
          state: "East Java",
          country: "Indonesia",
          placeId: null,
          lat: null,
          lng: null,
          visualEvidence: "Large curtain-style waterfall and iconic bridge viewpoint.",
          needsReview: true,
          locationVerified: false,
          verificationConfidence: "low",
          rankingScore: 0.71,
          matchedSignals: ["context:waterfall"],
        },
        summaryText: "Visual fallback candidate: Tumpak Sewu Waterfall | aliases: Coban Sewu | location hint: East Java, Indonesia | location not verified | confidence: medium | manual verification recommended",
      },
      source: "https://www.instagram.com/p/test/",
      platform: "instagram",
      canonicalUrl: "https://www.instagram.com/p/test",
      combinedTextRaw: "Most stunning waterfall I have visited\n\nYou are crossing most dangerous bridge for the view",
      combinedTextClean: "Most stunning waterfall I have visited\n\nYou are crossing most dangerous bridge for the view",
    },
  };

  const output: IntelligenceOutput = {
    source: {
      url: "https://www.instagram.com/p/test",
      platform: "instagram",
      title: "Untitled",
      creator: null,
      sourceType: "mixed_discovery",
    },
    placeCollections: [],
    categoriesPresent: [],
    weakMentions: [],
    showIn: { eat: false, do: false, stay: false, see: false },
    structuredEntities: [],
    entities: [],
    visibility: { showIn: [], doNotShowIn: ["eat", "do", "stay", "see"], reason: "No supported entities found from current metadata." },
    status: "no_supported_entity_found",
  };

  const result = applyVisualEntityFallback(output, req);

  assert.equal(result.status, "needs_review");
  assert.equal(result.showIn.see, true);
  assert.equal(result.structuredEntities[0]?.name, "Tumpak Sewu Waterfall");
  assert.equal(result.entities[0]?.name, "Tumpak Sewu Waterfall");
  assert.equal(result.entities[0]?.googleMapsQuery, "Tumpak Sewu Waterfall Coban Sewu East Java");
});

test("intelligence keeps scenic reels generic when visual landmark candidates remain unverified", async () => {
  const req: IntelligenceRequest = {
    source: {
      mode: "deep",
      metadata: {
        sourceUrl: "https://www.instagram.com/p/test/",
        canonicalUrl: "https://www.instagram.com/p/test",
        platform: "instagram",
        title: "Untitled",
        description: "Most stunning waterfall I have visited",
        siteName: "Instagram",
        imageUrl: "https://example.com/frame.jpg",
        fetchedAtIso: new Date().toISOString(),
        provider: "instagram_script",
      },
      transcript: { attempted: true, used: false, source: null, text: "", reason: "whisper_script_failed" },
      ocr: { attempted: true, used: true, text: "You are crossing most dangerous bridge for the view", reason: null },
      visualFallback: {
        attempted: true,
        triggered: true,
        reason: "vision_framewise_candidates",
        provider: "shared_visual_fallback",
        confidence: "low",
        needsReview: true,
        screenshots: [{ url: "https://example.com/frame.jpg", origin: "video_frame", label: "frame_2", timestampSec: 5.3 }],
        textQueries: ["Most stunning waterfall I have visited"],
        visualQueries: ["Tumpak Sewu Waterfall Coban Sewu East Java", "Huangguoshu Waterfall Guizhou China"],
        candidates: [
          {
            query: "Tumpak Sewu Waterfall Coban Sewu East Java",
            source: "vision_search",
            rationale: "Possible landmark match from frame analysis.",
            candidateName: "Tumpak Sewu Waterfall",
            aliases: ["Coban Sewu"],
            categoryHint: "see",
            locationHint: "East Java, Indonesia",
            formattedAddress: null,
            locality: null,
            city: null,
            state: "East Java",
            country: "Indonesia",
            placeId: null,
            lat: null,
            lng: null,
            visualEvidence: "Large amphitheater waterfall and bridge viewpoint.",
            needsReview: true,
            locationVerified: false,
            verificationConfidence: "low",
            rankingScore: 0.42,
            matchedSignals: [],
            finalConfidence: "low",
            reason: "conflicting_visual_landmarks",
          },
          {
            query: "Huangguoshu Waterfall Guizhou China",
            source: "vision_search",
            rationale: "Possible landmark match from frame analysis.",
            candidateName: "Huangguoshu Waterfall",
            aliases: ["Huangguoshu Falls"],
            categoryHint: "see",
            locationHint: "Guizhou, China",
            formattedAddress: null,
            locality: null,
            city: null,
            state: "Guizhou",
            country: "China",
            placeId: null,
            lat: null,
            lng: null,
            visualEvidence: "Large amphitheater waterfall and bridge viewpoint.",
            needsReview: true,
            locationVerified: false,
            verificationConfidence: "low",
            rankingScore: 0.4,
            matchedSignals: [],
            finalConfidence: "low",
            reason: "conflicting_visual_landmarks",
          },
        ],
        selectedCandidate: null,
        summaryText: "Possible matches: Tumpak Sewu Waterfall | Huangguoshu Waterfall | location not verified | manual verification recommended",
      },
      source: "https://www.instagram.com/p/test/",
      platform: "instagram",
      canonicalUrl: "https://www.instagram.com/p/test",
      combinedTextRaw: "Most stunning waterfall I have visited\n\nYou are crossing most dangerous bridge for the view",
      combinedTextClean: "Most stunning waterfall I have visited\n\nYou are crossing most dangerous bridge for the view",
    },
  };

  const output: IntelligenceOutput = {
    source: {
      url: "https://www.instagram.com/p/test",
      platform: "instagram",
      title: "Untitled",
      creator: null,
      sourceType: "mixed_discovery",
    },
    placeCollections: [],
    categoriesPresent: [],
    weakMentions: [],
    showIn: { eat: false, do: false, stay: false, see: false },
    structuredEntities: [],
    entities: [],
    visibility: { showIn: [], doNotShowIn: ["eat", "do", "stay", "see"], reason: "No supported entities found from current metadata." },
    status: "no_supported_entity_found",
  };

  const result = applyVisualEntityFallback(output, req);

  assert.equal(result.status, "needs_review");
  assert.equal(result.showIn.see, true);
  assert.equal(result.entities[0]?.name, "Waterfall bridge viewpoint");
  assert.match(String(result.entities[0]?.sourceEvidence || ""), /Possible matches:/i);
});
