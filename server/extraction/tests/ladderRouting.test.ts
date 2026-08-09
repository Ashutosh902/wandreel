import test from "node:test";
import assert from "node:assert/strict";
import {
  getAttemptVisualFallbackPolicy,
  resolveAttemptRoute,
  shouldAcceptTranscriptProbe,
  shouldForceBackgroundLongLane,
  shouldSkipOcrAfterTranscriptProbe,
} from "../pipeline";
import type { TranscriptResult } from "../types";

function buildTranscript(overrides?: Partial<TranscriptResult>): TranscriptResult {
  return {
    attempted: true,
    used: false,
    source: null,
    text: "",
    reason: "timeout",
    ...overrides,
  };
}

test("transcript timeout with zero chars cannot be accepted", () => {
  assert.equal(
    shouldAcceptTranscriptProbe(
      buildTranscript({ text: "", reason: "timeout" }),
      { accepted: true, confidence: "high", status: "ready", entityCount: 1 },
    ),
    false,
  );
});

test("ocr is not skipped after accepted probe when transcript is empty", () => {
  assert.equal(
    shouldSkipOcrAfterTranscriptProbe(
      buildTranscript({ text: "", reason: "timeout" }),
      { accepted: true, confidence: "high", status: "ready", entityCount: 1 },
    ),
    false,
  );
});

test("meaningful transcript can still skip ocr when accepted", () => {
  assert.equal(
    shouldSkipOcrAfterTranscriptProbe(
      buildTranscript({
        used: true,
        source: "whisper",
        text: "A meaningful transcript with enough place detail to use.",
        reason: null,
      }),
      { accepted: true, confidence: "medium", status: "ready", entityCount: 1 },
    ),
    true,
  );
});

test("accepted description can still force background long lane for post-save enrichment", () => {
  assert.equal(
    shouldForceBackgroundLongLane({
      attemptNumber: 1,
      forceBackgroundEnrichment: true,
      descriptionWeak: false,
      descriptionAccepted: true,
    }),
    true,
  );
});

test("fast path without background enrichment does not force long lane", () => {
  assert.equal(
    shouldForceBackgroundLongLane({
      attemptNumber: 1,
      forceBackgroundEnrichment: false,
      descriptionWeak: false,
      descriptionAccepted: true,
    }),
    false,
  );
});

test("attempt 2 still uses long lane when attempt 1 accepted on fast path", () => {
  assert.equal(
    resolveAttemptRoute({
      attemptNumber: 2,
      priorAttempt1Profile: {
        usedLongLane: false,
        acceptedAfter: "description",
        route: "attempt_1",
        transcriptAttempted: false,
        ocrAttempted: false,
      },
    }),
    "retry_1_long",
  );
});

test("attempt 3 still keeps visual fallback enabled", () => {
  assert.deepEqual(
    getAttemptVisualFallbackPolicy(3),
    {
      includeVisual: true,
      decisionReason: "retry_2_visual_default_final_attempt",
    },
  );
});
