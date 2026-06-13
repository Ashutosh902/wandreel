import type { CategoryLabel } from "./home.data";
import { CATEGORY_FEED_CACHE_KEY } from "./addFlowState";
import type { EntityIntent } from "./intent";
import { resolveEntityIntent } from "./intent";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";

export type SavedPlaceRecord = {
  id: string;
  placeId?: string | null;
  title: string;
  category: CategoryLabel;
  distanceKm: number;
  metaPrimary: string;
  metaSecondary: string;
  locality: string;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  fullAddress: string;
  videoUrl: string;
  imageUrl: string;
  tags: string[];
  intent?: EntityIntent | null;
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
  metaPrimary?: string | null;
  metaSecondary?: string | null;
  metadata?: {
    metaPrimary?: string | null;
    metaSecondary?: string | null;
    locality?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    fullAddress?: string | null;
    videoUrl?: string | null;
    imageUrl?: string | null;
    intent?: EntityIntent | null;
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

  for (const category of categoryOrder) {
    next[category] = [...current[category]];
  }

  for (const item of items) {
    const mapped = mapSavedPlaceApiItem(item);
    if (!mapped) continue;
    const placeKey = getSavedPlaceKey(mapped);
    for (const category of categoryOrder) {
      next[category] = next[category].filter((entry) => getSavedPlaceKey(entry) !== placeKey);
    }
    next[mapped.category] = [mapped, ...next[mapped.category]].slice(0, 100);
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

export async function persistSavedPlace(place: SavedPlaceRecord) {
  const response = await fetch(`${API_BASE_URL}/api/saved-places`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      placeId: place.placeId || place.id,
      title: place.title,
      category: place.category,
      metadata: {
        metaPrimary: place.metaPrimary,
        metaSecondary: place.metaSecondary,
        locality: place.locality,
        city: place.city ?? null,
        state: place.state ?? null,
        country: place.country ?? null,
        fullAddress: place.fullAddress,
        videoUrl: place.videoUrl,
        imageUrl: place.imageUrl,
        intent: place.intent ?? null,
        lat: place.lat ?? null,
        lng: place.lng ?? null,
        isGlobal: place.isGlobal === true,
        sharedVisibility: place.sharedVisibility || "private",
        sharedAt: place.sharedAt ?? null,
      },
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Please log in to save places.");
    }
    throw new Error("Could not save place.");
  }

  const payload = (await response.json().catch(() => null)) as { ok?: boolean; item?: SavedPlaceApiItem } | null;
  if (payload?.ok && payload.item) {
    mergeSavedPlacesFromApi([payload.item]);
  }
}

export async function togglePlaceGlobalPersisted(
  place: SavedPlaceRecord,
  nextGlobal = !isPlaceGlobal(place),
) {
  const previousPlace = normalizeSavedPlace(place, place.category);
  if (!previousPlace) {
    throw new Error("Unable to toggle global visibility for saved place.");
  }

  const nextPlace = togglePlaceGlobal(previousPlace, nextGlobal);

  try {
    await persistSavedPlace(nextPlace);
    return nextPlace;
  } catch (error) {
    upsertSavedPlace(previousPlace);
    throw error;
  }
}

export function mapSavedPlaceApiItem(item: SavedPlaceApiItem): SavedPlaceRecord | null {
  const category = normalizeCategory(item.category);
  if (!category) return null;

  const title = String(item.title || "Saved place").trim() || "Saved place";
  const locality = String(item.metadata?.locality || "Unknown locality").trim() || "Unknown locality";
  const fullAddress = String(item.metadata?.fullAddress || locality).trim() || locality;
  const imageUrl = String(item.metadata?.imageUrl || "").trim();
  const videoUrl = String(item.metadata?.videoUrl || "").trim();
  const intent = resolveEntityIntent({
    category,
    intent: item.metadata?.intent ?? null,
    title,
    metaSecondary: String(item.metadata?.metaSecondary || item.metaSecondary || "").trim(),
  });

  return {
    id: String(item.placeId || `${category}-${title}-${locality}`).toLowerCase().replace(/\s+/g, "-"),
    placeId: item.placeId || null,
    title,
    category,
    distanceKm: 0.1,
    metaPrimary: String(item.metadata?.metaPrimary || item.metaPrimary || intent.l2).trim() || intent.l2,
    metaSecondary: String(item.metadata?.metaSecondary || item.metaSecondary || intent.l3[0] || "").trim(),
    locality,
    city: typeof item.metadata?.city === "string" ? item.metadata.city : null,
    state: typeof item.metadata?.state === "string" ? item.metadata.state : null,
    country: typeof item.metadata?.country === "string" ? item.metadata.country : null,
    fullAddress,
    videoUrl,
    imageUrl,
    tags: ["Saved", "Visited"],
    intent,
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
    metaPrimary: String(item.metaPrimary || item.intent?.l2 || category),
    metaSecondary: String(item.metaSecondary || item.intent?.l3?.[0] || ""),
    locality,
    city: typeof item.city === "string" ? item.city : null,
    state: typeof item.state === "string" ? item.state : null,
    country: typeof item.country === "string" ? item.country : null,
    fullAddress: String(item.fullAddress || locality),
    videoUrl: String(item.videoUrl || ""),
    imageUrl: String(item.imageUrl || ""),
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : ["Saved"],
    intent: resolveEntityIntent({
      category,
      intent: item.intent ?? null,
      title,
      metaSecondary: String(item.metaSecondary || ""),
    }),
    lat: typeof item.lat === "number" ? item.lat : null,
    lng: typeof item.lng === "number" ? item.lng : null,
    isGlobal: item.sharedVisibility === "global" || item.isGlobal === true,
    sharedVisibility:
      item.sharedVisibility === "global" || item.isGlobal === true ? "global" : "private",
    sharedAt: typeof item.sharedAt === "number" ? item.sharedAt : undefined,
    createdAtMs: typeof item.createdAtMs === "number" ? item.createdAtMs : Date.now(),
  };
}
