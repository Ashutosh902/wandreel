import type { ExtractionResult, VisualSearchCandidate } from "../extraction/types";
import type { IntelligencePipelineResult, StructuredEntity } from "./types";
import type { PriorAttemptHypothesisSummary, PriorCandidateHypothesis } from "../attemptHypothesisStore";

function compactLocationHint(input: {
  locality?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  address?: string | null;
}): string | null {
  return (
    [input.locality, input.city, input.state, input.country].filter(Boolean).join(", ").trim() ||
    String(input.address || "").trim() ||
    null
  );
}

function computeMissingFields(candidate: {
  categoryGuess?: string | null;
  locality?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  address?: string | null;
  googleMapsQuery?: string | null;
}) {
  const fields: string[] = [];
  if (!candidate.categoryGuess) fields.push("category");
  if (!candidate.locality) fields.push("locality");
  if (!candidate.city) fields.push("city");
  if (!candidate.state) fields.push("state");
  if (!candidate.country) fields.push("country");
  if (!candidate.address) fields.push("address");
  if (!candidate.googleMapsQuery) fields.push("googleMapsQuery");
  return fields;
}

function toStructuredHypothesis(entity: StructuredEntity, status: string, confidenceReason: string | null): PriorCandidateHypothesis {
  const missingFields = computeMissingFields({
    categoryGuess: entity.category,
    locality: entity.locality,
    city: entity.city,
    state: entity.state,
    country: entity.country,
    address: entity.address,
    googleMapsQuery: entity.googleMapsQuery,
  });
  return {
    name: entity.name,
    categoryGuess: entity.category,
    locality: entity.locality,
    city: entity.city,
    state: entity.state,
    country: entity.country,
    address: entity.address,
    locationHint: compactLocationHint(entity),
    googleMapsQuery: entity.googleMapsQuery,
    confidence: entity.confidence,
    confidenceReason: entity.evidenceText || confidenceReason,
    missingFields,
    uncertainFields: entity.confidence === "low" || status !== "ready" ? missingFields : [],
    rejectedFields: [],
    source: "structured_entity",
  };
}

function toVisualHypothesis(candidate: VisualSearchCandidate, confidenceReason: string | null): PriorCandidateHypothesis {
  const missingFields = computeMissingFields({
    categoryGuess: candidate.categoryHint || null,
    locality: candidate.locality,
    city: candidate.city,
    state: candidate.state,
    country: candidate.country,
    address: candidate.formattedAddress,
    googleMapsQuery: candidate.query,
  });
  return {
    name: candidate.candidateName || candidate.query,
    categoryGuess: candidate.categoryHint || null,
    locality: candidate.locality,
    city: candidate.city,
    state: candidate.state,
    country: candidate.country,
    address: candidate.formattedAddress,
    locationHint: candidate.locationHint || compactLocationHint({
      locality: candidate.locality,
      city: candidate.city,
      state: candidate.state,
      country: candidate.country,
      address: candidate.formattedAddress,
    }),
    googleMapsQuery: candidate.query,
    confidence: candidate.finalConfidence || candidate.verificationConfidence || null,
    confidenceReason: candidate.reason || candidate.visualEvidence || confidenceReason,
    missingFields,
    uncertainFields: (candidate.finalConfidence || candidate.verificationConfidence) === "low" ? missingFields : [],
    rejectedFields: [],
    source: "visual_candidate",
  };
}

function dedupeCandidates(items: PriorCandidateHypothesis[]): PriorCandidateHypothesis[] {
  const seen = new Set<string>();
  const out: PriorCandidateHypothesis[] = [];
  for (const item of items) {
    const key = [
      String(item.name || "").trim().toLowerCase(),
      String(item.categoryGuess || "").trim().toLowerCase(),
      String(item.locationHint || "").trim().toLowerCase(),
    ].join("|");
    if (!item.name || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function buildAttemptHypothesisSummary(input: {
  source: ExtractionResult;
  result: IntelligencePipelineResult;
  attemptNumber: number;
}): PriorAttemptHypothesisSummary {
  const confidenceReason =
    input.result.output.visibility?.reason ||
    input.result.output.structuredEntities[0]?.evidenceText ||
    input.source.visualFallback?.summaryText ||
    null;

  const candidateEntities = input.result.output.structuredEntities
    .slice(0, 5)
    .map((entity) => toStructuredHypothesis(entity, input.result.output.status, confidenceReason));

  const visualCandidates = (input.source.visualFallback?.candidates || [])
    .slice(0, 5)
    .map((candidate) => toVisualHypothesis(candidate, confidenceReason));

  const possibleMatches = dedupeCandidates([
    ...candidateEntities,
    ...visualCandidates,
  ]).slice(0, 8);

  const previousBestResult = possibleMatches[0] || null;
  const missingFields = previousBestResult?.missingFields || [];
  const uncertainFields = previousBestResult?.uncertainFields || [];
  const rejectedFields = previousBestResult?.rejectedFields || [];

  return {
    attemptNumber: input.attemptNumber,
    status: input.result.output.status,
    previousBestResult,
    candidateEntities,
    possibleMatches,
    candidatePlaceNames: Array.from(new Set(possibleMatches.map((item) => item.name).filter(Boolean))),
    categoryGuesses: Array.from(new Set(possibleMatches.map((item) => item.categoryGuess).filter(Boolean))) as string[],
    locationHints: Array.from(new Set(possibleMatches.map((item) => item.locationHint).filter(Boolean))) as string[],
    confidenceReason,
    missingFields,
    uncertainFields,
    rejectedFields,
  };
}
