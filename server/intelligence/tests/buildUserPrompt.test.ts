import assert from "node:assert/strict";
import test from "node:test";
import { buildUserPrompt } from "../prompts";
import type { ExtractionResult } from "../../extraction/types";

function buildSource(): ExtractionResult {
  return {
    mode: "deep",
    metadata: {
      sourceUrl: "https://example.com/reel",
      canonicalUrl: "https://example.com/reel",
      platform: "instagram",
      title: "Best hidden cafe in Patna",
      description: "DM for location",
      siteName: "Instagram",
      imageUrl: "https://example.com/cover.jpg",
      fetchedAtIso: new Date().toISOString(),
      provider: "instagram_script",
    },
    transcript: { attempted: true, used: false, source: null, text: "", reason: "transcript_not_available" },
    ocr: { attempted: true, used: false, text: "", reason: "ocr_text_empty" },
    visualFallback: {
      attempted: true,
      triggered: true,
      reason: null,
      provider: "shared_visual_fallback",
      confidence: "medium",
      needsReview: true,
      screenshots: [{ url: "https://example.com/cover.jpg", origin: "metadata_image", label: "Instagram" }],
      textQueries: [],
      visualQueries: ["Cafe Delhi Heights Patna"],
      candidates: [
        {
          query: "Cafe Delhi Heights Patna",
          source: "vision_search",
          rationale: "Visible storefront text suggests Delhi Heights.",
          candidateName: "Cafe Delhi Heights",
          formattedAddress: "Boring Road, Patna, Bihar, India",
          locality: "Boring Road",
          city: "Patna",
          state: "Bihar",
          country: "India",
          placeId: "abc123",
          lat: 25.61,
          lng: 85.12,
          verificationConfidence: "medium",
          rankingScore: 0.71,
          matchedSignals: ["name:cafe", "location:patna"],
        },
      ],
      selectedCandidate: {
        query: "Cafe Delhi Heights Patna",
        source: "vision_search",
        rationale: "Visible storefront text suggests Delhi Heights.",
        candidateName: "Cafe Delhi Heights",
        formattedAddress: "Boring Road, Patna, Bihar, India",
        locality: "Boring Road",
        city: "Patna",
        state: "Bihar",
        country: "India",
        placeId: "abc123",
        lat: 25.61,
        lng: 85.12,
        verificationConfidence: "medium",
        rankingScore: 0.71,
        matchedSignals: ["name:cafe", "location:patna"],
      },
      summaryText: "Visual fallback candidate: Cafe Delhi Heights | address: Boring Road, Patna, Bihar, India | confidence: medium | manual verification recommended",
    },
    source: "https://example.com/reel",
    platform: "instagram",
    canonicalUrl: "https://example.com/reel",
    stageStatus: {
      basicMetadata: "success",
      caption: "success",
      transcript: "partial",
      ocr: "partial",
      visualFallback: "success",
    },
    stages: {
      basicMetadata: { status: "success", provider: "instagram_script", reason: null, chars: 40 },
      caption: { status: "success", provider: "instagram_script", reason: null, chars: 14 },
      transcript: { status: "partial", provider: "none", reason: "transcript_not_available", chars: 0 },
      ocr: { status: "partial", provider: "frame_ocr", reason: "ocr_text_empty", chars: 0 },
      visualFallback: { status: "success", provider: "shared_visual_fallback", reason: null, chars: 120 },
    },
    stageTimingsMs: {
      basicMetadata: 10,
      caption: 0,
      transcript: 10,
      ocr: 10,
      visualFallback: 10,
    },
    combinedTextRaw: "Best hidden cafe in Patna\n\nDM for location",
    combinedTextClean: "Best hidden cafe in Patna\n\nDM for location",
  };
}

test("user prompt includes visual fallback summary for weak sources", () => {
  const prompt = buildUserPrompt(buildSource());
  assert.match(prompt, /visualFallback/i);
  assert.match(prompt, /Cafe Delhi Heights/);
  assert.match(prompt, /manual verification recommended/i);
});

test("user prompt includes retry attempt context when available", () => {
  const source = buildSource();
  source.attemptInfo = { attemptNumber: 2, triggerType: "retry" };
  source.debug = {
    priorAttemptHypotheses: [
      {
        attemptNumber: 1,
        previousBestResult: {
          name: "Tumpak Sewu Waterfall",
          categoryGuess: "see",
          locationHint: "Lumajang, East Java, Indonesia",
          confidence: "low",
          confidenceReason: "Caption hinted at waterfall",
          missingFields: ["address"],
          uncertainFields: ["address"],
          rejectedFields: [],
        },
      },
    ],
    orchestration: {
      route: "retry_1",
      acceptedAfter: "manual_review",
      decisions: [{ stage: "visualFallback", ran: true, reason: "retry_1_skips_visual_fallback" }],
    },
  };
  const prompt = buildUserPrompt(source, { attemptNumber: 2, triggerType: "retry" });
  assert.match(prompt, /"attemptNumber": 2/);
  assert.match(prompt, /"triggerType": "retry"/);
  assert.match(prompt, /retry_1_skips_visual_fallback/);
  assert.match(prompt, /priorAttemptHypotheses/);
  assert.match(prompt, /Tumpak Sewu Waterfall/);
});
