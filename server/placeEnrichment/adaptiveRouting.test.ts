import test from "node:test";
import assert from "node:assert/strict";
import {
  assessKnowledgeCoverage,
  planAdaptiveEnrichment,
  type KnowledgeEvidenceInput,
} from "./adaptiveRouting";

const NOW = new Date("2026-08-09T12:00:00.000Z");

function evidence(overrides: Partial<KnowledgeEvidenceInput> & Pick<KnowledgeEvidenceInput, "kind" | "value">): KnowledgeEvidenceInput {
  return {
    confidence: 0.8,
    sourceType: "website_caption",
    sourceUrl: "https://example.com/source-1",
    observedAt: "2026-08-01T00:00:00.000Z",
    verifiedAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2027-08-01T00:00:00.000Z",
    ...overrides,
  };
}

test("assessKnowledgeCoverage classifies missing, weak, sufficient, stale, and conflicting facts", () => {
  const coverage = assessKnowledgeCoverage([
    evidence({ kind: "recommended_item", value: "pepper crab" }),
    evidence({ kind: "ambience", value: "breezy", confidence: 0.5 }),
    evidence({ kind: "pricing", value: "Rs 700", expiresAt: "2026-01-01T00:00:00.000Z" }),
    evidence({ kind: "best_time", value: "5 PM" }),
    evidence({ kind: "best_time", value: "7 PM", sourceUrl: "https://example.com/source-2" }),
  ], { now: NOW });

  assert.equal(coverage.recommended_item.status, "sufficient");
  assert.equal(coverage.ambience.status, "weak");
  assert.equal(coverage.pricing.status, "stale");
  assert.equal(coverage.best_time.status, "conflicting");
  assert.equal(coverage.parking.status, "missing");
});

test("empty place selects broad exploration through the existing extraction ladder", () => {
  const coverage = assessKnowledgeCoverage([], { now: NOW });
  const decision = planAdaptiveEnrichment({ coverage });

  assert.equal(decision.broadExploration, true);
  assert.deepEqual(decision.selectedActions, ["caption", "transcript", "ocr", "visual"]);
  assert.equal(decision.stopReason, null);
});

test("rich place with only parking missing selects the cheapest relevant action", () => {
  const facts = [
    ["best_time", "5 PM"],
    ["recommended_item", "pepper crab"],
    ["crowd_note", "busy on weekends"],
    ["seating_tip", "upstairs"],
    ["pricing", "Rs 900"],
    ["ambience", "breezy"],
  ].map(([kind, value]) => evidence({ kind, value }));
  const coverage = assessKnowledgeCoverage(facts, { now: NOW });
  const decision = planAdaptiveEnrichment({ coverage });

  assert.deepEqual(decision.gaps, ["parking"]);
  assert.deepEqual(decision.selectedActions, ["caption"]);
  assert.ok(decision.skippedActions.includes("visual"));
});

test("fully covered place stops before extraction", () => {
  const facts = [
    ["best_time", "5 PM"],
    ["recommended_item", "pepper crab"],
    ["crowd_note", "busy on weekends"],
    ["seating_tip", "upstairs"],
    ["pricing", "Rs 900"],
    ["parking", "limited"],
    ["ambience", "breezy"],
  ].map(([kind, value]) => evidence({ kind, value }));
  const decision = planAdaptiveEnrichment({ coverage: assessKnowledgeCoverage(facts, { now: NOW }) });

  assert.deepEqual(decision.selectedActions, []);
  assert.equal(decision.stopReason, "relevant_knowledge_coverage_sufficient");
  assert.equal(decision.estimatedStagesAvoided, 6);
});

test("expired fact remains a targeted gap", () => {
  const facts = [
    ["best_time", "5 PM"],
    ["recommended_item", "pepper crab"],
    ["crowd_note", "busy on weekends"],
    ["seating_tip", "upstairs"],
    ["pricing", "Rs 900"],
    ["parking", "limited"],
    ["ambience", "breezy"],
  ].map(([kind, value]) => evidence({
    kind,
    value,
    expiresAt: kind === "pricing" ? "2026-01-01T00:00:00.000Z" : "2027-08-01T00:00:00.000Z",
  }));
  const decision = planAdaptiveEnrichment({ coverage: assessKnowledgeCoverage(facts, { now: NOW }) });

  assert.deepEqual(decision.gaps, ["pricing"]);
  assert.deepEqual(decision.selectedActions, ["caption"]);
});
