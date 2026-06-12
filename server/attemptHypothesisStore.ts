import type { ExtractionMode } from "./extraction/types";
import { canonicalizeUrl } from "./extraction/url";

export type PriorCandidateHypothesis = {
  name: string;
  categoryGuess: string | null;
  locality: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  address: string | null;
  locationHint: string | null;
  googleMapsQuery: string | null;
  confidence: "high" | "medium" | "low" | null;
  confidenceReason: string | null;
  missingFields: string[];
  uncertainFields: string[];
  rejectedFields: string[];
  source: "structured_entity" | "visual_candidate";
};

export type PriorAttemptHypothesisSummary = {
  attemptNumber: number;
  status: "ready" | "needs_review" | "no_supported_entity_found";
  previousBestResult: PriorCandidateHypothesis | null;
  candidateEntities: PriorCandidateHypothesis[];
  possibleMatches: PriorCandidateHypothesis[];
  candidatePlaceNames: string[];
  categoryGuesses: string[];
  locationHints: string[];
  confidenceReason: string | null;
  missingFields: string[];
  uncertainFields: string[];
  rejectedFields: string[];
};

type CacheEntry = {
  expiresAt: number;
  summary: PriorAttemptHypothesisSummary;
};

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function buildKey(mode: ExtractionMode, url: string, attemptNumber: number): string {
  return `${mode}:a${attemptNumber}:${canonicalizeUrl(url)}`;
}

export function saveAttemptHypothesisSummary(input: {
  mode: ExtractionMode;
  url: string;
  attemptNumber: number;
  summary: PriorAttemptHypothesisSummary;
  ttlMs?: number;
}) {
  cache.set(buildKey(input.mode, input.url, input.attemptNumber), {
    expiresAt: Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS),
    summary: JSON.parse(JSON.stringify(input.summary)) as PriorAttemptHypothesisSummary,
  });
}

export function getAttemptHypothesisSummary(input: {
  mode: ExtractionMode;
  url: string;
  attemptNumber: number;
}): PriorAttemptHypothesisSummary | null {
  const cached = cache.get(buildKey(input.mode, input.url, input.attemptNumber));
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cache.delete(buildKey(input.mode, input.url, input.attemptNumber));
    return null;
  }
  return JSON.parse(JSON.stringify(cached.summary)) as PriorAttemptHypothesisSummary;
}
