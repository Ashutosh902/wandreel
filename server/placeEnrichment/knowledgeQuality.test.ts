import test from "node:test";
import assert from "node:assert/strict";
import type { GroundedPlaceKnowledgeRecord } from "./store";
import { buildConflictAwarePlaceKnowledge } from "./truthMaintenance";
import {
  KNOWLEDGE_QUALITY_VERSION,
  freshnessScore,
  scoreConflictAwareClaim,
  scoreConflictAwarePlaceKnowledge,
  sourceDiversityScore,
  supportScore,
} from "./knowledgeQuality";

const NOW = new Date("2026-08-10T00:00:00.000Z");

function fact(input: {
  id: string;
  source?: string;
  sourceType?: string | null;
  kind?: string;
  value?: string;
  qualifiers?: Record<string, unknown>;
  factConfidence?: number;
  groundingConfidence?: number;
  supportType?: "direct" | "inferred";
  method?: "exact_span" | "normalized_span" | "visual_evidence_record";
  observedAt?: string | null;
  verifiedAt?: string | null;
  expiresAt?: string | null;
}): GroundedPlaceKnowledgeRecord {
  const method = input.method ?? "exact_span";
  return {
    evidenceId: input.id,
    factType: `knowledge_${input.kind || "activity"}`,
    kind: input.kind || "activity",
    value: input.value || "boat ride",
    qualifiers: input.qualifiers || {},
    factConfidence: input.factConfidence ?? 0.95,
    grounding: {
      supportType: input.supportType || "direct",
      sourceSignal: method === "visual_evidence_record" ? "visual" : "caption",
      evidenceText: `${input.value || "boat ride"} evidence`,
      sourceField: method === "visual_evidence_record" ? "visual.selectedCandidate" : "metadata.description",
      groundingConfidence: input.groundingConfidence ?? 0.98,
      span: { start: 2, end: 20, unit: "character" },
      ...(method === "visual_evidence_record" ? { frameReferences: [{ label: "frame-1", frameIndex: 1 }] } : {}),
      validation: { status: "validated", method, reason: null },
    },
    provenance: { extractorName: "deterministic_place_knowledge", extractorVersion: "deep_v2" },
    sourceUrl: input.source ?? `https://source.test/${input.id}`,
    sourceType: input.sourceType === undefined ? "website_caption" : input.sourceType,
    sourceRecordId: input.id,
    extractorVersion: "deep_v2",
    model: null,
    observedAt: input.observedAt === undefined ? "2026-08-01T00:00:00.000Z" : input.observedAt,
    verifiedAt: input.verifiedAt === undefined ? "2026-08-01T00:00:00.000Z" : input.verifiedAt,
    expiresAt: input.expiresAt === undefined ? "2027-08-01T00:00:00.000Z" : input.expiresAt,
  };
}

function score(facts: GroundedPlaceKnowledgeRecord[], kind = facts[0]?.kind || "activity") {
  const truth = buildConflictAwarePlaceKnowledge({ canonicalPlaceId: "place-quality", facts, now: NOW });
  return scoreConflictAwarePlaceKnowledge(truth, { now: NOW }).knowledge[kind];
}

test("strong grounded claim exposes a stable decomposable score", () => {
  const first = score([fact({ id: "a" })]).claims[0];
  const second = score([fact({ id: "a" })]).claims[0];
  assert.equal(first.quality.scoringVersion, KNOWLEDGE_QUALITY_VERSION);
  assert.equal(first.quality.qualityStatus, "scored");
  assert.equal(first.quality.qualityBand, "strong");
  assert.deepEqual(first.quality, second.quality);
  assert.equal(first.quality.adjustments?.totalPenalty, 0);
  assert.ok(first.quality.reasonCodes.includes("validated_direct_grounding"));
  assert.ok(first.quality.reasonCodes.includes("exact_evidence_location"));
});

test("support and source-diversity functions have bounded diminishing returns", () => {
  assert.ok(supportScore(2) > supportScore(1));
  assert.ok(supportScore(3) > supportScore(2));
  assert.ok(supportScore(3) - supportScore(2) < supportScore(2) - supportScore(1));
  assert.ok(sourceDiversityScore(2) > sourceDiversityScore(1));
  assert.ok(sourceDiversityScore(3) - sourceDiversityScore(2) < sourceDiversityScore(2) - sourceDiversityScore(1));
});

test("independent agreement improves quality more than duplicate same-source evidence", () => {
  const single = score([fact({ id: "a", source: "https://one.test/post" })]).claims[0];
  const duplicate = score([
    fact({ id: "a", source: "https://one.test/post" }),
    fact({ id: "b", source: "https://one.test/post" }),
  ]).claims[0];
  const independent = score([
    fact({ id: "a", source: "https://one.test/post" }),
    fact({ id: "b", source: "https://two.test/post" }),
  ]).claims[0];
  assert.equal(duplicate.quality.components?.sourceDiversity, single.quality.components?.sourceDiversity);
  assert.ok((independent.quality.qualityScore || 0) > (duplicate.quality.qualityScore || 0));
  assert.ok(duplicate.quality.reasonCodes.includes("duplicate_same_source_support"));
  assert.ok(independent.quality.reasonCodes.includes("multiple_independent_sources"));
});

test("validated grounding and direct support are monotonic", () => {
  const direct = score([fact({ id: "direct" })]).claims[0];
  const weakerGrounding = score([fact({ id: "weak", groundingConfidence: 0.55 })]).claims[0];
  const inferred = score([fact({ id: "inferred", supportType: "inferred", method: "visual_evidence_record", sourceType: "instagram_vision" })]).claims[0];
  assert.ok((direct.quality.qualityScore || 0) > (weakerGrounding.quality.qualityScore || 0));
  assert.ok((direct.quality.qualityScore || 0) > (inferred.quality.qualityScore || 0));
  assert.ok((inferred.quality.adjustments?.inferencePenalty || 0) > 0);
  assert.ok(inferred.quality.reasonCodes.includes("inferred_support"));
});

test("freshness decays gradually and expiry remains queryable but weak", () => {
  const current = freshnessScore({ observedAt: "2026-01-01T00:00:00.000Z", verifiedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" }, NOW);
  const approaching = freshnessScore({ observedAt: "2026-01-01T00:00:00.000Z", verifiedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-09-01T00:00:00.000Z" }, NOW);
  const expired = score([fact({ id: "expired", observedAt: "2025-01-01T00:00:00.000Z", verifiedAt: "2025-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:00:00.000Z" })]).claims[0];
  assert.equal(current.state, "current");
  assert.equal(approaching.state, "approaching_stale");
  assert.ok((current.score || 0) > (approaching.score || 0));
  assert.equal(expired.truthState, "stale");
  assert.equal(expired.quality.qualityBand, "weak");
  assert.equal(expired.quality.components?.freshness, 0);
  assert.ok(expired.quality.reasonCodes.includes("expired_evidence"));
});

test("strong conflicting evidence stays visibly disputed", () => {
  const group = score([
    fact({ id: "yes-1", kind: "booking_required", value: "true", qualifiers: { activity: "boat ride" }, source: "https://one.test" }),
    fact({ id: "yes-2", kind: "booking_required", value: "true", qualifiers: { activity: "boat ride" }, source: "https://two.test" }),
    fact({ id: "no-1", kind: "booking_required", value: "false", qualifiers: { activity: "boat ride" }, source: "https://three.test" }),
    fact({ id: "no-2", kind: "booking_required", value: "false", qualifiers: { activity: "boat ride" }, source: "https://four.test" }),
  ], "booking_required");
  assert.equal(group.status, "disputed");
  for (const claim of group.claims) {
    assert.equal(claim.truthState, "disputed");
    assert.equal(claim.quality.qualityBand, "disputed");
    assert.ok((claim.quality.evidenceStrengthScore || 0) > 0.8);
    assert.equal(claim.quality.adjustments?.disputePenalty, 0.2);
    assert.ok(claim.quality.reasonCodes.includes("active_dispute"));
  }
});

test("conditional and subjective claims are not penalized for conditionality", () => {
  const parking = score([
    fact({ id: "weekend", kind: "parking", value: "difficult", qualifiers: { when: "weekends" } }),
    fact({ id: "weekday", kind: "parking", value: "easy", qualifiers: { when: "weekday mornings" } }),
  ], "parking");
  assert.equal(parking.status, "conditional");
  for (const claim of parking.claims) {
    assert.equal(claim.quality.adjustments?.totalPenalty, 0);
    assert.ok(claim.quality.reasonCodes.includes("conditional_context_preserved"));
  }
  const ambience = score([fact({ id: "ambience", kind: "ambience", value: "lively", qualifiers: { when: "evening" } })], "ambience");
  assert.equal(ambience.claims[0].quality.qualityBand, "strong");
});

test("missing signals stay visible and do not receive fabricated components", () => {
  const claim = score([fact({ id: "missing", sourceType: null, observedAt: null, verifiedAt: null, expiresAt: null })]).claims[0];
  assert.equal(claim.quality.components?.freshness, null);
  assert.equal(claim.quality.components?.provenance, null);
  assert.deepEqual(claim.quality.missingSignals.sort(), ["freshness_timestamps", "source_type"]);
  assert.equal(claim.quality.adjustments?.missingSignalPenalty, 0.06);
});

test("unsupported grounding is explicitly not scorable", () => {
  const truth = buildConflictAwarePlaceKnowledge({ canonicalPlaceId: "place-quality", facts: [fact({ id: "unsupported" })], now: NOW });
  const claim = truth.knowledge.activity.claims[0];
  claim.supports[0].groundingValidation = "unsupported";
  const quality = scoreConflictAwareClaim(claim, { now: NOW });
  assert.equal(quality.qualityStatus, "not_scorable");
  assert.equal(quality.qualityScore, null);
  assert.ok(quality.reasonCodes.includes("unsupported_grounding"));
});

test("scoring never mutates truth-maintenance state or qualifiers", () => {
  const truth = buildConflictAwarePlaceKnowledge({
    canonicalPlaceId: "place-quality",
    facts: [fact({ id: "conditional", kind: "parking", value: "difficult", qualifiers: { when: "weekends" } })],
    now: NOW,
  });
  const before = structuredClone(truth);
  const scored = scoreConflictAwarePlaceKnowledge(truth, { now: NOW });
  assert.deepEqual(truth, before);
  assert.deepEqual(scored.knowledge.parking.claims[0].qualifiers, { when: "weekends" });
  assert.equal(scored.knowledge.parking.claims[0].truthState, truth.knowledge.parking.claims[0].status);
});
