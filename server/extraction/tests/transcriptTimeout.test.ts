import test from "node:test";
import assert from "node:assert/strict";
import { getTranscriptTimeoutMsForAttempt } from "../pipeline";

test("attempt 1 transcript timeout is capped at 20 seconds", () => {
  assert.equal(getTranscriptTimeoutMsForAttempt(1), 20000);
});

test("attempt 2 transcript timeout is capped at 30 seconds", () => {
  assert.equal(getTranscriptTimeoutMsForAttempt(2), 30000);
});

test("attempt 3 transcript timeout is capped at 60 seconds", () => {
  assert.equal(getTranscriptTimeoutMsForAttempt(3), 60000);
});
