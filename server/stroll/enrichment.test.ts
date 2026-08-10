import test from "node:test";
import assert from "node:assert/strict";
import {
  auditStrollKnowledgeAttribution,
  buildTrustedInputFingerprint,
  enrichStopDescriptionIfNeeded,
  shouldGenerateStopDescription,
  STROLL_STOP_ENRICHMENT_PROMPT_VERSION,
  validateStopDescriptionQuality,
  type StrollStopGenerationMetadata,
  type TrustedStrollStopInput,
} from "./enrichment";
import type { StrollPlaceKnowledgeContext } from "./placeKnowledgeContext";

function knowledgeContext(input: {
  claimId?: string;
  kind?: string;
  value?: string;
  qualifiers?: Record<string, unknown>;
  truthState?: "supported" | "conditionally_supported" | "disputed";
} = {}): StrollPlaceKnowledgeContext {
  const claimId = input.claimId || "claim-boat";
  return {
    selectionVersion: "stroll_place_knowledge_selection_v1",
    readModelVersion: "place_knowledge_read_v1",
    scoringVersion: "knowledge_quality_v1",
    canonicalPlaceId: "canonical-1",
    selectedClaims: [{
      claimId,
      kind: input.kind || "activity",
      value: input.value || "boat ride",
      normalizedValue: (input.value || "boat ride").toLowerCase(),
      qualifiers: input.qualifiers || {},
      truthState: input.truthState || "supported",
      quality: { score: 0.84, evidenceStrength: 0.84, band: input.truthState === "disputed" ? "disputed" : "strong", version: "knowledge_quality_v1", reasonCodes: [] },
      support: { count: 1, sourceCount: 1, evidenceIds: ["evidence-1"], sourceTypes: ["website_caption"] },
      grounding: { allValidated: true, supportTypes: ["direct"], signals: ["caption"], directSupportCount: 1, inferredSupportCount: 0 },
      freshness: { observedAt: null, verifiedAt: null, expiresAt: null },
      collection: input.kind === "parking" ? "parking" : input.kind === "booking_required" ? "bookingRequirements" : "activities",
      selection: { score: 1, reasonCodes: ["kind_relevance"] },
    }],
    omittedClaims: [],
    diagnostics: { availableCurrentClaims: 1, availableHistoricalClaims: 0, selectedClaimCount: 1, omittedClaimCount: 0, disputedClaimsSelected: input.truthState === "disputed" ? 1 : 0, weakClaimsSelected: 0, selectionDurationMs: 0 },
  };
}

function stop(overrides: Partial<TrustedStrollStopInput> = {}): TrustedStrollStopInput {
  return {
    stopId: "stop-1",
    placeId: "place-1",
    canonicalPlaceId: "canonical-1",
    sequence: 1,
    existingGeneratedDescription: null,
    existingReason: null,
    existingGenerationMeta: null,
    placeTitle: "Golghar",
    placeCategory: "Explore",
    placeLocality: "Patna",
    placeAddress: "Golghar, Patna",
    placeDescription: null,
    placeMetaPrimary: "Landmark",
    placeMetaSecondary: "Riverfront viewpoint with open grounds",
    sourceCaption: "An evening around Golghar and Gandhi Maidan.",
    sourceUrl: "https://example.com/reel",
    placeKnowledgeContext: null,
    ...overrides,
  };
}

test("description quality check passes brief grounded copy and fails unsafe claims", () => {
  assert.equal(validateStopDescriptionQuality("A calm riverside landmark stop with open grounds and easy city context.").ok, true);
  assert.equal(validateStopDescriptionQuality("Nice.").ok, false);
  assert.match(validateStopDescriptionQuality("The most popular award-winning place in Patna.").reasons.join(","), /unsupported_awards/);
  assert.match(validateStopDescriptionQuality("Turn left here and walk along the route.").reasons.join(","), /directions_claim/);
  assert.match(validateStopDescriptionQuality("Open daily with no closures or traffic nearby.").reasons.join(","), /traffic_claim|closure_claim|opening_status_claim/);
  assert.match(validateStopDescriptionQuality("Built in the 18th century as an ancient landmark.").reasons.join(","), /unsupported_historical_claim/);
});

test("generation runs only when stored descriptions are missing or low quality", async () => {
  let calls = 0;
  const result = await enrichStopDescriptionIfNeeded(stop(), async () => {
    calls += 1;
    return {
      description: "A compact landmark stop grounded by stored locality and saved-place context.",
      whyThisStop: "It starts the Stroll with a saved Explore place.",
      usedKnowledgeClaimIds: [],
      model: "test-model",
    };
  });

  assert.equal(calls, 1);
  assert.equal(result?.description, "A compact landmark stop grounded by stored locality and saved-place context.");

  const skipped = await enrichStopDescriptionIfNeeded(stop({
    placeDescription: "A saved landmark note with enough local context for the Stroll stop.",
  }), async () => {
    calls += 1;
    throw new Error("should not run");
  });

  assert.equal(skipped, null);
  assert.equal(calls, 1);
});

test("accepted generation is reused while source fingerprint is unchanged", () => {
  const input = stop();
  const fingerprint = buildTrustedInputFingerprint(input);
  const metadata: StrollStopGenerationMetadata = {
    model: "test-model",
    promptVersion: STROLL_STOP_ENRICHMENT_PROMPT_VERSION,
    validationVersion: "stroll_stop_validation_v1",
    sourceInputFingerprint: fingerprint,
    generatedAt: "2026-07-11T10:00:00.000Z",
    validationStatus: "accepted",
    validationReasons: [],
    trustedInputKeys: ["placeTitle"],
    knowledgeAttribution: {
      canonicalPlaceId: "canonical-1",
      selectionVersion: null,
      suppliedClaimIds: [],
      selectedClaims: [],
      omittedClaims: [],
      usedClaimIds: [],
      invalidClaimIds: [],
      statementAudit: [],
    },
  };

  assert.deepEqual(shouldGenerateStopDescription(stop({
    existingGeneratedDescription: "A compact landmark stop grounded by stored locality and saved-place context.",
    existingGenerationMeta: metadata,
  }), fingerprint), { shouldGenerate: false, reason: "cached_generated_description" });
});

test("input changes invalidate cached generation", () => {
  const input = stop();
  const fingerprint = buildTrustedInputFingerprint(input);
  const metadata: StrollStopGenerationMetadata = {
    model: "test-model",
    promptVersion: STROLL_STOP_ENRICHMENT_PROMPT_VERSION,
    validationVersion: "stroll_stop_validation_v1",
    sourceInputFingerprint: fingerprint,
    generatedAt: "2026-07-11T10:00:00.000Z",
    validationStatus: "accepted",
    validationReasons: [],
    trustedInputKeys: ["placeTitle"],
    knowledgeAttribution: {
      canonicalPlaceId: "canonical-1",
      selectionVersion: null,
      suppliedClaimIds: [],
      selectedClaims: [],
      omittedClaims: [],
      usedClaimIds: [],
      invalidClaimIds: [],
      statementAudit: [],
    },
  };
  const changed = stop({
    existingGeneratedDescription: "A compact landmark stop grounded by stored locality and saved-place context.",
    existingGenerationMeta: metadata,
    placeAddress: "Updated address, Patna",
  });

  assert.equal(shouldGenerateStopDescription(changed).shouldGenerate, true);
});

test("invalid output is rejected without saving generated copy", async () => {
  const result = await enrichStopDescriptionIfNeeded(stop(), async () => ({
    description: "This famous top-rated stop is open daily with no traffic.",
    whyThisStop: null,
    usedKnowledgeClaimIds: [],
    model: "test-model",
  }));

  assert.equal(result?.description, null);
  assert.equal(result?.metadata.validationStatus, "rejected");
  assert.match(result?.metadata.validationReasons.join(",") || "", /unsupported_awards_or_popularity|traffic_claim|opening_status_claim/);
});

test("AI failure falls back with provider_failed metadata", async () => {
  const result = await enrichStopDescriptionIfNeeded(stop(), async () => {
    throw new Error("provider unavailable");
  });

  assert.equal(result?.description, null);
  assert.equal(result?.metadata.validationStatus, "provider_failed");
  assert.match(result?.metadata.validationReasons.join(","), /provider unavailable/);
});

test("accepted enrichment persists model prompt fingerprint timestamp and validation status", async () => {
  const result = await enrichStopDescriptionIfNeeded(stop(), async (_input, context) => ({
    description: "A compact landmark stop grounded by stored locality and saved-place context.",
    whyThisStop: "It is one of the saved stops in this Stroll.",
    usedKnowledgeClaimIds: [],
    model: "test-model",
    raw: context,
  }));

  assert.equal(result?.metadata.model, "test-model");
  assert.equal(result?.metadata.promptVersion, STROLL_STOP_ENRICHMENT_PROMPT_VERSION);
  assert.equal(result?.metadata.sourceInputFingerprint.length, 64);
  assert.equal(result?.metadata.validationStatus, "accepted");
  assert.ok(result?.metadata.generatedAt);
  assert.deepEqual(result?.metadata.validationReasons, []);
});

test("raw caption and source URL no longer affect the trusted prompt fingerprint", () => {
  const first = buildTrustedInputFingerprint(stop({ sourceCaption: "Original raw caption", sourceUrl: "https://one.test" }));
  const second = buildTrustedInputFingerprint(stop({ sourceCaption: "Changed raw caption", sourceUrl: "https://two.test" }));
  assert.equal(first, second);
});

test("supported Place Knowledge is attributable in accepted stop copy", async () => {
  const context = knowledgeContext();
  const result = await enrichStopDescriptionIfNeeded(stop({ placeKnowledgeContext: context }), async () => ({
    description: "Enjoy a boat ride as the central activity during this stop.",
    whyThisStop: "It adds an active experience to the Stroll.",
    usedKnowledgeClaimIds: ["claim-boat"],
    model: "test-model",
  }));
  assert.equal(result?.metadata.validationStatus, "accepted");
  assert.equal(result?.metadata.knowledgeAttribution.statementAudit[0].classification, "A_supported_knowledge");
  assert.deepEqual(result?.metadata.knowledgeAttribution.usedClaimIds, ["claim-boat"]);
});

test("unsupported place-specific food claim is rejected as category C", async () => {
  const result = await enrichStopDescriptionIfNeeded(stop({ placeKnowledgeContext: knowledgeContext() }), async () => ({
    description: "Order the secret noodles for a memorable meal at this stop.",
    whyThisStop: null,
    usedKnowledgeClaimIds: [],
    model: "test-model",
  }));
  assert.equal(result?.metadata.validationStatus, "rejected");
  assert.equal(result?.metadata.knowledgeAttribution.statementAudit[0].classification, "C_unsupported_place_claim");
  assert.match(result?.metadata.validationReasons.join(",") || "", /place_specific_fact_without_matching_claim/);
});

test("conditional knowledge must preserve its qualifier", async () => {
  const context = knowledgeContext({ claimId: "claim-parking", kind: "parking", value: "difficult", qualifiers: { when: "weekends" }, truthState: "conditionally_supported" });
  const rejected = await enrichStopDescriptionIfNeeded(stop({ placeKnowledgeContext: context }), async () => ({
    description: "Parking is difficult near this stop, so plan ahead with care.",
    whyThisStop: null,
    usedKnowledgeClaimIds: ["claim-parking"],
    model: "test-model",
  }));
  assert.equal(rejected?.metadata.validationStatus, "rejected");
  assert.match(rejected?.metadata.validationReasons.join(",") || "", /conditional_qualifier_missing/);

  const accepted = await enrichStopDescriptionIfNeeded(stop({ placeKnowledgeContext: context }), async () => ({
    description: "Parking is difficult on weekends, so plan this stop with care.",
    whyThisStop: null,
    usedKnowledgeClaimIds: ["claim-parking"],
    model: "test-model",
  }));
  assert.equal(accepted?.metadata.validationStatus, "accepted");
});

test("disputed knowledge cannot be stated as settled fact", () => {
  const context = knowledgeContext({ claimId: "claim-booking", kind: "booking_required", value: "true", qualifiers: { activity: "boat ride" }, truthState: "disputed" });
  const audit = auditStrollKnowledgeAttribution({
    stop: stop({ placeKnowledgeContext: context }),
    description: "Booking is required for the boat ride at this stop.",
    whyThisStop: null,
    usedKnowledgeClaimIds: ["claim-booking"],
  });
  assert.equal(audit.statementAudit[0].classification, "C_unsupported_place_claim");
  assert.ok(audit.statementAudit[0].reasonCodes.includes("dispute_stated_as_settled"));
});
