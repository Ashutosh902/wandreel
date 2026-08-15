import test from "node:test";
import assert from "node:assert/strict";
import { getTranscriptTimeoutMsForAttempt, isWeakDescription } from "../pipeline";

test("attempt 1 transcript timeout is capped at 20 seconds", () => {
  assert.equal(getTranscriptTimeoutMsForAttempt(1), 20000);
});

test("attempt 2 transcript timeout is capped at 30 seconds", () => {
  assert.equal(getTranscriptTimeoutMsForAttempt(2), 30000);
});

test("attempt 3 transcript timeout is capped at 60 seconds", () => {
  assert.equal(getTranscriptTimeoutMsForAttempt(3), 60000);
});

test("instagram transcript timeout gets a 60 second budget", () => {
  assert.equal(getTranscriptTimeoutMsForAttempt(1, "instagram"), 60000);
  assert.equal(getTranscriptTimeoutMsForAttempt(2, "instagram"), 60000);
  assert.equal(getTranscriptTimeoutMsForAttempt(3, "instagram"), 60000);
});

test("instagram travel boilerplate description is treated as weak", () => {
  assert.equal(
    isWeakDescription({
      sourceUrl: "https://www.instagram.com/p/test",
      canonicalUrl: "https://www.instagram.com/p/test",
      platform: "instagram",
      title: "Creator on Instagram: \"Planning Meghalaya? Save this before you book\"",
      description:
        "17K likes, 1,528 comments - Planning Meghalaya? Save this before you book and tell me which place deserves a higher rating! DM \"MEGHALAYA\" and I'll help you for your perfect Meghalaya itinerary #meghalaya #meghalayatrip #hiddengemsindia",
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
    }),
    true,
  );
});

test("instagram caption with a concrete restaurant name is not treated as weak", () => {
  assert.equal(
    isWeakDescription({
      sourceUrl: "https://www.instagram.com/p/restaurant",
      canonicalUrl: "https://www.instagram.com/p/restaurant",
      platform: "instagram",
      title: "Lunch plans on Instagram",
      description:
        "Meghna's Kitchen Cafe, Shillong\nMust try the smoked pork platter and coffee here before sunset. #shillong #cafe #meghalaya",
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
    }),
    false,
  );
});
