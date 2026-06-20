/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { createRunToastDeduper } from "./addToastDeduper";

test("run toast deduper only allows each reason once per run", () => {
  const deduper = createRunToastDeduper();

  assert.equal(deduper.shouldShow(101, "stream_incomplete"), true);
  assert.equal(deduper.shouldShow(101, "stream_incomplete"), false);
  assert.equal(deduper.shouldShow(101, "poll_failed"), true);
  assert.equal(deduper.shouldShow(202, "stream_incomplete"), true);
});

test("run toast deduper resets across new analysis sessions", () => {
  const deduper = createRunToastDeduper();

  assert.equal(deduper.shouldShow(101, "timeout_preserved_card"), true);
  assert.equal(deduper.shouldShow(101, "timeout_preserved_card"), false);

  deduper.resetAll();

  assert.equal(deduper.shouldShow(101, "timeout_preserved_card"), true);
});
