import test from "node:test";
import assert from "node:assert/strict";
import { shouldAcceptTranscriptProbe, shouldSkipOcrAfterTranscriptProbe } from "../pipeline";
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
