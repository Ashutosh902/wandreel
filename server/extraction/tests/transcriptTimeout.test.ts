import test from "node:test";
import assert from "node:assert/strict";
import { getTranscriptTimeoutMsForAttempt } from "../pipeline";

test("attempt 1 transcript timeout is capped at 20 seconds", () => {
  assert.equal(getTranscriptTimeoutMsForAttempt(1), 20000);
});

test("retry attempts keep the default transcript timeout", () => {
  assert.equal(getTranscriptTimeoutMsForAttempt(2), 60000);
  assert.equal(getTranscriptTimeoutMsForAttempt(3), 60000);
});
