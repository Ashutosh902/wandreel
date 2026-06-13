import assert from "node:assert/strict";
import test from "node:test";
import { buildSystemPrompt } from "../prompts";

test("system prompt includes hard rules and category constraints", () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /Never extract recipes or movies/i);
  assert.match(prompt, /A source can belong to multiple categories/i);
  assert.match(prompt, /Do not choose a primary category/i);
  assert.match(prompt, /"intent"/i);
  assert.match(prompt, /intent\.l3 is extracted from metadata\/caption, transcript, OCR, and visual evidence/i);
  assert.match(prompt, /taste: Cafe, Restaurant/i);
  assert.match(prompt, /eat:/i);
  assert.match(prompt, /do:/i);
  assert.match(prompt, /stay:/i);
  assert.match(prompt, /see:/i);
  assert.match(prompt, /For each entity, include level2 fields/i);
  assert.match(prompt, /date-night/i);
});
