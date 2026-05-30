import type { StructuredEntity } from "./types";

type PlaceResolveResult = {
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

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const resolveCache = new Map<string, CacheEntry>();

function getApiKey() {
  return String(
    process.env.GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_PLACES_API_KEY ||
      process.env.VITE_GOOGLE_PLACES_API_KEY ||
      "",
  ).trim();
}

function cacheKeyFor(entity: StructuredEntity) {
  return [
    entity.name || "",
    entity.locality || "",
    entity.city || "",
    entity.state || "",
    entity.country || "",
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

function buildTextQuery(entity: StructuredEntity): string {
  return [entity.name, entity.locality, entity.city, entity.state, entity.country].filter(Boolean).join(", ");
}

async function findPlaceFromText(textQuery: string, apiKey: string) {
  const url = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
  url.searchParams.set("input", textQuery);
  url.searchParams.set("inputtype", "textquery");
  url.searchParams.set("fields", "place_id,name,formatted_address,geometry,types");
  url.searchParams.set("key", apiKey);
  const response = await fetch(url.toString());
  if (!response.ok) return null;
  const data = (await response.json()) as any;
  if (data?.status !== "OK" || !Array.isArray(data?.candidates) || !data.candidates[0]) return null;
  return data.candidates[0];
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

function extractResolved(result: any, fallback: any): PlaceResolveResult {
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

export async function resolveEntityLocality(entity: StructuredEntity): Promise<PlaceResolveResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
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
      provider: "none",
    };
  }

  const key = cacheKeyFor(entity);
  const cached = readCache(key);
  if (cached) return cached;

  const place = await findPlaceFromText(buildTextQuery(entity), apiKey);
  if (!place?.place_id) {
    const miss: PlaceResolveResult = {
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
      provider: "google_maps",
    };
    writeCache(key, miss);
    return miss;
  }

  const geocoded = await geocodeByPlaceId(String(place.place_id), apiKey);
  const out = extractResolved(geocoded, place);
  out.photoUrl = await getPlacePhotoUrlByPlaceId(String(place.place_id), apiKey);
  writeCache(key, out);
  return out;
}
