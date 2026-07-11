import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTrustedInputFingerprint,
  enrichStopDescriptionIfNeeded,
  shouldGenerateStopDescription,
  STROLL_STOP_ENRICHMENT_PROMPT_VERSION,
  validateStopDescriptionQuality,
  type StrollStopGenerationMetadata,
  type TrustedStrollStopInput,
} from "./enrichment";

function stop(overrides: Partial<TrustedStrollStopInput> = {}): TrustedStrollStopInput {
  return {
    stopId: "stop-1",
    placeId: "place-1",
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
