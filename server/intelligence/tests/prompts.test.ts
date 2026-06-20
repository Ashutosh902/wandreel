import assert from "node:assert/strict";
import test from "node:test";
import { buildSystemPrompt, buildTinyCaptionSystemPrompt } from "../prompts";

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

test("tiny caption prompt stays short and caption-only", () => {
  const prompt = buildTinyCaptionSystemPrompt();
  assert.match(prompt, /Use only: title, caption\/description, and lightweight comments/i);
  assert.doesNotMatch(prompt, /visualFallback|OCR|transcript/i);
  assert.match(prompt, /intent\.l3 is not predefined/i);
  assert.match(prompt, /Do not split a generic experience phrase into a separate activity entity/i);
});

test("attempt 3 system prompt is visually led but prior-aware", () => {
  const prompt = buildSystemPrompt({ attemptNumber: 3 });
  assert.match(prompt, /visual fallback \/ reverse-image evidence is the primary decision source/i);
  assert.match(prompt, /Treat Attempt 1 and Attempt 2 as prior context only/i);
  assert.match(prompt, /Never copy a prior entity name into the final answer unless it is independently supported/i);
  assert.match(prompt, /comment\/reply venue\+address > clear visual signboard/i);
});
