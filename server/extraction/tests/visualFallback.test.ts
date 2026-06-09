import assert from "node:assert/strict";
import test from "node:test";
import { assessVerificationCandidate, classifyQueryShape, isSemanticMismatch } from "../visualFallback";

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
