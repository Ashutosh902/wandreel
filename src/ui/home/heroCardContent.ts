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

function getLocationCity(locationLabel: string): string {
  return locationLabel
    .split(",")
    .map((segment) => segment.trim())
    .find(Boolean) || "";
}

function getHeroCity(card: HeroCardContent, currentLocationLabel: string): string {
  return normalizeText(card.metadata?.targetCity) || getLocationCity(currentLocationLabel);
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

function buildFoodTrailReadyCopy(card: HeroCardContent, currentLocationLabel: string): HeroCardContent {
  const city = getHeroCity(card, currentLocationLabel);
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

function buildCityPlanCopy(card: HeroCardContent, currentLocationLabel: string): HeroCardContent {
  const city = getHeroCity(card, currentLocationLabel);
  return {
    ...card,
    title: formatCityPrefix(city, "plan is ready"),
    subtitle: "Your saved places can shape a weekend route.",
    ctaLabel: "Plan weekend",
  };
}

function buildAlmostReadyFoodCopy(card: HeroCardContent, currentLocationLabel: string): HeroCardContent {
  const city = getHeroCity(card, currentLocationLabel);
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

function buildDefaultListCopy(card: HeroCardContent, currentLocationLabel: string): HeroCardContent {
  const city = getHeroCity(card, currentLocationLabel);
  return {
    ...card,
    title: city ? `Start your ${city} list` : "Start your list",
    subtitle: "Save places from reels and plan them later.",
    ctaLabel: "Add a place",
  };
}

function buildDominantCategoryCopy(card: HeroCardContent, currentLocationLabel: string): HeroCardContent {
  const city = getHeroCity(card, currentLocationLabel);
  const category = normalizeText(card.metadata?.targetCategory);
  if (category === "Explore") {
    return buildCityPlanCopy(card, currentLocationLabel);
  }
  if (category === "Taste") {
    return buildFoodTrailReadyCopy(card, currentLocationLabel);
  }
  return {
    ...card,
    title: city ? `${city} ${category || "saved"} list is ready` : "Your saved list is ready",
    subtitle: "Your saved places are ready to explore.",
    ctaLabel: "View saves",
  };
}

export function normalizeHeroCardContent<T extends HeroCardContent>(card: T, currentLocationLabel: string): T {
  let nextCard: HeroCardContent;
  switch (card.ctaAction) {
    case "build_food_trail":
      nextCard = buildFoodTrailReadyCopy(card, currentLocationLabel);
      break;
    case "grow_saved_places":
      nextCard = buildAlmostReadyFoodCopy(card, currentLocationLabel);
      break;
    case "view_city_plan":
    case "plan_weekend_explore":
    case "create_itinerary":
      nextCard = buildCityPlanCopy(card, currentLocationLabel);
      break;
    case "view_dominant_category":
      nextCard = buildDominantCategoryCopy(card, currentLocationLabel);
      break;
    case "add_first_place":
    case "grow_saved_memory":
      nextCard = buildDefaultListCopy(card, currentLocationLabel);
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
