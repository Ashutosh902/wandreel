import type { SavedPlaceRecord } from "./savedPlaces";
import { filterPlacesByResolvedCity, resolveLocationContext } from "./locationContext";

export const FOOD_TRAIL_READY_THRESHOLD = 3;
export const WEEKEND_PLAN_READY_THRESHOLD = 3;

export type HeroCardEligibilityCard = {
  type: "city_category_insight";
  cardKey?: string;
  readyStrollId?: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaAction: string;
  heroState?: "suggestion" | "ready_stroll";
  priorityScore?: number;
  reasonCodes?: string[];
  metadata: Record<string, unknown>;
  alternatives?: HeroCardEligibilityCard[];
};

function getPlaceKey(place: SavedPlaceRecord): string {
  return String(place.placeId || place.id || "").trim();
}

function resolveFoodTrailCityLabel(
  card: HeroCardEligibilityCard,
  currentLocationLabel: string,
  places: SavedPlaceRecord[],
): string | null {
  return resolveLocationContext(
    currentLocationLabel,
    places,
    typeof card.metadata?.targetCity === "string" ? card.metadata.targetCity.trim() : "",
  ).cityName;
}

function getMatchingCityTastePlaces(
  places: SavedPlaceRecord[],
  card: HeroCardEligibilityCard,
  currentLocationLabel: string,
): SavedPlaceRecord[] {
  return filterPlacesByResolvedCity(
    places.filter((place) => place.category === "Taste"),
    currentLocationLabel,
    typeof card.metadata?.targetCity === "string" ? card.metadata.targetCity.trim() : "",
  ).places;
}

function buildMatchingPlaceIds(places: SavedPlaceRecord[]): string[] {
  return places.map((place) => getPlaceKey(place)).filter(Boolean);
}

export function applyFoodTrailHeroEligibility(
  card: HeroCardEligibilityCard,
  places: SavedPlaceRecord[],
  currentLocationLabel: string,
): HeroCardEligibilityCard | null {
  if (card.heroState === "ready_stroll" || (typeof card.readyStrollId === "string" && card.readyStrollId.trim())) {
    return card;
  }
  if (card.ctaAction !== "build_food_trail") return card;

  const cityTastePlaces = getMatchingCityTastePlaces(places, card, currentLocationLabel);
  const cityLabel = resolveFoodTrailCityLabel(card, currentLocationLabel, places);
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
      title: "Food trail taking shape",
      subtitle: `Save ${remaining} more food places in ${cityLabel}.`,
      ctaLabel: "Add places",
      ctaAction: "grow_saved_places",
      heroState: "suggestion",
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

function isWeekendPlanCard(card: HeroCardEligibilityCard): boolean {
  const targetCategory = typeof card.metadata?.targetCategory === "string" ? card.metadata.targetCategory : "";
  return (
    card.ctaAction === "view_city_plan" ||
    card.ctaAction === "plan_weekend_explore" ||
    card.ctaAction === "create_itinerary" ||
    (card.ctaAction === "view_dominant_category" && targetCategory === "Explore")
  );
}

export function applyWeekendPlanHeroEligibility(
  card: HeroCardEligibilityCard,
  places: SavedPlaceRecord[],
  currentLocationLabel: string,
): HeroCardEligibilityCard | null {
  if (card.heroState === "ready_stroll" || (typeof card.readyStrollId === "string" && card.readyStrollId.trim())) {
    return card;
  }
  if (!isWeekendPlanCard(card)) return card;

  const { cityName, places: cityPlaces } = filterPlacesByResolvedCity(
    places,
    currentLocationLabel,
    typeof card.metadata?.targetCity === "string" ? card.metadata.targetCity.trim() : "",
  );
  const relevantCityPlaces = cityPlaces.filter((place) => (
    place.category === "Taste" || place.category === "Explore" || place.category === "Activity" || place.category === "Stay"
  ));
  const representedCategories = new Set(relevantCityPlaces.map((place) => place.category));
  const matchingPlaceIds = buildMatchingPlaceIds(relevantCityPlaces);

  if (relevantCityPlaces.length >= WEEKEND_PLAN_READY_THRESHOLD && representedCategories.size >= 2 && cityName) {
    return {
      ...card,
      metadata: {
        ...card.metadata,
        targetCity: cityName,
        matchingPlaceIds,
      },
    };
  }

  if (relevantCityPlaces.length >= 1 && cityName) {
    return {
      ...card,
      title: `${cityName} plan taking shape`,
      subtitle: "Save a few more food, explore, or activity spots.",
      ctaLabel: "Add places",
      ctaAction: "grow_saved_places",
      heroState: "suggestion",
      metadata: {
        ...card.metadata,
        targetCity: cityName,
        matchingPlaceIds,
        weekendPlanReady: false,
      },
    };
  }

  return null;
}
