import type { SavedPlaceRecord } from "./savedPlaces";
import { resolveLocationContext } from "./locationContext";

type HeroCardContent = {
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaAction: string;
  heroState?: "suggestion" | "ready_stroll";
  metadata?: Record<string, unknown>;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeHeroDisplayCityLabel(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  switch (normalized.toLowerCase()) {
    case "patna division":
    case "patna district":
      return "Patna";
    default:
      return normalized;
  }
}

function getHeroCity(card: HeroCardContent, currentLocationLabel: string, visibleSavedPlaces: SavedPlaceRecord[]): string {
  const context = resolveLocationContext(
    currentLocationLabel,
    visibleSavedPlaces,
    normalizeText(card.metadata?.targetCity) || null,
  );
  return normalizeHeroDisplayCityLabel(context.cityName || context.localityName || "");
}

function getMatchingCount(card: HeroCardContent): number {
  const ids = Array.isArray(card.metadata?.matchingPlaceIds) ? card.metadata?.matchingPlaceIds : [];
  return ids.map((item) => String(item || "").trim()).filter(Boolean).length;
}

function getRemainingCount(card: HeroCardContent): number {
  const remaining = Number(card.metadata?.remainingTastePlaces);
  return Number.isFinite(remaining) && remaining > 0 ? remaining : 0;
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
    title: city ? `Your ${city} food Stroll is ready` : "Your food Stroll is ready",
    subtitle: count > 0
      ? `${count} Taste saves can shape today's route.`
      : "Your saved places can shape today's route.",
    ctaLabel: "Begin Here",
  };
}

function buildCityPlanReadyCopy(
  card: HeroCardContent,
  currentLocationLabel: string,
  visibleSavedPlaces: SavedPlaceRecord[],
): HeroCardContent {
  const city = getHeroCity(card, currentLocationLabel, visibleSavedPlaces);
  return {
    ...card,
    title: city ? `Your ${city} Weekend Stroll is ready` : "Your Weekend Stroll is ready",
    subtitle: "Your saved places can shape a calm route for today.",
    ctaLabel: "Begin Here",
  };
}

function buildCityPlanSuggestionCopy(
  card: HeroCardContent,
  currentLocationLabel: string,
  visibleSavedPlaces: SavedPlaceRecord[],
): HeroCardContent {
  const city = getHeroCity(card, currentLocationLabel, visibleSavedPlaces);
  return {
    ...card,
    title: city ? `Turn your ${city} saves into a weekend Stroll` : "Turn your saved places into a weekend Stroll",
    subtitle: "Your saved places can shape a calm route for today.",
    ctaLabel: "Create Stroll",
  };
}

function buildFoodTrailSuggestionCopy(
  card: HeroCardContent,
  currentLocationLabel: string,
  visibleSavedPlaces: SavedPlaceRecord[],
): HeroCardContent {
  const city = getHeroCity(card, currentLocationLabel, visibleSavedPlaces);
  const count = getMatchingCount(card);
  return {
    ...card,
    title: city ? `Build a ${city} food Stroll` : "Build a food Stroll",
    subtitle: count > 0
      ? `${count} Taste saves can shape today's route.`
      : "Your Taste saves can shape today's route.",
    ctaLabel: "Build Stroll",
  };
}

function buildTakingShapeCopy(
  card: HeroCardContent,
  currentLocationLabel: string,
  visibleSavedPlaces: SavedPlaceRecord[],
): HeroCardContent {
  const city = getHeroCity(card, currentLocationLabel, visibleSavedPlaces);
  const targetCategory = normalizeText(card.metadata?.targetCategory);
  const remaining = getRemainingCount(card);
  const isFoodTrail = targetCategory === "Taste" || remaining > 0;
  const isWeekendPlan = targetCategory === "Explore";

  return {
    ...card,
    title: isFoodTrail
      ? "Food trail taking shape"
      : isWeekendPlan
        ? `${city ? `${city} weekend plan` : "Weekend plan"} taking shape`
        : city
          ? `${city} Stroll taking shape`
          : "Your Stroll is taking shape",
    subtitle: isFoodTrail
      ? city && remaining > 0
        ? `Save ${remaining} more food places in ${city}.`
        : "Save a few more food places to keep shaping the route."
      : isWeekendPlan
        ? city
          ? `Save a few more places in ${city} to keep shaping the route.`
          : "Save a few more places to keep shaping the route."
        : "Save a few more places to keep shaping the route.",
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
    return buildCityPlanSuggestionCopy(card, currentLocationLabel, visibleSavedPlaces);
  }
  if (category === "Taste") {
    return buildFoodTrailSuggestionCopy(card, currentLocationLabel, visibleSavedPlaces);
  }
  return {
    ...card,
    title: city
      ? `Create a ${city} ${category || "saved"} Stroll`
      : `Create a ${category || "saved"} Stroll`,
    subtitle: "Your saved places can shape a route for today.",
    ctaLabel: "Create Stroll",
  };
}

function buildReadyDominantCategoryCopy(
  card: HeroCardContent,
  currentLocationLabel: string,
  visibleSavedPlaces: SavedPlaceRecord[],
): HeroCardContent {
  const city = getHeroCity(card, currentLocationLabel, visibleSavedPlaces);
  const category = normalizeText(card.metadata?.targetCategory);
  if (category === "Explore") {
    return buildCityPlanReadyCopy(card, currentLocationLabel, visibleSavedPlaces);
  }
  if (category === "Taste") {
    return buildFoodTrailReadyCopy(card, currentLocationLabel, visibleSavedPlaces);
  }
  return {
    ...card,
    title: city
      ? `Your ${city} ${category || "saved"} Stroll is ready`
      : `Your ${category || "saved"} Stroll is ready`,
    subtitle: "Your saved places can shape a route for today.",
    ctaLabel: "Begin Here",
  };
}

export function normalizeHeroCardContent<T extends HeroCardContent>(
  card: T,
  currentLocationLabel: string,
  visibleSavedPlaces: SavedPlaceRecord[] = [],
): T {
  let nextCard: HeroCardContent;
  if (card.heroState === "ready_stroll") {
    switch (card.ctaAction) {
      case "build_food_trail":
        nextCard = buildFoodTrailReadyCopy(card, currentLocationLabel, visibleSavedPlaces);
        break;
      case "grow_saved_places":
        nextCard = buildTakingShapeCopy(card, currentLocationLabel, visibleSavedPlaces);
        break;
      case "view_city_plan":
      case "plan_weekend_explore":
      case "create_itinerary":
        nextCard = buildCityPlanReadyCopy(card, currentLocationLabel, visibleSavedPlaces);
        break;
      case "view_dominant_category":
        nextCard = buildReadyDominantCategoryCopy(card, currentLocationLabel, visibleSavedPlaces);
        break;
      case "add_first_place":
      case "grow_saved_memory":
        nextCard = buildDefaultListCopy(card, currentLocationLabel, visibleSavedPlaces);
        break;
      default:
        nextCard = card;
        break;
    }
  } else {
    switch (card.ctaAction) {
      case "build_food_trail":
        nextCard = buildFoodTrailSuggestionCopy(card, currentLocationLabel, visibleSavedPlaces);
        break;
      case "grow_saved_places":
        nextCard = buildTakingShapeCopy(card, currentLocationLabel, visibleSavedPlaces);
        break;
      case "view_city_plan":
      case "plan_weekend_explore":
      case "create_itinerary":
        nextCard = buildCityPlanSuggestionCopy(card, currentLocationLabel, visibleSavedPlaces);
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
  }

  return {
    ...card,
    ...nextCard,
  };
}
