/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { getSharedIntentPlan, shouldResetAddFlowForAuthStatus } from "./sharedIntentState";

test("shared intent with extracted url waits for auth before being consumed", () => {
  assert.equal(
    getSharedIntentPlan({
      isAuthenticated: false,
      isAnalyzing: false,
      hasExtractedUrl: true,
    }),
    "wait_for_auth",
  );

  assert.equal(
    getSharedIntentPlan({
      isAuthenticated: true,
      isAnalyzing: false,
      hasExtractedUrl: true,
    }),
    "consume_and_process",
  );
});

test("shared intent without extracted url only prefills", () => {
  assert.equal(
    getSharedIntentPlan({
      isAuthenticated: true,
      isAnalyzing: false,
      hasExtractedUrl: false,
    }),
    "prefill_only",
  );
});

test("add flow reset is suppressed during auth restore states", () => {
  assert.equal(shouldResetAddFlowForAuthStatus("initializing"), false);
  assert.equal(shouldResetAddFlowForAuthStatus("refreshing"), false);
  assert.equal(shouldResetAddFlowForAuthStatus("authenticated"), false);
  assert.equal(shouldResetAddFlowForAuthStatus("unauthenticated"), true);
});
