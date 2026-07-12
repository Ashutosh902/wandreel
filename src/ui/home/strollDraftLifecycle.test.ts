/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  getStrollDraftAutosaveLabel,
  getStrollDraftProgressCopy,
} from "./strollDraftLifecycle";

test("strollDraftLifecycle exposes calm autosave labels", () => {
  assert.equal(getStrollDraftAutosaveLabel("idle"), null);
  assert.equal(getStrollDraftAutosaveLabel("pending"), "Saving changes...");
  assert.equal(getStrollDraftAutosaveLabel("saving"), "Saving changes...");
  assert.equal(getStrollDraftAutosaveLabel("saved"), "Saved just now");
  assert.equal(getStrollDraftAutosaveLabel("error"), "Could not save automatically");
});

test("strollDraftLifecycle softens progress copy by status", () => {
  assert.match(getStrollDraftProgressCopy("draft"), /keep it current/i);
  assert.match(getStrollDraftProgressCopy("queued"), /Preparing your Stroll/);
  assert.match(getStrollDraftProgressCopy("curating"), /Preparing your Stroll/);
  assert.match(getStrollDraftProgressCopy("ready"), /ready to begin/i);
  assert.match(getStrollDraftProgressCopy("failed"), /try again/i);
});
