import test from "node:test";
import assert from "node:assert/strict";
import type { GroundedPlaceKnowledgeRecord } from "./store";
import { buildConflictAwarePlaceKnowledge } from "./truthMaintenance";
import { scoreConflictAwarePlaceKnowledge } from "./knowledgeQuality";
import { buildNormalizedPlaceKnowledge, PLACE_KNOWLEDGE_READ_MODEL_VERSION } from "./readModel";

const NOW = new Date("2026-08-10T00:00:00.000Z");

function fact(input: {
  id: string;
  kind: string;
  value: string;
  qualifiers?: Record<string, unknown>;
  source?: string;
  expiresAt?: string;
}): GroundedPlaceKnowledgeRecord {
  return {
    evidenceId: input.id,
    factType: `knowledge_${input.kind}`,
    kind: input.kind,
    value: input.value,
    qualifiers: input.qualifiers || {},
    factConfidence: 0.95,
    grounding: {
      supportType: "direct",
      sourceSignal: "caption",
      evidenceText: `${input.kind} ${input.value}`,
      sourceField: "metadata.description",
      groundingConfidence: 0.98,
      span: { start: 0, end: 20, unit: "character" },
      validation: { status: "validated", method: "exact_span", reason: null },
    },
    provenance: { extractorName: "deterministic_place_knowledge" },
    sourceUrl: input.source || `https://source.test/${input.id}`,
    sourceType: "website_caption",
    sourceRecordId: input.id,
    extractorVersion: "deep_v2",
    model: null,
    observedAt: "2026-08-01T00:00:00.000Z",
    verifiedAt: "2026-08-02T00:00:00.000Z",
    expiresAt: input.expiresAt || "2027-08-01T00:00:00.000Z",
  };
}

function read(facts: GroundedPlaceKnowledgeRecord[]) {
  const truth = buildConflictAwarePlaceKnowledge({ canonicalPlaceId: "place-read", facts, now: NOW });
  return buildNormalizedPlaceKnowledge(scoreConflictAwarePlaceKnowledge(truth, { now: NOW }));
}

test("normalized read preserves conditional qualifiers and compact quality metadata", () => {
  const model = read([
    fact({ id: "weekend", kind: "parking", value: "difficult", qualifiers: { when: "weekends" } }),
    fact({ id: "weekday", kind: "parking", value: "easy", qualifiers: { when: "weekday mornings" } }),
  ]);
  assert.equal(model.readModelVersion, PLACE_KNOWLEDGE_READ_MODEL_VERSION);
  assert.equal(model.knowledge.parking.length, 2);
  assert.equal(model.knowledge.parking.every((claim) => claim.truthState === "conditionally_supported"), true);
  assert.deepEqual(model.knowledge.parking.find((claim) => claim.value === "difficult")?.qualifiers, { when: "weekends" });
  assert.equal(model.knowledge.parking[0].quality.version, "knowledge_quality_v1");
  assert.equal(model.summary.conditionalClaimCount, 2);
});

test("normalized read exposes both disputed claims without selecting a winner", () => {
  const model = read([
    fact({ id: "yes", kind: "booking_required", value: "true", qualifiers: { activity: "boat ride" } }),
    fact({ id: "no", kind: "booking_required", value: "false", qualifiers: { activity: "boat ride" } }),
  ]);
  assert.equal(model.knowledge.bookingRequirements.length, 2);
  assert.equal(model.knowledge.bookingRequirements.every((claim) => claim.truthState === "disputed"), true);
  assert.equal(model.knowledge.bookingRequirements.every((claim) => claim.quality.band === "disputed"), true);
  assert.equal(model.summary.disputedClaimCount, 2);
});

test("stale claims move to history while current reads retain multiple qualified best times", () => {
  const model = read([
    fact({ id: "sunset", kind: "best_time", value: "5 PM", qualifiers: { reason: "sunset" } }),
    fact({ id: "quiet", kind: "best_time", value: "9 AM", qualifiers: { reason: "avoid crowds" } }),
    fact({ id: "old-price", kind: "pricing", value: "inr 700", expiresAt: "2026-01-01T00:00:00.000Z" }),
  ]);
  assert.equal(model.knowledge.bestTimes.length, 2);
  assert.deepEqual(new Set(model.knowledge.bestTimes.map((claim) => claim.qualifiers.reason)), new Set(["sunset", "avoid crowds"]));
  assert.equal(model.knowledge.pricing.length, 0);
  assert.equal(model.historical.pricing.length, 1);
  assert.equal(model.historical.pricing[0].truthState, "stale");
});

test("independent support is normalized without source prose reparsing", () => {
  const model = read([
    fact({ id: "one", kind: "recommended_item", value: "butter garlic prawns", source: "https://one.test" }),
    fact({ id: "two", kind: "recommended_item", value: "butter garlic prawns", source: "https://two.test" }),
  ]);
  const recommendation = model.knowledge.recommendedItems[0];
  assert.equal(recommendation.support.count, 2);
  assert.equal(recommendation.support.sourceCount, 2);
  assert.deepEqual(recommendation.grounding.supportTypes, ["direct"]);
  assert.deepEqual(recommendation.grounding.signals, ["caption"]);
  assert.equal(recommendation.support.evidenceIds.length, 2);
});
