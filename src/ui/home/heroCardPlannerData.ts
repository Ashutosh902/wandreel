import type { CategoryLabel } from "./home.data";
import type { SavedPlaceRecord } from "./savedPlaces";

type HeroCardQueryParams = {
  category?: unknown;
  city?: unknown;
  placeIds?: unknown;
};

export type HeroCardPlannerCard = {
  ctaAction: string;
  metadata?: Record<string, unknown>;
};

export type HeroCardPlannerDataSource = {
  listSavedPlaces: () => SavedPlaceRecord[];
};

export type HeroCardPlannerSelection = {
  targetCategory: CategoryLabel | null;
  targetCity: string | null;
  matchingPlaceIds: string[];
  matchingPlaces: SavedPlaceRecord[];
  getCategoryPlaces: (category: CategoryLabel) => SavedPlaceRecord[];
  getCityPlaces: () => SavedPlaceRecord[];
};

export function createLocalSavedPlacesPlannerDataSource(
  savedPlaces: SavedPlaceRecord[],
): HeroCardPlannerDataSource {
  return {
    listSavedPlaces: () => savedPlaces,
  };
}

function normalizeCategory(value: unknown): CategoryLabel | null {
  return value === "Taste" || value === "Activity" || value === "Stay" || value === "Explore" ? value : null;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePlaceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function getPlaceKey(place: SavedPlaceRecord): string {
  return String(place.placeId || place.id || "").trim();
}

export function resolveHeroCardPlannerSelection(
  card: HeroCardPlannerCard,
  dataSource: HeroCardPlannerDataSource,
): HeroCardPlannerSelection {
  const queryParams = (card.metadata?.queryParams || {}) as HeroCardQueryParams;
  const targetCategory = normalizeCategory(card.metadata?.targetCategory ?? queryParams.category);
  const targetCity = normalizeString(card.metadata?.targetCity ?? queryParams.city) || null;
  const matchingPlaceIds = normalizePlaceIds(card.metadata?.matchingPlaceIds ?? queryParams.placeIds);
  const allSavedPlaces = dataSource.listSavedPlaces();

  // Saved hero-card ideas are prompts only. Planner actions must resolve from real saved places.
  const matchingPlaces = matchingPlaceIds.length
    ? allSavedPlaces.filter((place) => matchingPlaceIds.includes(getPlaceKey(place)))
    : [];

  return {
    targetCategory,
    targetCity,
    matchingPlaceIds,
    matchingPlaces,
    getCategoryPlaces(category) {
      const preferredSource = matchingPlaces.length ? matchingPlaces : allSavedPlaces;
      return preferredSource.filter((place) => place.category === category);
    },
    getCityPlaces() {
      if (matchingPlaces.length) return matchingPlaces;
      if (!targetCity) return [];
      return allSavedPlaces.filter((place) => normalizeString(place.city).toLowerCase() === targetCity.toLowerCase());
    },
  };
}
