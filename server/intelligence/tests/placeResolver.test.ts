import assert from "node:assert/strict";
import test from "node:test";
import type { ExtractionResult } from "../../extraction/types";
import {
  buildResolveSearchQueries,
  evaluateResolvedCandidate,
  inferPlaceResolveContext,
  type PlaceResolveContext,
  type PlaceResolveResult,
} from "../placeResolver";
import type { StructuredEntity } from "../types";

function buildSource(description: string): ExtractionResult {
  return {
    mode: "deep",
    metadata: {
      sourceUrl: "https://www.instagram.com/p/test/",
      canonicalUrl: "https://www.instagram.com/p/test/",
      platform: "instagram",
      title: "Farmers market in Bangalore",
      description,
      siteName: "Instagram",
      imageUrl: null,
      fetchedAtIso: new Date().toISOString(),
      provider: "instagram_script",
    },
    transcript: { attempted: false, used: false, source: null, text: "", reason: null },
    ocr: { attempted: false, used: false, text: "", reason: null },
    source: "https://www.instagram.com/p/test/",
    platform: "instagram",
    canonicalUrl: "https://www.instagram.com/p/test/",
    combinedTextRaw: description,
    combinedTextClean: description,
  };
}

function buildEntity(overrides: Partial<StructuredEntity> = {}): StructuredEntity {
  return {
    name: "Superbrew",
    category: "eat",
    locality: null,
    city: null,
    state: null,
    country: null,
    address: null,
    confidence: "medium",
    googleMapsQuery: null,
    evidenceText: "@superbrew.in for authentic Japanese ceremonial grade matcha",
    intent: { l1: "taste", l2: "Cafe", l3: [] },
    ...overrides,
  };
}

function buildCandidate(overrides: Partial<PlaceResolveResult> = {}): PlaceResolveResult {
  return {
    placeId: "place_1",
    photoUrl: null,
    formattedAddress: "123 Test Address",
    locality: null,
    city: null,
    state: null,
    country: null,
    lat: 12.97,
    lng: 77.59,
    confidence: "medium",
    provider: "google_maps",
    ...overrides,
  };
}

test("inferPlaceResolveContext picks Bangalore India from caption text", () => {
  const context = inferPlaceResolveContext(
    buildSource("Farmers market at 6 am in Bangalore, India with local vendors"),
    [buildEntity()],
  );

  assert.deepEqual(context, {
    locality: null,
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    strength: "strong",
  });
});

test("buildResolveSearchQueries uses cleaned name and original handle with city context", () => {
  const queries = buildResolveSearchQueries(
    buildEntity(),
    {
      locality: null,
      city: "Bengaluru",
      state: "Karnataka",
      country: "India",
      strength: "strong",
    },
  );

  assert.equal(queries.includes("Superbrew Bengaluru, Karnataka, India"), true);
  assert.equal(queries.includes("@superbrew.in Bengaluru, Karnataka, India"), true);
  assert.equal(queries.includes("superbrew.in Bengaluru, Karnataka, India"), true);
});

test("evaluateResolvedCandidate ranks Bangalore match above foreign match under Bangalore context", () => {
  const entity = buildEntity();
  const context: PlaceResolveContext = {
    locality: null,
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    strength: "strong",
  };

  const local = evaluateResolvedCandidate(
    entity,
    context,
    buildCandidate({
      formattedAddress: "Indiranagar, Bengaluru, Karnataka 560038, India",
      locality: "Indiranagar",
      city: "Bengaluru",
      state: "Karnataka",
      country: "India",
    }),
  );
  const foreign = evaluateResolvedCandidate(
    entity,
    context,
    buildCandidate({
      formattedAddress: "Boston, Suffolk County, Massachusetts, USA",
      city: "Boston",
      state: "Massachusetts",
      country: "United States",
    }),
  );

  assert.equal(local.accepted, true);
  assert.equal(foreign.accepted, false);
  assert.equal(local.score > foreign.score, true);
});

test("evaluateResolvedCandidate rejects lone foreign match when Bangalore context is strong", () => {
  const evaluation = evaluateResolvedCandidate(
    buildEntity({ name: "Sprout", evidenceText: "@sprout.og loved their morning buns and multigrain cookies" }),
    {
      locality: null,
      city: "Bengaluru",
      state: "Karnataka",
      country: "India",
      strength: "strong",
    },
    buildCandidate({
      formattedAddress: "Bend, Deschutes County, Oregon, USA",
      city: "Bend",
      state: "Oregon",
      country: "United States",
    }),
  );

  assert.equal(evaluation.accepted, false);
  assert.equal(evaluation.score < 0, true);
});
