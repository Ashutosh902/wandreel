import test from "node:test";
import assert from "node:assert/strict";
import type { NormalizedPlaceKnowledge, NormalizedPlaceKnowledgeClaim, PlaceKnowledgeCollection } from "../placeEnrichment/readModel";
import { selectPlaceKnowledgeForStroll } from "./placeKnowledgeContext";

function claim(input: Partial<NormalizedPlaceKnowledgeClaim> & Pick<NormalizedPlaceKnowledgeClaim, "claimId" | "kind" | "value">): NormalizedPlaceKnowledgeClaim {
  return {
    claimId: input.claimId,
    kind: input.kind,
    value: input.value,
    normalizedValue: input.normalizedValue || input.value.toLowerCase(),
    qualifiers: input.qualifiers || {},
    truthState: input.truthState || "supported",
    quality: input.quality || { score: 0.82, evidenceStrength: 0.82, band: "strong", version: "knowledge_quality_v1", reasonCodes: [] },
    support: input.support || { count: 1, sourceCount: 1, evidenceIds: [`e-${input.claimId}`], sourceTypes: ["website_caption"] },
    grounding: input.grounding || { allValidated: true, supportTypes: ["direct"], signals: ["caption"], directSupportCount: 1, inferredSupportCount: 0 },
    freshness: input.freshness || { observedAt: null, verifiedAt: null, expiresAt: null },
  };
}

function model(entries: Partial<Record<PlaceKnowledgeCollection, NormalizedPlaceKnowledgeClaim[]>>, historical: Partial<Record<PlaceKnowledgeCollection, NormalizedPlaceKnowledgeClaim[]>> = {}): NormalizedPlaceKnowledge {
  const keys: PlaceKnowledgeCollection[] = ["recommendedItems", "activities", "bestTimes", "crowdNotes", "pricing", "parking", "ambience", "seatingTips", "operators", "bookingRequirements", "practicalInformation", "warnings", "creatorTips", "other"];
  const collections = Object.fromEntries(keys.map((key) => [key, entries[key] || []])) as NormalizedPlaceKnowledge["knowledge"];
  const history = Object.fromEntries(keys.map((key) => [key, historical[key] || []])) as NormalizedPlaceKnowledge["historical"];
  return {
    readModelVersion: "place_knowledge_read_v1",
    scoringVersion: "knowledge_quality_v1",
    canonicalPlaceId: "canonical-1",
    generatedAt: "2026-08-10T00:00:00.000Z",
    knowledge: collections,
    historical: history,
    summary: { currentClaimCount: Object.values(collections).flat().length, historicalClaimCount: Object.values(history).flat().length, disputedClaimCount: 0, conditionalClaimCount: 0, strongClaimCount: 0, usableClaimCount: 0, weakClaimCount: 0 },
  };
}

test("food context prioritizes recommendations while retaining weak supported facts", () => {
  const weakParking = claim({ claimId: "parking", kind: "parking", value: "difficult", quality: { score: 0.42, evidenceStrength: 0.47, band: "weak", version: "knowledge_quality_v1", reasonCodes: [] } });
  const recommendation = claim({ claimId: "food", kind: "recommended_item", value: "butter garlic prawns" });
  const selected = selectPlaceKnowledgeForStroll(model({ recommendedItems: [recommendation], parking: [weakParking] }), {
    category: "Taste",
    interests: ["Food"],
  });
  assert.equal(selected.selectedClaims[0].claimId, "food");
  assert.equal(selected.selectedClaims.some((item) => item.claimId === "parking"), true);
  assert.equal(selected.diagnostics.weakClaimsSelected, 1);
});

test("a context budget cannot expose only one side of a dispute", () => {
  const yes = claim({ claimId: "yes", kind: "booking_required", value: "true", truthState: "disputed", quality: { score: 0.7, evidenceStrength: 0.9, band: "disputed", version: "knowledge_quality_v1", reasonCodes: ["active_dispute"] } });
  const no = claim({ claimId: "no", kind: "booking_required", value: "false", truthState: "disputed", quality: { score: 0.69, evidenceStrength: 0.89, band: "disputed", version: "knowledge_quality_v1", reasonCodes: ["active_dispute"] } });
  const selected = selectPlaceKnowledgeForStroll(model({ bookingRequirements: [yes, no] }), { category: "Activity", interests: [], maxClaims: 1 });
  assert.deepEqual(new Set(selected.selectedClaims.map((item) => item.claimId)), new Set(["yes", "no"]));
  assert.equal(selected.diagnostics.disputedClaimsSelected, 2);
});

test("time matching is observable and historical claims are omitted explicitly", () => {
  const evening = claim({ claimId: "evening", kind: "best_time", value: "5 PM", qualifiers: { when: "evening" } });
  const stale = claim({ claimId: "stale", kind: "pricing", value: "inr 700", truthState: "stale", quality: { score: 0.4, evidenceStrength: 0.6, band: "weak", version: "knowledge_quality_v1", reasonCodes: ["stale_claim"] } });
  const selected = selectPlaceKnowledgeForStroll(model({ bestTimes: [evening] }, { pricing: [stale] }), { category: "Explore", interests: [], requestedStartTime: "18:00" });
  assert.ok(selected.selectedClaims[0].selection.reasonCodes.includes("time_qualifier_matches_stroll"));
  assert.deepEqual(selected.omittedClaims.find((item) => item.claimId === "stale")?.reason, "historical_not_current");
});

test("selection is deterministic apart from measured duration", () => {
  const input = model({ activities: [claim({ claimId: "boat", kind: "activity", value: "boat ride" })] });
  const first = selectPlaceKnowledgeForStroll(input, { category: "Activity", interests: ["Nature"] });
  const second = selectPlaceKnowledgeForStroll(input, { category: "Activity", interests: ["Nature"] });
  assert.deepEqual(first.selectedClaims, second.selectedClaims);
  assert.deepEqual(first.omittedClaims, second.omittedClaims);
});
