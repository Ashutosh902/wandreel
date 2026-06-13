import assert from "node:assert/strict";
import test from "node:test";
import { buildCombinedText } from "../combinedText";
import { assessVerificationCandidate, classifyQueryShape, isSemanticMismatch, runVisualFallback, shouldTriggerVisualFallback } from "../visualFallback";
import { getAttemptVisualFallbackPolicy } from "../pipeline";

test("combined text includes pinned and top comments before first intelligence pass", () => {
  const combined = buildCombinedText({
    metadata: {
      sourceUrl: "https://www.instagram.com/p/example/",
      canonicalUrl: "https://www.instagram.com/p/example",
      platform: "instagram",
      title: "Boat ride",
      description: "Periyar Reserve in Thekkady",
      siteName: "Instagram",
      imageUrl: "https://example.com/cover.jpg",
      fetchedAtIso: new Date().toISOString(),
      provider: "instagram_script",
      commentEvidence: {
        attempted: true,
        timedOut: false,
        pinnedComment: "This is in Periyar Tiger Reserve",
        topComments: ["Boat ride timing is morning", "Cardamom County is nearby"],
        provider: "instagram_script",
        reason: null,
      },
    },
    transcript: null,
    ocr: null,
  });

  assert.match(combined.combinedTextClean || "", /Pinned comment: This is in Periyar Tiger Reserve/);
  assert.match(combined.combinedTextClean || "", /Comment: Boat ride timing is morning/);
  assert.match(combined.combinedTextClean || "", /Comment: Cardamom County is nearby/);
});

test("generic OCR sentence must not verify Digha Sonpur Setu", () => {
  const assessment = assessVerificationCandidate({
    query: "You are crossing most dangerous bridge for the view",
    querySource: "ocr_text",
    contextText: "Most stunning waterfall I have visited. You are crossing most dangerous bridge for the view.",
    visualMeta: null,
    verified: {
      candidateName: "Digha Sonpur Setu",
      formattedAddress: "Danapur, Bihar, India",
      locality: "Danapur",
      city: "Patna",
      state: "Bihar",
      country: "India",
      placeId: "bridge123",
      lat: 0,
      lng: 0,
      verificationConfidence: "high",
    },
  });

  assert.equal(classifyQueryShape("You are crossing most dangerous bridge for the view"), "descriptive_caption");
  assert.equal(assessment.allowSearchUpgrade, false);
  assert.equal(assessment.searchVerificationScore <= 0.2, true);
  assert.equal(assessment.corroborationCount, 0);
});

test("generic caption must not verify a random waterfall", () => {
  const assessment = assessVerificationCandidate({
    query: "Most stunning waterfall I have visited",
    querySource: "ocr_text",
    contextText: "Most stunning waterfall I have visited",
    visualMeta: null,
    verified: {
      candidateName: "Seven Sisters Waterfall",
      formattedAddress: "Meghalaya, India",
      locality: null,
      city: null,
      state: "Meghalaya",
      country: "India",
      placeId: "falls123",
      lat: 0,
      lng: 0,
      verificationConfidence: "high",
    },
  });

  assert.equal(classifyQueryShape("Most stunning waterfall I have visited"), "descriptive_caption");
  assert.equal(assessment.allowSearchUpgrade, false);
  assert.equal(assessment.searchVerificationScore <= 0.2, true);
});

test("proper noun OCR like Tumpak Sewu Waterfall can be verified and promoted", () => {
  const assessment = assessVerificationCandidate({
    query: "Tumpak Sewu Waterfall",
    querySource: "ocr_text",
    contextText: "Tumpak Sewu Waterfall Coban Sewu East Java Indonesia",
    visualMeta: {
      name: "Tumpak Sewu Waterfall",
      aliases: ["Coban Sewu"],
      locationHint: "East Java, Indonesia",
      countryOrRegion: "Indonesia",
      evidence: "Large amphitheater waterfall",
      category: "see",
      supportFrameLabels: ["frame_1", "frame_2"],
    },
    verified: {
      candidateName: "Tumpak Sewu Waterfall",
      formattedAddress: "East Java, Indonesia",
      locality: null,
      city: null,
      state: "East Java",
      country: "Indonesia",
      placeId: "tumpak123",
      lat: 0,
      lng: 0,
      verificationConfidence: "high",
    },
  });

  assert.equal(classifyQueryShape("Tumpak Sewu Waterfall"), "landmark_like");
  assert.equal(assessment.allowSearchUpgrade, true);
  assert.equal(assessment.corroborationCount > 0, true);
  assert.equal(assessment.searchVerificationScore >= 0.65, true);
});

test("waterfall scene with unrelated bridge result is semantically downgraded", () => {
  assert.equal(
    isSemanticMismatch(
      "Most stunning waterfall I have visited. Large waterfall and nature viewpoint.",
      "Digha Sonpur Setu Danapur Bihar India bridge",
    ),
    true,
  );
});

test("attempt visual fallback policy keeps attempt 1 and retry 1 skipped", () => {
  assert.deepEqual(getAttemptVisualFallbackPolicy(1), {
    includeVisual: false,
    decisionReason: "initial_attempt_only",
  });
  assert.deepEqual(getAttemptVisualFallbackPolicy(2), {
    includeVisual: false,
    decisionReason: "retry_1_skips_visual_fallback",
  });
});

test("attempt 3 visual fallback policy enables final-attempt visual verification", () => {
  assert.deepEqual(getAttemptVisualFallbackPolicy(3), {
    includeVisual: true,
    decisionReason: "retry_2_visual_default_final_attempt",
  });
  assert.equal(
    shouldTriggerVisualFallback({
      metadata: {
        sourceUrl: "https://example.com/reel",
        canonicalUrl: "https://example.com/reel",
        platform: "instagram",
        title: "Weekend cave drive",
        description: "Bangalore weather plus weekend drives and places like this make the city worth it. Please keep it clean.",
        siteName: "Instagram",
        imageUrl: "https://example.com/cover.jpg",
        fetchedAtIso: new Date().toISOString(),
        provider: "instagram_script",
      },
      transcript: { attempted: true, used: false, source: null, text: "", reason: "timeout" },
      ocr: {
        attempted: true,
        used: true,
        text: "This man-made cave temple near Bangalore feels unreal inside\n1hr drive from Whitefield",
        reason: null,
      },
      forceTrigger: true,
    }),
    true,
  );
});

test("attempt 3 forced visual fallback does not stop on generic OCR when a frame is available", async () => {
  const result = await runVisualFallback({
    metadata: {
      sourceUrl: "https://example.com/reel",
      canonicalUrl: "https://example.com/reel",
      platform: "instagram",
      title: "Weekend cave drive",
      description: "Bangalore weather plus weekend drives and places like this make the city worth it. Please keep it clean.",
      siteName: "Instagram",
      imageUrl: "https://example.com/cover.jpg",
      fetchedAtIso: new Date().toISOString(),
      provider: "instagram_script",
    },
    transcript: { attempted: true, used: false, source: null, text: "", reason: "timeout" },
    ocr: {
      attempted: true,
      used: true,
      text: "This man-made cave temple near Bangalore feels unreal inside\n1hr drive from Whitefield",
      reason: null,
    },
    screenshots: [
      {
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pS1m7QAAAAASUVORK5CYII=",
        origin: "video_frame",
        label: "frame_1",
        timestampSec: 3.16,
      },
    ],
    forceTrigger: true,
    forceTriggerReason: "retry_2_visual_default_final_attempt",
  });

  assert.equal(result.attempted, true);
  assert.equal(result.triggered, true);
  assert.notEqual(result.reason, "sufficient_upstream_signal");
});
