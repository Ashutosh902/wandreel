import test from "node:test";
import assert from "node:assert/strict";
import { getRetryCacheDecision } from "../pipeline";
import type { ExtractionResult } from "../types";

function buildCachedResult(acceptedAfter: "manual_review" | "ocr"): ExtractionResult {
  return {
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
    transcript: { attempted: true, used: false, source: null, text: "", reason: "timeout" },
    ocr: { attempted: true, used: false, text: "", reason: "ocr_empty" },
    source: "https://example.com/reel",
    platform: "instagram",
    canonicalUrl: "https://example.com/reel",
    debug: {
      orchestration: {
        acceptedAfter,
      },
    },
  };
}

test("retry cache bypasses cached manual review results for deeper evidence", () => {
  assert.deepEqual(
    getRetryCacheDecision({
      attemptNumber: 2,
      triggerType: "retry",
      cachedResult: buildCachedResult("manual_review"),
    }),
    {
      bypass: true,
      reason: "manual_review_retry_requires_deeper_evidence",
      cachedStatus: "manual_review",
      cachedAcceptedAfter: "manual_review",
    },
  );
});

test("retry cache keeps confident cached results", () => {
  assert.equal(
    getRetryCacheDecision({
      attemptNumber: 2,
      triggerType: "retry",
      cachedResult: buildCachedResult("ocr"),
    }).bypass,
    false,
  );
});

test("retry cache bypasses generic metadata-only placeholder results for deeper evidence", () => {
  const cachedResult = buildCachedResult("ocr");
  cachedResult.metadata.description = "Cutest pinteresty cafe in Sikkim";
  cachedResult.debug = {
    fastPathIntelligence: {
      result: {
        output: {
          status: "needs_review",
        },
      },
    },
    orchestration: {
      acceptedAfter: "ocr",
    },
  };

  assert.deepEqual(
    getRetryCacheDecision({
      attemptNumber: 3,
      triggerType: "retry",
      cachedResult,
    }),
    {
      bypass: true,
      reason: "manual_review_retry_requires_deeper_evidence",
      cachedStatus: "needs_review",
      cachedAcceptedAfter: "ocr",
    },
  );
});
