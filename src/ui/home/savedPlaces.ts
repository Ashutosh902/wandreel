import type { CategoryLabel } from "./home.data";
import { CATEGORY_FEED_CACHE_KEY } from "./addFlowState";

export type SavedPlaceRecord = {
  id: string;
  placeId?: string | null;
  title: string;
  category: CategoryLabel;
  distanceKm: number;
  metaPrimary: string;
  metaSecondary: string;
  locality: string;
  fullAddress: string;
  videoUrl: string;
  imageUrl: string;
  tags: string[];
  lat?: number | null;
  lng?: number | null;
  isGlobal?: boolean;
  sharedVisibility?: "private" | "global";
  sharedAt?: number;
  createdAtMs: number;
};

export type SavedPlaceApiItem = {
  placeId?: string;
  title?: string;
  category?: string | null;
  metadata?: {
    locality?: string | null;
    fullAddress?: string | null;
    videoUrl?: string | null;
    imageUrl?: string | null;
    lat?: number | null;
    lng?: number | null;
    isGlobal?: boolean | null;
    sharedVisibility?: "private" | "global" | null;
    sharedAt?: number | null;
  } | null;
};

export const SAVED_PLACES_UPDATED_EVENT = "wr:category-saved-updated";
const categoryOrder: CategoryLabel[] = ["Taste", "Activity", "Stay", "Explore"];

export function createEmptySavedPlacesByCategory(): Record<CategoryLabel, SavedPlaceRecord[]> {
  return {
    Taste: [],
    Activity: [],
    Stay: [],
    Explore: [],
  };
}

export function readSavedPlacesByCategory(): Record<CategoryLabel, SavedPlaceRecord[]> {
  try {
    const raw = window.localStorage.getItem(CATEGORY_FEED_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const next = createEmptySavedPlacesByCategory();
    for (const category of categoryOrder) {
      const items = Array.isArray(parsed?.[category]) ? parsed[category] : [];
      next[category] = items
        .map((item: Partial<SavedPlaceRecord>) => normalizeSavedPlace(item, category))
        .filter((item): item is SavedPlaceRecord => item !== null);
    }
    return next;
  } catch {
    return createEmptySavedPlacesByCategory();
  }
}

export function writeSavedPlacesByCategory(value: Record<CategoryLabel, SavedPlaceRecord[]>) {
  window.localStorage.setItem(CATEGORY_FEED_CACHE_KEY, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(SAVED_PLACES_UPDATED_EVENT));
}

export function clearSavedPlacesByCategory() {
  writeSavedPlacesByCategory(createEmptySavedPlacesByCategory());
}

export function flattenSavedPlaces(byCategory: Record<CategoryLabel, SavedPlaceRecord[]>) {
  return categoryOrder.flatMap((category) => byCategory[category] || []);
}

export function getSavedPlaceCounts(byCategory: Record<CategoryLabel, SavedPlaceRecord[]>) {
  return {
    Taste: byCategory.Taste.length,
    Activity: byCategory.Activity.length,
    Stay: byCategory.Stay.length,
    Explore: byCategory.Explore.length,
    total: flattenSavedPlaces(byCategory).length,
  };
}

export function isPlaceGlobal(
  place: Pick<SavedPlaceRecord, "isGlobal" | "sharedVisibility">,
) {
  return place.sharedVisibility === "global" || place.isGlobal === true;
}

export function getGlobalSavedPlaces(byCategory: Record<CategoryLabel, SavedPlaceRecord[]>) {
  return flattenSavedPlaces(byCategory)
    .filter((place) => isPlaceGlobal(place))
    .sort((a, b) => (b.sharedAt || b.createdAtMs) - (a.sharedAt || a.createdAtMs));
}

export function upsertSavedPlace(place: SavedPlaceRecord) {
  const current = readSavedPlacesByCategory();
  const next = createEmptySavedPlacesByCategory();
  const normalizedPlace = normalizeSavedPlace(place, place.category);
  if (!normalizedPlace) return;
  const placeKey = getSavedPlaceKey(normalizedPlace);

  for (const category of categoryOrder) {
    next[category] = current[category].filter((item) => getSavedPlaceKey(item) !== placeKey);
  }

  next[normalizedPlace.category] = [normalizedPlace, ...next[normalizedPlace.category]].slice(0, 100);
  writeSavedPlacesByCategory(next);
}

export function removeSavedPlace(place: SavedPlaceRecord) {
  const current = readSavedPlacesByCategory();
  const next = createEmptySavedPlacesByCategory();
  const placeKey = getSavedPlaceKey(place);

  for (const category of categoryOrder) {
    next[category] = current[category].filter((item) => getSavedPlaceKey(item) !== placeKey);
  }

  writeSavedPlacesByCategory(next);
}

export function mergeSavedPlacesFromApi(items: SavedPlaceApiItem[]) {
  const current = readSavedPlacesByCategory();
  const next = createEmptySavedPlacesByCategory();
  const currentFlatPlaces = flattenSavedPlaces(current);

  for (const category of categoryOrder) {
    next[category] = [...current[category]];
  }

  for (const item of items) {
    const mapped = mapSavedPlaceApiItem(item);
    if (!mapped) continue;
    const placeKey = getSavedPlaceKey(mapped);
    const existingLocal = currentFlatPlaces.find((entry) => getSavedPlaceKey(entry) === placeKey);
    const merged = mergeSavedPlaceWithLocalIntent(mapped, existingLocal, item);
    for (const category of categoryOrder) {
      next[category] = next[category].filter((entry) => getSavedPlaceKey(entry) !== placeKey);
    }
    next[merged.category] = [merged, ...next[merged.category]].slice(0, 100);
  }

  writeSavedPlacesByCategory(next);
}

export function togglePlaceGlobal(place: SavedPlaceRecord, nextGlobal = !isPlaceGlobal(place)) {
  const nextPlace = normalizeSavedPlace(
    {
      ...place,
      isGlobal: nextGlobal,
      sharedVisibility: nextGlobal ? "global" : "private",
      sharedAt: nextGlobal ? place.sharedAt ?? Date.now() : undefined,
    },
    place.category,
  );
  if (!nextPlace) {
    throw new Error("Unable to toggle global visibility for saved place.");
  }
  upsertSavedPlace(nextPlace);
  return nextPlace;
}

export function mapSavedPlaceApiItem(item: SavedPlaceApiItem): SavedPlaceRecord | null {
  const category = normalizeCategory(item.category);
  if (!category) return null;

  const title = String(item.title || "Saved place").trim() || "Saved place";
  const locality = String(item.metadata?.locality || "Unknown locality").trim() || "Unknown locality";
  const fullAddress = String(item.metadata?.fullAddress || locality).trim() || locality;
  const imageUrl = String(item.metadata?.imageUrl || "").trim();
  const videoUrl = String(item.metadata?.videoUrl || "").trim();

  return {
    id: String(item.placeId || `${category}-${title}-${locality}`).toLowerCase().replace(/\s+/g, "-"),
    placeId: item.placeId || null,
    title,
    category,
    distanceKm: 0.1,
    metaPrimary: category,
    metaSecondary: "Saved",
    locality,
    fullAddress,
    videoUrl,
    imageUrl,
    tags: ["Saved", "Visited"],
    lat: typeof item.metadata?.lat === "number" ? item.metadata.lat : null,
    lng: typeof item.metadata?.lng === "number" ? item.metadata.lng : null,
    isGlobal: item.metadata?.sharedVisibility === "global" || item.metadata?.isGlobal === true,
    sharedVisibility:
      item.metadata?.sharedVisibility === "global" || item.metadata?.isGlobal === true ? "global" : "private",
    sharedAt: typeof item.metadata?.sharedAt === "number" ? item.metadata.sharedAt : undefined,
    createdAtMs: Date.now(),
  };
}

export function getSavedPlaceKey(place: Pick<SavedPlaceRecord, "id" | "placeId" | "title" | "locality">) {
  return String(place.placeId || place.id || `${place.title}::${place.locality}`).toLowerCase();
}

function normalizeCategory(value?: string | null): CategoryLabel | null {
  if (value === "Taste" || value === "Activity" || value === "Stay" || value === "Explore") return value;
  return null;
}

function hasExplicitSharedState(metadata?: SavedPlaceApiItem["metadata"]) {
  if (!metadata) return false;
  return (
    typeof metadata.isGlobal === "boolean" ||
    metadata.sharedVisibility === "global" ||
    metadata.sharedVisibility === "private" ||
    typeof metadata.sharedAt === "number" ||
    metadata.sharedAt === null
  );
}

function mergeSavedPlaceWithLocalIntent(
  mapped: SavedPlaceRecord,
  localExisting: SavedPlaceRecord | undefined,
  apiItem: SavedPlaceApiItem,
): SavedPlaceRecord {
  if (!localExisting) return mapped;

  const keepLocalSharedIntent = !hasExplicitSharedState(apiItem.metadata);

  return {
    ...mapped,
    createdAtMs: localExisting.createdAtMs || mapped.createdAtMs,
    isGlobal: keepLocalSharedIntent ? localExisting.isGlobal : mapped.isGlobal,
    sharedVisibility: keepLocalSharedIntent ? localExisting.sharedVisibility : mapped.sharedVisibility,
    sharedAt: keepLocalSharedIntent ? localExisting.sharedAt : mapped.sharedAt,
  };
}

function normalizeSavedPlace(
  item: Partial<SavedPlaceRecord>,
  fallbackCategory: CategoryLabel,
): SavedPlaceRecord | null {
  const category = normalizeCategory(item.category) || fallbackCategory;
  const title = String(item.title || "").trim();
  const locality = String(item.locality || "").trim();
  if (!title || !locality) return null;

  return {
    id: String(item.id || item.placeId || `${category}-${title}-${locality}`).toLowerCase().replace(/\s+/g, "-"),
    placeId: item.placeId || null,
    title,
    category,
    distanceKm: typeof item.distanceKm === "number" ? item.distanceKm : 0.1,
    metaPrimary: String(item.metaPrimary || category),
    metaSecondary: String(item.metaSecondary || "Saved"),
    locality,
    fullAddress: String(item.fullAddress || locality),
    videoUrl: String(item.videoUrl || ""),
    imageUrl: String(item.imageUrl || ""),
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : ["Saved"],
    lat: typeof item.lat === "number" ? item.lat : null,
    lng: typeof item.lng === "number" ? item.lng : null,
    isGlobal: item.sharedVisibility === "global" || item.isGlobal === true,
    sharedVisibility:
      item.sharedVisibility === "global" || item.isGlobal === true ? "global" : "private",
    sharedAt: typeof item.sharedAt === "number" ? item.sharedAt : undefined,
    createdAtMs: typeof item.createdAtMs === "number" ? item.createdAtMs : Date.now(),
  };
}
