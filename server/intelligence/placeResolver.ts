import type { ExtractionResult } from "../extraction/types";
import type { StructuredEntity } from "./types";

export type PlaceResolveResult = {
  placeId: string | null;
  photoUrl: string | null;
  formattedAddress: string | null;
  locality: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  confidence: "high" | "medium" | "low";
  provider: "google_maps" | "none";
};

type CacheEntry = {
  expiresAt: number;
  value: PlaceResolveResult;
};

type RawPlaceCandidate = {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
  types?: string[];
};

export type PlaceResolveContext = {
  locality: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  strength: "strong" | "medium" | "weak";
};

type ResolvedCandidateEvaluation = {
  result: PlaceResolveResult;
  score: number;
  accepted: boolean;
};

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const resolveCache = new Map<string, CacheEntry>();

const CITY_HINTS = [
  { aliases: ["bengaluru", "bangalore"], city: "Bengaluru", state: "Karnataka", country: "India" },
  { aliases: ["new delhi", "delhi"], city: "New Delhi", state: "Delhi", country: "India" },
  { aliases: ["mumbai", "bombay"], city: "Mumbai", state: "Maharashtra", country: "India" },
  { aliases: ["pune"], city: "Pune", state: "Maharashtra", country: "India" },
  { aliases: ["hyderabad"], city: "Hyderabad", state: "Telangana", country: "India" },
  { aliases: ["chennai", "madras"], city: "Chennai", state: "Tamil Nadu", country: "India" },
  { aliases: ["kolkata", "calcutta"], city: "Kolkata", state: "West Bengal", country: "India" },
  { aliases: ["goa"], city: "Panaji", state: "Goa", country: "India" },
];

function getApiKey() {
  return String(
    process.env.GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_PLACES_API_KEY ||
      process.env.VITE_GOOGLE_PLACES_API_KEY ||
      "",
  ).trim();
}

function cacheKeyFor(entity: StructuredEntity, context?: PlaceResolveContext | null) {
  return [
    entity.name || "",
    entity.locality || "",
    entity.city || "",
    entity.state || "",
    entity.country || "",
    context?.locality || "",
    context?.city || "",
    context?.state || "",
    context?.country || "",
  ]
    .join("|")
    .toLowerCase();
}

function nowMs() {
  return Date.now();
}

function readCache(key: string): PlaceResolveResult | null {
  const item = resolveCache.get(key);
  if (!item) return null;
  if (item.expiresAt < nowMs()) {
    resolveCache.delete(key);
    return null;
  }
  return item.value;
}

function writeCache(key: string, value: PlaceResolveResult) {
  const ttl = Number(process.env.PLACE_RESOLUTION_CACHE_TTL_MS || DEFAULT_TTL_MS);
  resolveCache.set(key, { expiresAt: nowMs() + (Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TTL_MS), value });
}

function pickComponent(components: Array<{ long_name?: string; types?: string[] }>, target: string): string | null {
  for (const item of components) {
    if (Array.isArray(item.types) && item.types.includes(target) && item.long_name) {
      return item.long_name;
    }
  }
  return null;
}

function normalizeLooseLabel(input: unknown): string {
  return String(input || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeEntityKeyPart(input: unknown): string {
  return normalizeLooseLabel(input).replace(/[^a-z0-9]+/g, "");
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = String(value || "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function buildLocationSuffix(entity: StructuredEntity, context?: PlaceResolveContext | null): string {
  return uniqueNonEmpty([
    entity.locality,
    entity.city,
    entity.state,
    entity.country,
    context?.locality,
    context?.city,
    context?.state,
    context?.country,
  ]).join(", ");
}

function extractHandleHints(entity: StructuredEntity): string[] {
  const pool = [entity.evidenceText || "", entity.googleMapsQuery || "", entity.name || ""].join(" \n ");
  const matches = Array.from(pool.matchAll(/@([a-z0-9._]+)/gi));
  return uniqueNonEmpty(matches.map((match) => match[1] || null));
}

function buildTextQuery(entity: StructuredEntity): string {
  return [entity.name, entity.locality, entity.city, entity.state, entity.country].filter(Boolean).join(", ");
}

export function buildResolveSearchQueries(entity: StructuredEntity, context?: PlaceResolveContext | null): string[] {
  const locationSuffix = buildLocationSuffix(entity, context);
  const handleHints = extractHandleHints(entity);
  const displayName = String(entity.name || "").trim();
  const queries = uniqueNonEmpty([
    entity.googleMapsQuery,
    buildTextQuery(entity),
    locationSuffix ? `${displayName} ${locationSuffix}` : displayName,
    ...handleHints.flatMap((handle) => [
      locationSuffix ? `@${handle} ${locationSuffix}` : `@${handle}`,
      locationSuffix ? `${handle} ${locationSuffix}` : handle,
      locationSuffix ? `${displayName} ${handle} ${locationSuffix}` : `${displayName} ${handle}`,
    ]),
  ]);
  return queries;
}

async function findPlacesFromText(textQuery: string, apiKey: string): Promise<RawPlaceCandidate[]> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
  url.searchParams.set("input", textQuery);
  url.searchParams.set("inputtype", "textquery");
  url.searchParams.set("fields", "place_id,name,formatted_address,geometry,types");
  url.searchParams.set("key", apiKey);
  const response = await fetch(url.toString());
  if (!response.ok) return [];
  const data = (await response.json()) as any;
  if (data?.status !== "OK" || !Array.isArray(data?.candidates)) return [];
  return data.candidates.slice(0, 5);
}

async function geocodeByPlaceId(placeId: string, apiKey: string) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("key", apiKey);
  const response = await fetch(url.toString());
  if (!response.ok) return null;
  const data = (await response.json()) as any;
  if (data?.status !== "OK" || !Array.isArray(data?.results) || !data.results[0]) return null;
  return data.results[0];
}

async function getPlacePhotoUrlByPlaceId(placeId: string, apiKey: string): Promise<string | null> {
  const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  detailsUrl.searchParams.set("place_id", placeId);
  detailsUrl.searchParams.set("fields", "photo");
  detailsUrl.searchParams.set("key", apiKey);

  const detailsResponse = await fetch(detailsUrl.toString());
  if (!detailsResponse.ok) return null;
  const detailsData = (await detailsResponse.json()) as any;
  const photoRef = detailsData?.result?.photos?.[0]?.photo_reference;
  if (!photoRef || typeof photoRef !== "string") return null;

  const photoUrl = new URL("https://maps.googleapis.com/maps/api/place/photo");
  photoUrl.searchParams.set("maxwidth", "1200");
  photoUrl.searchParams.set("photo_reference", photoRef);
  photoUrl.searchParams.set("key", apiKey);

  const photoResponse = await fetch(photoUrl.toString(), { redirect: "manual" });
  const location = photoResponse.headers.get("location");
  return location || null;
}

function extractResolved(result: any, fallback: RawPlaceCandidate): PlaceResolveResult {
  const geo = result?.geometry?.location || fallback?.geometry?.location || null;
  const components = Array.isArray(result?.address_components) ? result.address_components : [];
  const locality = pickComponent(components, "sublocality_level_1") || pickComponent(components, "locality");
  const city = pickComponent(components, "administrative_area_level_2") || pickComponent(components, "locality");
  const state = pickComponent(components, "administrative_area_level_1");
  const country = pickComponent(components, "country");
  return {
    placeId: fallback?.place_id || result?.place_id || null,
    photoUrl: null,
    formattedAddress: result?.formatted_address || fallback?.formatted_address || null,
    locality,
    city,
    state,
    country,
    lat: typeof geo?.lat === "number" ? geo.lat : null,
    lng: typeof geo?.lng === "number" ? geo.lng : null,
    confidence: fallback?.place_id && geo ? "high" : geo ? "medium" : "low",
    provider: "google_maps",
  };
}

function normalizeContextValue(input: string | null | undefined): string | null {
  const value = normalizeLooseLabel(input);
  return value || null;
}

function matchesContextValue(candidate: string | null | undefined, context: string | null | undefined): boolean {
  const candidateValue = normalizeContextValue(candidate);
  const contextValue = normalizeContextValue(context);
  if (!candidateValue || !contextValue) return false;
  return candidateValue === contextValue;
}

function inferCityHintFromText(text: string): PlaceResolveContext {
  const normalized = normalizeLooseLabel(text);
  if (!normalized) return { locality: null, city: null, state: null, country: null, strength: "weak" };
  for (const hint of CITY_HINTS) {
    if (hint.aliases.some((alias) => normalized.includes(alias))) {
      return {
        locality: null,
        city: hint.city,
        state: hint.state,
        country: hint.country,
        strength: "strong",
      };
    }
  }
  if (/\bindia\b/.test(normalized)) {
    return { locality: null, city: null, state: null, country: "India", strength: "medium" };
  }
  return { locality: null, city: null, state: null, country: null, strength: "weak" };
}

function mergeContexts(primary: PlaceResolveContext, secondary: PlaceResolveContext): PlaceResolveContext {
  const strengthOrder = { weak: 0, medium: 1, strong: 2 } as const;
  const stronger = strengthOrder[primary.strength] >= strengthOrder[secondary.strength] ? primary : secondary;
  const weaker = stronger === primary ? secondary : primary;
  return {
    locality: stronger.locality || weaker.locality || null,
    city: stronger.city || weaker.city || null,
    state: stronger.state || weaker.state || null,
    country: stronger.country || weaker.country || null,
    strength: stronger.strength,
  };
}

export function inferPlaceResolveContext(
  source: ExtractionResult,
  entities: StructuredEntity[],
): PlaceResolveContext {
  const textContext = inferCityHintFromText(
    [
      source.metadata?.title || "",
      source.metadata?.description || "",
      source.combinedTextClean || "",
      source.combinedTextRaw || "",
    ].join("\n"),
  );

  let entityContext: PlaceResolveContext = { locality: null, city: null, state: null, country: null, strength: "weak" };
  for (const entity of entities) {
    const nextContext: PlaceResolveContext = {
      locality: entity.locality,
      city: entity.city,
      state: entity.state,
      country: entity.country,
      strength: entity.city || entity.state || entity.country ? "strong" : "weak",
    };
    entityContext = mergeContexts(entityContext, nextContext);
  }

  return mergeContexts(textContext, entityContext);
}

function isHandleDerivedEntity(entity: StructuredEntity): boolean {
  return extractHandleHints(entity).length > 0;
}

export function evaluateResolvedCandidate(
  entity: StructuredEntity,
  context: PlaceResolveContext,
  candidate: PlaceResolveResult,
): ResolvedCandidateEvaluation {
  let score = 0;
  const strongContext = context.strength === "strong";
  const handleDerived = isHandleDerivedEntity(entity);

  if (matchesContextValue(candidate.country, context.country)) score += 45;
  else if (context.country && candidate.country) score -= strongContext ? 120 : 35;

  if (matchesContextValue(candidate.state, context.state)) score += 20;
  else if (context.state && candidate.state && matchesContextValue(candidate.country, context.country)) score -= strongContext ? 35 : 10;

  if (matchesContextValue(candidate.city, context.city)) score += 35;
  else if (context.city && candidate.city && matchesContextValue(candidate.country, context.country)) score -= strongContext ? 45 : 15;

  if (matchesContextValue(candidate.locality, context.locality)) score += 15;

  if (matchesContextValue(candidate.country, entity.country)) score += 20;
  if (matchesContextValue(candidate.state, entity.state)) score += 10;
  if (matchesContextValue(candidate.city, entity.city)) score += 15;
  if (matchesContextValue(candidate.locality, entity.locality)) score += 10;

  const normalizedName = normalizeEntityKeyPart(entity.name);
  const normalizedAddress = normalizeEntityKeyPart(candidate.formattedAddress || "");
  if (normalizedAddress && context.city && normalizedAddress.includes(normalizeEntityKeyPart(context.city))) score += 10;
  if (normalizedAddress && context.country && normalizedAddress.includes(normalizeEntityKeyPart(context.country))) score += 8;
  if (normalizedName && normalizeEntityKeyPart(candidate.formattedAddress || "").includes(normalizedName)) score += 5;

  let accepted = true;
  if (strongContext && context.country && candidate.country && !matchesContextValue(candidate.country, context.country)) {
    accepted = false;
  }

  if (accepted && handleDerived && strongContext && context.city) {
    const localish = matchesContextValue(candidate.city, context.city) || matchesContextValue(candidate.locality, context.locality) || matchesContextValue(candidate.state, context.state);
    if (!localish && !matchesContextValue(candidate.country, context.country)) {
      accepted = false;
    }
  }

  if (accepted && strongContext && score < 20) {
    accepted = false;
  }

  return { result: candidate, score, accepted };
}

export function mergeResolutionIntoContext(context: PlaceResolveContext, result: PlaceResolveResult): PlaceResolveContext {
  if (result.confidence === "low") return context;
  return mergeContexts(context, {
    locality: result.locality,
    city: result.city,
    state: result.state,
    country: result.country,
    strength: result.city || result.state || result.country ? "strong" : "weak",
  });
}

function buildMissResult(provider: "google_maps" | "none"): PlaceResolveResult {
  return {
    placeId: null,
    photoUrl: null,
    formattedAddress: null,
    locality: null,
    city: null,
    state: null,
    country: null,
    lat: null,
    lng: null,
    confidence: "low",
    provider,
  };
}

export async function resolveEntityLocality(
  entity: StructuredEntity,
  context?: PlaceResolveContext | null,
): Promise<PlaceResolveResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return buildMissResult("none");
  }

  const key = cacheKeyFor(entity, context);
  const cached = readCache(key);
  if (cached) return cached;

  const queries = buildResolveSearchQueries(entity, context);
  let best: ResolvedCandidateEvaluation | null = null;

  for (const query of queries) {
    const candidates = await findPlacesFromText(query, apiKey);
    for (const candidate of candidates) {
      if (!candidate?.place_id) continue;
      const geocoded = await geocodeByPlaceId(String(candidate.place_id), apiKey);
      const resolved = extractResolved(geocoded, candidate);
      const evaluation = evaluateResolvedCandidate(entity, context || { locality: null, city: null, state: null, country: null, strength: "weak" }, resolved);
      if (!best || evaluation.score > best.score) {
        best = evaluation;
      }
    }
  }

  if (!best || !best.accepted) {
    const miss = buildMissResult("google_maps");
    writeCache(key, miss);
    return miss;
  }

  const out = { ...best.result };
  out.photoUrl = out.placeId ? await getPlacePhotoUrlByPlaceId(String(out.placeId), apiKey) : null;
  out.confidence = best.score >= 70 ? "high" : best.score >= 40 ? "medium" : "low";
  if (context) {
    const mergedContext = mergeResolutionIntoContext(context, out);
    if (mergedContext.strength === "strong" && out.confidence === "low" && isHandleDerivedEntity(entity)) {
      const miss = buildMissResult("google_maps");
      writeCache(key, miss);
      return miss;
    }
  }
  writeCache(key, out);
  return out;
}
