import type { SavedPlaceRecord } from "./savedPlaces";

export type ResolvedLocationContext = {
  localityName: string | null;
  cityName: string | null;
  regionName: string | null;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function toDisplayText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getMostCommonCity(places: SavedPlaceRecord[]): string | null {
  const counts = new Map<string, { label: string; count: number }>();
  for (const place of places) {
    const city = toDisplayText(place.city);
    if (!city) continue;
    const key = normalizeText(city);
    const current = counts.get(key);
    counts.set(key, { label: city, count: (current?.count || 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.label || null;
}

export function parseLocationLabel(label: string): ResolvedLocationContext {
  const segments = label
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  return {
    localityName: segments[0] || null,
    cityName: null,
    regionName: segments[1] || null,
  };
}

export function resolveLocationContext(
  label: string,
  places: SavedPlaceRecord[] = [],
  explicitCity?: string | null,
): ResolvedLocationContext {
  const parsed = parseLocationLabel(label);
  const explicitCityName = toDisplayText(explicitCity);
  if (explicitCityName) {
    return {
      localityName:
        parsed.localityName && normalizeText(parsed.localityName) !== normalizeText(explicitCityName)
          ? parsed.localityName
          : null,
      cityName: explicitCityName,
      regionName: parsed.regionName,
    };
  }

  const localityKey = normalizeText(parsed.localityName);
  const regionKey = normalizeText(parsed.regionName);

  const directCityMatch = places.find((place) => normalizeText(place.city) === localityKey);
  if (directCityMatch?.city) {
    return {
      localityName: null,
      cityName: directCityMatch.city,
      regionName: parsed.regionName,
    };
  }

  const localityMatches = places.filter((place) => normalizeText(place.locality) === localityKey);
  const localityCity = getMostCommonCity(localityMatches);
  if (localityCity) {
    return {
      localityName: parsed.localityName,
      cityName: localityCity,
      regionName: parsed.regionName,
    };
  }

  const regionMatches = places.filter((place) => normalizeText(place.state) === regionKey);
  const regionCity = getMostCommonCity(regionMatches);
  if (regionCity) {
    return {
      localityName: parsed.localityName,
      cityName: regionCity,
      regionName: parsed.regionName,
    };
  }

  const fallbackCity = getMostCommonCity(places);
  if (fallbackCity) {
    return {
      localityName: parsed.localityName,
      cityName: fallbackCity,
      regionName: parsed.regionName,
    };
  }

  return parsed;
}

export function filterPlacesByResolvedCity(
  places: SavedPlaceRecord[],
  locationLabel: string,
  explicitCity?: string | null,
): { cityName: string | null; places: SavedPlaceRecord[] } {
  const context = resolveLocationContext(locationLabel, places, explicitCity);
  const cityKey = normalizeText(context.cityName);
  if (!cityKey) return { cityName: context.cityName, places: [] };
  return {
    cityName: context.cityName,
    places: places.filter((place) => normalizeText(place.city) === cityKey),
  };
}
