import assert from "node:assert/strict";
import test from "node:test";
import { buildSystemPrompt, buildUserPrompt } from "../prompts";
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

test("attempt 3 prompt uses geo hint but marks generic prior name as rejected", () => {
  const source = buildSource();
  source.attemptInfo = { attemptNumber: 3, triggerType: "retry" };
  source.metadata.description = "Hidden spot in Sikkim #gangtok #tadong";
  source.debug = {
    priorAttemptHypotheses: [
      {
        attemptNumber: 1,
        status: "needs_review",
        categoryGuesses: ["eat"],
        locationHints: ["Tadong, Gangtok, Sikkim"],
        possibleMatches: [
          {
            name: "pinteresty café",
            categoryGuess: "eat",
            locationHint: "Tadong, Gangtok, Sikkim",
            confidence: "low",
            confidenceReason: "Generic caption phrase",
          },
        ],
      },
    ],
    orchestration: {
      route: "retry_2",
      acceptedAfter: "manual_review",
      decisions: [{ stage: "visualFallback", ran: true, reason: "retry_2_visual_default_final_attempt" }],
    },
  };
  const prompt = buildUserPrompt(source, { attemptNumber: 3, triggerType: "retry" });
  assert.match(prompt, /attempt3PriorContext/);
  assert.match(prompt, /Tadong, Gangtok, Sikkim/);
  assert.match(prompt, /pinteresty café \[rejected_generic_caption_name\]/i);
});

test("attempt 3 prompt includes creator comment venue evidence above generic prior names", () => {
  const source = buildSource();
  source.attemptInfo = { attemptNumber: 3, triggerType: "retry" };
  source.metadata.commentEvidence = {
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
  };
  source.debug = {
    priorAttemptHypotheses: [
      {
        attemptNumber: 2,
        status: "needs_review",
        categoryGuesses: ["eat"],
        locationHints: ["Gangtok, Sikkim"],
        possibleMatches: [
          {
            name: "cute cafe",
            categoryGuess: "eat",
            locationHint: "Gangtok, Sikkim",
            confidence: "low",
            confidenceReason: "Generic caption phrase",
          },
        ],
      },
    ],
  };
  const prompt = buildUserPrompt(source, { attemptNumber: 3, triggerType: "retry" });
  assert.match(prompt, /Queen's Pod, 16 Adampool, Lumsey, Tadong, Gangtok, Sikkim 737102/);
  assert.match(prompt, /priorityOrder/);
  assert.match(prompt, /comment_or_creator_reply_with_venue_and_address/);
});

test("attempt 3 prompt includes prior generic wrong name but instructs not to copy it", () => {
  const source = buildSource();
  const prompt = buildSystemPrompt({ attemptNumber: 3 });
  source.attemptInfo = { attemptNumber: 3, triggerType: "retry" };
  source.debug = {
    priorAttemptHypotheses: [
      {
        attemptNumber: 1,
        status: "needs_review",
        categoryGuesses: ["eat"],
        locationHints: ["Patna, Bihar"],
        possibleMatches: [
          {
            name: "8,041 likes, 29 comments - creator on April 19, 2026",
            categoryGuess: "eat",
            locationHint: "Patna, Bihar",
            confidence: "low",
            confidenceReason: "Metadata boilerplate",
          },
        ],
      },
    ],
  };
  const userPrompt = buildUserPrompt(source, { attemptNumber: 3, triggerType: "retry" });
  assert.match(prompt, /Never copy a prior entity name into the final answer unless it is independently supported/i);
  assert.match(userPrompt, /rejected_metadata_boilerplate_name/i);
});
