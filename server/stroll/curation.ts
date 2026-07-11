import type { StrollSummary } from "./types";

export const STROLL_CURATION_VERSION = "deterministic_saved_places_v1";

const MIN_GENERATED_STOPS = 2;
const TARGET_GENERATED_STOPS = 5;
const MAX_GENERATED_STOPS = 7;
const MAX_CLUSTER_RADIUS_METERS = 35_000;
const MAX_PAIRWISE_DISTANCE_METERS = 60_000;

export type SavedPlaceForStrollCuration = {
  id: string;
  placeId: string;
  title: string;
  category: string | null;
  metadata: unknown;
  createdAt: string | null;
  updatedAt: string | null;
};

export type GeneratedStrollStop = {
  placeId: string;
  sequence: number;
  reason: string;
  estimatedVisitDurationMinutes: number;
  routeDistanceMeters: number | null;
  routeDurationMinutes: number | null;
};

export type GeneratedStrollPlan = {
  version: string;
  stops: GeneratedStrollStop[];
  totalDistanceMeters: number;
  estimatedDurationMinutes: number;
};

type Candidate = {
  place: SavedPlaceForStrollCuration;
  metadata: Record<string, unknown>;
  latitude: number;
  longitude: number;
  categoryKey: string;
  citySignals: string[];
  score: number;
  scoreParts: {
    interest: number;
    category: number;
    geography: number;
    quality: number;
    confidence: number;
  };
};

export class StrollCurationPipelineError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StrollCurationPipelineError";
    this.code = code;
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataNumber(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function normalizeText(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(values: Array<string | null | undefined>) {
  return new Set(values.flatMap((value) => normalizeText(value).split(" ").filter(Boolean)));
}

function haversineMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radiusMeters = 6_371_000;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return Math.round(radiusMeters * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function categoryKey(category: string | null, metadata: Record<string, unknown>) {
  const raw = normalizeText([
    category,
    metadataString(metadata, "l1"),
    metadataString(metadata, "category"),
    metadataString(metadata, "placeType"),
    metadataString(metadata, "experienceTag"),
  ].filter(Boolean).join(" "));

  if (/\b(food|taste|restaurant|cafe|bakery|dessert|street)\b/.test(raw)) return "taste";
  if (/\b(stay|hotel|resort|homestay)\b/.test(raw)) return "stay";
  if (/\b(do|activity|workshop|comedy|night|market)\b/.test(raw)) return "do";
  if (/\b(explore|see|heritage|museum|temple|park|fort|monument|view|waterfall)\b/.test(raw)) return "explore";
  return raw.split(" ")[0] || "other";
}

function citySignals(metadata: Record<string, unknown>) {
  return [
    metadataString(metadata, "city"),
    metadataString(metadata, "resolvedCity"),
    metadataString(metadata, "placeCity"),
    metadataString(metadata, "locality"),
    metadataString(metadata, "fullAddress"),
    metadataString(metadata, "address"),
  ].filter((value): value is string => Boolean(value));
}

function matchesRequestedCity(requestedCity: string, metadata: Record<string, unknown>) {
  const requested = normalizeText(requestedCity);
  if (!requested) return false;
  return citySignals(metadata).some((signal) => {
    const normalized = normalizeText(signal);
    return normalized === requested || normalized.includes(requested) || requested.includes(normalized);
  });
}

function metadataQuality(metadata: Record<string, unknown>, place: SavedPlaceForStrollCuration) {
  let score = 0;
  if (place.title.trim()) score += 0.2;
  if (metadataString(metadata, "description") || metadataString(metadata, "latestDescription") || metadataString(metadata, "metaSecondary")) score += 0.25;
  if (metadataString(metadata, "locality") || metadataString(metadata, "fullAddress") || metadataString(metadata, "address")) score += 0.2;
  if (metadataString(metadata, "imageUrl")) score += 0.1;
  if (metadataString(metadata, "sourceUrl") || metadataString(metadata, "videoUrl")) score += 0.1;
  if (metadataString(metadata, "placeId") || place.placeId) score += 0.15;
  return Math.min(1, score);
}

function confidenceScore(metadata: Record<string, unknown>) {
  const numeric =
    metadataNumber(metadata, "confidence") ??
    metadataNumber(metadata, "placeConfidence") ??
    metadataNumber(metadata, "searchVerificationScore");
  if (numeric != null) return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
  const text = normalizeText(metadataString(metadata, "finalConfidence") || metadataString(metadata, "confidenceLabel"));
  if (text === "high") return 0.95;
  if (text === "medium") return 0.7;
  if (text === "low") return 0.35;
  return 0.55;
}

function interestScore(stroll: StrollSummary, candidate: Pick<Candidate, "place" | "metadata" | "categoryKey">) {
  const interests = stroll.interests.map(normalizeText).filter(Boolean);
  if (!interests.length) return 0.45;

  const haystack = normalizeText([
    candidate.place.title,
    candidate.place.category,
    candidate.categoryKey,
    metadataString(candidate.metadata, "description"),
    metadataString(candidate.metadata, "latestDescription"),
    metadataString(candidate.metadata, "metaPrimary"),
    metadataString(candidate.metadata, "metaSecondary"),
    metadataString(candidate.metadata, "experienceTag"),
    metadataString(candidate.metadata, "placeType"),
  ].filter(Boolean).join(" "));

  const categoryMatches = interests.filter((interest) => {
    if (interest === "food" || interest === "cafe" || interest === "taste") return candidate.categoryKey === "taste";
    if (interest === "heritage" || interest === "explore" || interest === "sightseeing") return candidate.categoryKey === "explore";
    if (interest === "activity" || interest === "things to do") return candidate.categoryKey === "do";
    return candidate.categoryKey.includes(interest) || haystack.includes(interest);
  }).length;

  return Math.min(1, categoryMatches / Math.max(1, interests.length));
}

function categoryRelevance(candidate: Pick<Candidate, "categoryKey">) {
  if (candidate.categoryKey === "other") return 0.35;
  return 0.7;
}

function geographyScore(candidate: { latitude: number; longitude: number }, origin: { latitude: number; longitude: number } | null) {
  if (!origin) return 0.65;
  const distance = haversineMeters(candidate, origin);
  if (distance <= 2_000) return 1;
  if (distance <= 8_000) return 0.85;
  if (distance <= 20_000) return 0.65;
  if (distance <= MAX_CLUSTER_RADIUS_METERS) return 0.4;
  return 0.15;
}

function candidateSort(a: Candidate, b: Candidate) {
  if (b.score !== a.score) return b.score - a.score;
  const titleCompare = a.place.title.localeCompare(b.place.title);
  if (titleCompare !== 0) return titleCompare;
  return a.place.placeId.localeCompare(b.place.placeId);
}

function buildCandidates(stroll: StrollSummary, savedPlaces: SavedPlaceForStrollCuration[]) {
  const origin = stroll.latitude != null && stroll.longitude != null
    ? { latitude: stroll.latitude, longitude: stroll.longitude }
    : null;
  const seenPlaceIds = new Set<string>();
  const candidates: Candidate[] = [];

  for (const place of savedPlaces) {
    const placeId = place.placeId.trim();
    if (!placeId || seenPlaceIds.has(placeId)) continue;
    seenPlaceIds.add(placeId);

    const metadata = toRecord(place.metadata);
    const latitude = metadataNumber(metadata, "lat") ?? metadataNumber(metadata, "latitude");
    const longitude = metadataNumber(metadata, "lng") ?? metadataNumber(metadata, "longitude");
    if (latitude == null || longitude == null) continue;
    if (!matchesRequestedCity(stroll.city, metadata)) continue;

    const baseCandidate = {
      place,
      metadata,
      latitude,
      longitude,
      categoryKey: categoryKey(place.category, metadata),
      citySignals: citySignals(metadata),
    };
    const scoreParts = {
      interest: interestScore(stroll, baseCandidate),
      category: categoryRelevance(baseCandidate),
      geography: geographyScore(baseCandidate, origin),
      quality: metadataQuality(metadata, place),
      confidence: confidenceScore(metadata),
    };
    candidates.push({
      ...baseCandidate,
      scoreParts,
      score:
        scoreParts.interest * 0.3 +
        scoreParts.category * 0.18 +
        scoreParts.geography * 0.2 +
        scoreParts.quality * 0.2 +
        scoreParts.confidence * 0.12,
    });
  }

  return candidates.sort(candidateSort);
}

function isSingleTheme(stroll: StrollSummary) {
  const interests = stroll.interests.map(normalizeText).filter(Boolean);
  if (interests.length <= 1) return true;
  const tokens = tokenSet(interests);
  const themeGroups = [
    ["food", "taste", "cafe", "restaurant"],
    ["heritage", "explore", "sightseeing", "temple", "museum"],
    ["activity", "do", "workshop", "market"],
  ];
  return themeGroups.some((group) => [...tokens].every((token) => group.includes(token)));
}

function chooseDiverseCandidates(stroll: StrollSummary, candidates: Candidate[]) {
  const target = Math.min(MAX_GENERATED_STOPS, Math.max(MIN_GENERATED_STOPS, Math.min(TARGET_GENERATED_STOPS, candidates.length)));
  const selected: Candidate[] = [];
  const categoryCounts = new Map<string, number>();
  const singleTheme = isSingleTheme(stroll);

  for (const candidate of candidates) {
    const count = categoryCounts.get(candidate.categoryKey) ?? 0;
    if (!singleTheme && count >= 2 && selected.length < target - 1) continue;
    selected.push(candidate);
    categoryCounts.set(candidate.categoryKey, count + 1);
    if (selected.length >= target) break;
  }

  if (selected.length < target) {
    for (const candidate of candidates) {
      if (selected.includes(candidate)) continue;
      selected.push(candidate);
      if (selected.length >= target) break;
    }
  }

  return selected;
}

function centroid(candidates: Candidate[]) {
  return {
    latitude: candidates.reduce((sum, candidate) => sum + candidate.latitude, 0) / candidates.length,
    longitude: candidates.reduce((sum, candidate) => sum + candidate.longitude, 0) / candidates.length,
  };
}

function validateCluster(candidates: Candidate[]) {
  const center = centroid(candidates);
  const radius = Math.max(...candidates.map((candidate) => haversineMeters(candidate, center)));
  if (radius > MAX_CLUSTER_RADIUS_METERS) {
    throw new StrollCurationPipelineError("geographically_incoherent", "Eligible saved places are too spread out for one Stroll.");
  }

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (haversineMeters(candidates[i], candidates[j]) > MAX_PAIRWISE_DISTANCE_METERS) {
        throw new StrollCurationPipelineError("geographically_incoherent", "Eligible saved places mix locations that are too far apart.");
      }
    }
  }
}

function routeCandidates(stroll: StrollSummary, candidates: Candidate[]) {
  const remaining = [...candidates];
  const route: Candidate[] = [];
  let current = stroll.latitude != null && stroll.longitude != null
    ? { latitude: stroll.latitude, longitude: stroll.longitude }
    : null;

  while (remaining.length) {
    remaining.sort((a, b) => {
      const aDistance = current ? haversineMeters(a, current) : a.latitude - b.latitude;
      const bDistance = current ? haversineMeters(b, current) : b.latitude - a.latitude;
      if (aDistance !== bDistance) return aDistance - bDistance;
      return candidateSort(a, b);
    });
    const next = remaining.shift()!;
    route.push(next);
    current = { latitude: next.latitude, longitude: next.longitude };
  }

  return route;
}

function estimatedVisitDuration(candidate: Candidate) {
  const explicit = metadataNumber(candidate.metadata, "estimatedVisitDurationMinutes") ?? metadataNumber(candidate.metadata, "visitDurationMinutes");
  if (explicit != null) return Math.max(15, Math.min(180, Math.round(explicit)));
  if (candidate.categoryKey === "taste") return 45;
  if (candidate.categoryKey === "stay") return 30;
  return 50;
}

function routeDurationMinutes(distanceMeters: number) {
  if (distanceMeters <= 0) return 0;
  return Math.max(1, Math.round(distanceMeters / 75));
}

function reasonForStop(stroll: StrollSummary, candidate: Candidate) {
  const matchedInterest = stroll.interests.find((interest) => {
    const normalized = normalizeText(interest);
    return normalized && (
      (normalized === "food" && candidate.categoryKey === "taste") ||
      (normalized === "heritage" && candidate.categoryKey === "explore") ||
      (normalized === "activity" && candidate.categoryKey === "do") ||
      candidate.categoryKey.includes(normalized) ||
      normalizeText(candidate.place.category).includes(normalized) ||
      normalizeText(candidate.place.title).includes(normalized)
    );
  });
  const locality = metadataString(candidate.metadata, "locality") || metadataString(candidate.metadata, "fullAddress");
  const pieces = [
    matchedInterest ? `matches your ${matchedInterest} interest` : "adds variety from your saved places",
    locality ? `has usable location data around ${locality}` : `has usable location data in ${stroll.city}`,
    candidate.scoreParts.confidence >= 0.7 ? "has stronger saved-place confidence" : null,
  ].filter(Boolean);
  return pieces.join(", ").replace(/^./, (char) => char.toUpperCase()) + ".";
}

export function generateDeterministicStrollPlan(
  stroll: StrollSummary,
  savedPlaces: SavedPlaceForStrollCuration[],
): GeneratedStrollPlan {
  const candidates = buildCandidates(stroll, savedPlaces);
  if (candidates.length < MIN_GENERATED_STOPS) {
    throw new StrollCurationPipelineError(
      "insufficient_eligible_places",
      `At least ${MIN_GENERATED_STOPS} saved places in ${stroll.city} need coordinates before a Stroll can be curated.`,
    );
  }

  const selected = chooseDiverseCandidates(stroll, candidates);
  if (selected.length < MIN_GENERATED_STOPS) {
    throw new StrollCurationPipelineError("insufficient_eligible_places", "Not enough eligible saved places for a Stroll.");
  }
  validateCluster(selected);

  const route = routeCandidates(stroll, selected);
  let totalDistanceMeters = 0;
  let estimatedDurationMinutes = 0;
  const stops: GeneratedStrollStop[] = route.map((candidate, index) => {
    const previous = index === 0 ? null : route[index - 1];
    const distance = previous ? haversineMeters(previous, candidate) : null;
    if (distance != null) totalDistanceMeters += distance;
    const visitDuration = estimatedVisitDuration(candidate);
    const travelDuration = distance == null ? null : routeDurationMinutes(distance);
    estimatedDurationMinutes += visitDuration + (travelDuration ?? 0);
    return {
      placeId: candidate.place.placeId,
      sequence: index + 1,
      reason: reasonForStop(stroll, candidate),
      estimatedVisitDurationMinutes: visitDuration,
      routeDistanceMeters: distance,
      routeDurationMinutes: travelDuration,
    };
  });

  return {
    version: STROLL_CURATION_VERSION,
    stops,
    totalDistanceMeters,
    estimatedDurationMinutes,
  };
}
