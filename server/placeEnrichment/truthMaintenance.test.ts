import test from "node:test";
import assert from "node:assert/strict";
import type { GroundedPlaceKnowledgeRecord } from "./store";
import { buildConflictAwarePlaceKnowledge, canonicalFactIdentity } from "./truthMaintenance";

function fact(input: {
  id: string;
  source: string;
  kind: string;
  value: string;
  qualifiers?: Record<string, unknown>;
  observedAt?: string;
  expiresAt?: string;
  factConfidence?: number;
  groundingConfidence?: number;
  supportType?: "direct" | "inferred";
}): GroundedPlaceKnowledgeRecord {
  return {
    evidenceId: input.id,
    factType: `knowledge_${input.kind}`,
    kind: input.kind,
    value: input.value,
    qualifiers: input.qualifiers || {},
    factConfidence: input.factConfidence ?? 0.8,
    grounding: {
      supportType: input.supportType || "direct",
      sourceSignal: "caption",
      evidenceText: `${input.kind} evidence`,
      sourceField: "metadata.description",
      groundingConfidence: input.groundingConfidence ?? 0.95,
      span: { start: 0, end: 20, unit: "character" },
      validation: { status: "validated", method: "exact_span", reason: null },
    },
    provenance: { extractorName: "deterministic_place_knowledge", extractorVersion: "deep_v2" },
    sourceUrl: input.source,
    sourceType: "website_caption",
    sourceRecordId: input.id,
    extractorVersion: "deep_v2",
    model: null,
    observedAt: input.observedAt || "2026-01-01T00:00:00.000Z",
    verifiedAt: input.observedAt || "2026-01-01T00:00:00.000Z",
    expiresAt: input.expiresAt || "2027-01-01T00:00:00.000Z",
  };
}

function build(facts: GroundedPlaceKnowledgeRecord[]) {
  return buildConflictAwarePlaceKnowledge({
    canonicalPlaceId: "place-1",
    facts,
    now: new Date("2026-08-10T00:00:00.000Z"),
  });
}

test("semantic crowd wording accumulates one claim with independent support", () => {
  const result = build([
    fact({ id: "a", source: "https://a.example", kind: "crowd_note", value: "weekends get crowded", qualifiers: { crowdedAt: "weekend" } }),
    fact({ id: "b", source: "https://b.example", kind: "crowd_note", value: "crowded on weekends", qualifiers: { when: "weekends" } }),
  ]);
  const group = result.knowledge.crowd_note;
  assert.equal(group.status, "supported");
  assert.equal(group.claims.length, 1);
  assert.equal(group.claims[0].normalizedValue, "crowded");
  assert.equal(group.claims[0].supportCount, 2);
  assert.equal(group.claims[0].independentSourceCount, 2);
  assert.equal(result.audit[0].decision, "equivalent_support");
});

test("different parking conditions remain compatible conditional claims", () => {
  const result = build([
    fact({ id: "a", source: "https://a.example", kind: "parking", value: "difficult", qualifiers: { when: "weekends" } }),
    fact({ id: "b", source: "https://b.example", kind: "parking", value: "easy", qualifiers: { when: "weekday mornings" } }),
  ]);
  assert.equal(result.knowledge.parking.status, "conditional");
  assert.equal(result.knowledge.parking.claims.length, 2);
  assert.equal(result.audit.find((entry) => entry.factKind === "parking")?.decision, "compatible_conditions");
});

test("opposite booking requirements in the same activity context are disputed", () => {
  const result = build([
    fact({ id: "a", source: "https://a.example", kind: "booking_required", value: "true", qualifiers: { activity: "boat ride" } }),
    fact({ id: "b", source: "https://b.example", kind: "booking_required", value: "false", qualifiers: { activity: "boat ride" } }),
  ]);
  assert.equal(result.knowledge.booking_required.status, "disputed");
  assert.ok(result.knowledge.booking_required.claims.every((claim) => claim.status === "disputed"));
  assert.equal(result.audit[0].conflictDimension, "boolean_requirement");
});

test("expired historical pricing is superseded by a newer observed price", () => {
  const result = build([
    fact({
      id: "old",
      source: "https://old.example",
      kind: "pricing",
      value: "Rs. 700",
      observedAt: "2025-01-01T00:00:00.000Z",
      expiresAt: "2025-12-31T00:00:00.000Z",
    }),
    fact({
      id: "new",
      source: "https://new.example",
      kind: "pricing",
      value: "₹900",
      observedAt: "2026-06-01T00:00:00.000Z",
      expiresAt: "2027-06-01T00:00:00.000Z",
    }),
  ]);
  const group = result.knowledge.pricing;
  assert.equal(group.status, "supported");
  assert.equal(group.claims.find((claim) => claim.normalizedValue === "inr 700")?.status, "superseded");
  assert.equal(group.claims.find((claim) => claim.normalizedValue === "inr 900")?.claimId, group.preferredClaimId);
  assert.equal(result.audit[0].decision, "temporal_supersession");
});

test("three recommended-item variants become one claim with three supports", () => {
  const result = build([
    fact({ id: "a", source: "https://a.example", kind: "recommended_item", value: "the butter garlic prawns" }),
    fact({ id: "b", source: "https://b.example", kind: "recommended_item", value: "butter-garlic prawns" }),
    fact({ id: "c", source: "https://c.example", kind: "recommended_item", value: "Butter Garlic Prawns!" }),
  ]);
  const claim = result.knowledge.recommended_item.claims[0];
  assert.equal(result.knowledge.recommended_item.claims.length, 1);
  assert.equal(claim.normalizedValue, "butter garlic prawns");
  assert.equal(claim.supportCount, 3);
  assert.equal(claim.independentSourceCount, 3);
});

test("subjective ambience at different times coexists conditionally", () => {
  const result = build([
    fact({ id: "a", source: "https://a.example", kind: "ambience", value: "quiet", qualifiers: { when: "morning" } }),
    fact({ id: "b", source: "https://b.example", kind: "ambience", value: "lively", qualifiers: { when: "evening" } }),
  ]);
  assert.equal(result.knowledge.ambience.status, "conditional");
  assert.equal(result.audit[0].decision, "compatible_conditions");
});

test("relationship qualifier is part of canonical identity", () => {
  const boat = canonicalFactIdentity({ canonicalPlaceId: "place-1", kind: "operator", value: "Cardamom County", qualifiers: { relationship: "organised_by", activity: "boat ride" } });
  const safari = canonicalFactIdentity({ canonicalPlaceId: "place-1", kind: "operator", value: "Cardamom County", qualifiers: { relationship: "organised_by", activity: "safari" } });
  assert.notEqual(boat.semanticIdentity, safari.semanticIdentity);
});

test("quality policy can prefer stronger evidence without resolving a dispute", () => {
  const result = build([
    fact({ id: "a", source: "https://a.example", kind: "booking_required", value: "true", qualifiers: { activity: "boat ride" }, factConfidence: 0.98, groundingConfidence: 0.99 }),
    fact({ id: "b", source: "https://b.example", kind: "booking_required", value: "false", qualifiers: { activity: "boat ride" }, factConfidence: 0.3, groundingConfidence: 0.4, supportType: "inferred" }),
  ]);
  const group = result.knowledge.booking_required;
  assert.equal(group.status, "disputed");
  assert.ok(group.preferredClaimId);
  assert.equal(group.preferenceReason, "quality_policy_margin_prefers_claim_without_resolving_dispute");
});
