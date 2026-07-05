import type { SavedPlaceRecord } from "./savedPlaces";
import { resolveLocationContext } from "./locationContext";

type HeroCardContent = {
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaAction: string;
  metadata?: Record<string, unknown>;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getHeroCity(card: HeroCardContent, currentLocationLabel: string, visibleSavedPlaces: SavedPlaceRecord[]): string {
  const context = resolveLocationContext(
    currentLocationLabel,
    visibleSavedPlaces,
    normalizeText(card.metadata?.targetCity) || null,
  );
  return context.cityName || context.localityName || "";
}

function getMatchingCount(card: HeroCardContent): number {
  const ids = Array.isArray(card.metadata?.matchingPlaceIds) ? card.metadata?.matchingPlaceIds : [];
  return ids.map((item) => String(item || "").trim()).filter(Boolean).length;
}

function getRemainingCount(card: HeroCardContent): number {
  const remaining = Number(card.metadata?.remainingTastePlaces);
  return Number.isFinite(remaining) && remaining > 0 ? remaining : 0;
}

function formatCityPrefix(city: string, suffix: string): string {
  return city ? `${city} ${suffix}` : suffix.charAt(0).toUpperCase() + suffix.slice(1);
}

function buildFoodTrailReadyCopy(
  card: HeroCardContent,
  currentLocationLabel: string,
  visibleSavedPlaces: SavedPlaceRecord[],
): HeroCardContent {
  const city = getHeroCity(card, currentLocationLabel, visibleSavedPlaces);
  const count = getMatchingCount(card);
  return {
    ...card,
    title: formatCityPrefix(city, "food trail is ready"),
    subtitle: count > 0
      ? `${count} Taste saves can become a route for today.`
      : "Taste saves can become a route for today.",
    ctaLabel: "Build trail",
  };
}

function buildCityPlanCopy(
  card: HeroCardContent,
  currentLocationLabel: string,
  visibleSavedPlaces: SavedPlaceRecord[],
): HeroCardContent {
  const city = getHeroCity(card, currentLocationLabel, visibleSavedPlaces);
  return {
    ...card,
    title: formatCityPrefix(city, "plan is ready"),
    subtitle: "Your saved places can shape a weekend route.",
    ctaLabel: "Plan weekend",
  };
}

function buildAlmostReadyFoodCopy(
  card: HeroCardContent,
  currentLocationLabel: string,
  visibleSavedPlaces: SavedPlaceRecord[],
): HeroCardContent {
  const city = getHeroCity(card, currentLocationLabel, visibleSavedPlaces);
  const remaining = getRemainingCount(card);
  return {
    ...card,
    title: "Food trail almost ready",
    subtitle: city && remaining > 0
      ? `Save ${remaining} more food places in ${city}.`
      : "Save a few more food places to build a trail.",
    ctaLabel: "Add places",
  };
}

function buildDefaultListCopy(
  card: HeroCardContent,
  currentLocationLabel: string,
  visibleSavedPlaces: SavedPlaceRecord[],
): HeroCardContent {
  const city = getHeroCity(card, currentLocationLabel, visibleSavedPlaces);
  return {
    ...card,
    title: city ? `Start your ${city} list` : "Start your list",
    subtitle: "Save places from reels and plan them later.",
    ctaLabel: "Add a place",
  };
}

function buildDominantCategoryCopy(
  card: HeroCardContent,
  currentLocationLabel: string,
  visibleSavedPlaces: SavedPlaceRecord[],
): HeroCardContent {
  const city = getHeroCity(card, currentLocationLabel, visibleSavedPlaces);
  const category = normalizeText(card.metadata?.targetCategory);
  if (category === "Explore") {
    return buildCityPlanCopy(card, currentLocationLabel, visibleSavedPlaces);
  }
  if (category === "Taste") {
    return buildFoodTrailReadyCopy(card, currentLocationLabel, visibleSavedPlaces);
  }
  return {
    ...card,
    title: city ? `${city} ${category || "saved"} list is ready` : "Your saved list is ready",
    subtitle: "Your saved places are ready to explore.",
    ctaLabel: "View saves",
  };
}

export function normalizeHeroCardContent<T extends HeroCardContent>(
  card: T,
  currentLocationLabel: string,
  visibleSavedPlaces: SavedPlaceRecord[] = [],
): T {
  let nextCard: HeroCardContent;
  switch (card.ctaAction) {
    case "build_food_trail":
      nextCard = buildFoodTrailReadyCopy(card, currentLocationLabel, visibleSavedPlaces);
      break;
    case "grow_saved_places":
      nextCard = buildAlmostReadyFoodCopy(card, currentLocationLabel, visibleSavedPlaces);
      break;
    case "view_city_plan":
    case "plan_weekend_explore":
    case "create_itinerary":
      nextCard = buildCityPlanCopy(card, currentLocationLabel, visibleSavedPlaces);
      break;
    case "view_dominant_category":
      nextCard = buildDominantCategoryCopy(card, currentLocationLabel, visibleSavedPlaces);
      break;
    case "add_first_place":
    case "grow_saved_memory":
      nextCard = buildDefaultListCopy(card, currentLocationLabel, visibleSavedPlaces);
      break;
    default:
      nextCard = card;
      break;
  }

  return {
    ...card,
    ...nextCard,
  };
}
