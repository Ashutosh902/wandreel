import type { SavedPlaceRecord } from "./savedPlaces";

export const FOOD_TRAIL_READY_THRESHOLD = 3;

export type HeroCardEligibilityCard = {
  type: "city_category_insight";
  cardKey?: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaAction: string;
  priorityScore?: number;
  reasonCodes?: string[];
  metadata: Record<string, unknown>;
  alternatives?: HeroCardEligibilityCard[];
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function getPlaceKey(place: SavedPlaceRecord): string {
  return String(place.placeId || place.id || "").trim();
}

function getLocationSegments(locationLabel: string): string[] {
  return locationLabel
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function resolveFoodTrailCityLabel(card: HeroCardEligibilityCard, currentLocationLabel: string): string | null {
  const explicitTargetCity = typeof card.metadata?.targetCity === "string" ? card.metadata.targetCity.trim() : "";
  if (explicitTargetCity) return explicitTargetCity;

  const segments = getLocationSegments(currentLocationLabel);
  if (!segments.length) return null;
  return segments[0] || null;
}

function getMatchingCityTastePlaces(
  places: SavedPlaceRecord[],
  card: HeroCardEligibilityCard,
  currentLocationLabel: string,
): SavedPlaceRecord[] {
  const explicitTargetCity = typeof card.metadata?.targetCity === "string" ? card.metadata.targetCity.trim() : "";
  const candidateSegments = explicitTargetCity ? [explicitTargetCity] : getLocationSegments(currentLocationLabel);
  const normalizedSegments = new Set(candidateSegments.map((segment) => normalizeText(segment)).filter(Boolean));

  if (!normalizedSegments.size) return [];

  return places.filter((place) => (
    place.category === "Taste" &&
    normalizedSegments.has(normalizeText(place.city))
  ));
}

function buildMatchingPlaceIds(places: SavedPlaceRecord[]): string[] {
  return places.map((place) => getPlaceKey(place)).filter(Boolean);
}

export function applyFoodTrailHeroEligibility(
  card: HeroCardEligibilityCard,
  places: SavedPlaceRecord[],
  currentLocationLabel: string,
): HeroCardEligibilityCard | null {
  if (card.ctaAction !== "build_food_trail") return card;

  const cityTastePlaces = getMatchingCityTastePlaces(places, card, currentLocationLabel);
  const cityLabel = resolveFoodTrailCityLabel(card, currentLocationLabel);
  const matchingPlaceIds = buildMatchingPlaceIds(cityTastePlaces);

  if (cityTastePlaces.length >= FOOD_TRAIL_READY_THRESHOLD) {
    return {
      ...card,
      metadata: {
        ...card.metadata,
        targetCategory: "Taste",
        targetCity: cityLabel,
        matchingPlaceIds,
      },
    };
  }

  if (cityTastePlaces.length >= 1 && cityTastePlaces.length < FOOD_TRAIL_READY_THRESHOLD && cityLabel) {
    const remaining = FOOD_TRAIL_READY_THRESHOLD - cityTastePlaces.length;
    return {
      ...card,
      title: "Food trail almost ready",
      subtitle: `Save ${remaining} more food places in ${cityLabel}.`,
      ctaLabel: "Add places",
      ctaAction: "grow_saved_places",
      metadata: {
        ...card.metadata,
        targetCategory: "Taste",
        targetCity: cityLabel,
        matchingPlaceIds,
        remainingTastePlaces: remaining,
        foodTrailReady: false,
      },
    };
  }

  return null;
}
