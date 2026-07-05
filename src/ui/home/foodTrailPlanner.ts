import type { SavedPlaceRecord } from "./savedPlaces";

export type FoodTrailTiming = "now_today" | "today_evening" | "tomorrow" | "weekend";
export type FoodTrailStopRole = "Breakfast" | "Lunch" | "Dinner" | "Cafe" | "Dessert" | "Snack";

export type FoodTrailStop = {
  placeId: string;
  title: string;
  locality: string;
  role: FoodTrailStopRole;
  travelGapLabel: string | null;
};

export type FoodTrailPlan = {
  timing: FoodTrailTiming;
  timingLabel: string;
  dateLabel: string;
  suggestedStartTimeLabel: string;
  trailStyleLabel: string;
  totalDurationLabel: string;
  summaryLabel: string;
  whyRouteLabel: string;
  stops: FoodTrailStop[];
};

type FoodTrailPhase = "morning" | "afternoon" | "evening" | "late_night";

type FoodTrailPreset = {
  timingLabel: string;
  dateLabel: string;
  suggestedStartTimeLabel: string;
  trailStyleLabel: string;
  desiredRoles: FoodTrailStopRole[];
  phase: FoodTrailPhase;
  targetCount: number;
};

type RolePatternConfig = {
  strong: string[];
  support?: string[];
  avoid?: string[];
};

type ScoredPlace = {
  place: SavedPlaceRecord;
  score: number;
  actualRole: FoodTrailStopRole;
};

const TRAVEL_GAP_LABELS = ["10-15 min", "15-20 min", "20-25 min", "10-12 min"];

const ROLE_PATTERNS: Record<FoodTrailStopRole, RolePatternConfig> = {
  Breakfast: {
    strong: ["breakfast", "brunch", "idli", "dosa", "poha", "upma", "pancake", "omelette", "omelet", "bagel"],
    support: ["bakery", "filter coffee", "chai", "tea", "coffee", "toast", "eggs"],
    avoid: ["biryani", "bar", "pub", "brewery", "cocktail", "grill", "bbq", "kebab", "steak", "tandoor"],
  },
  Lunch: {
    strong: ["lunch", "thali", "meals", "meal", "restaurant", "kitchen", "curry", "bowl", "canteen"],
    support: ["bistro", "diner", "noodles", "rice", "paratha", "south indian", "north indian"],
    avoid: ["dessert", "ice cream", "gelato", "bar", "pub", "cocktail"],
  },
  Dinner: {
    strong: ["dinner", "biryani", "barbecue", "bbq", "grill", "steak", "kebab", "tandoor", "pub", "bar", "brewery"],
    support: ["restaurant", "kitchen", "ramen", "sushi", "seafood", "pasta", "thali"],
    avoid: ["breakfast", "brunch", "ice cream", "gelato", "patisserie"],
  },
  Cafe: {
    strong: ["cafe", "coffee", "espresso", "roastery", "brews", "tea room", "bistro"],
    support: ["bakery", "brunch", "workspace", "latte", "dessert", "patisserie"],
    avoid: ["biryani", "steakhouse", "grill", "barbeque", "barbecue", "pub", "cocktail"],
  },
  Dessert: {
    strong: ["dessert", "pastry", "ice cream", "gelato", "kulfi", "cake", "sweet", "waffle", "brownie", "patisserie"],
    support: ["bakery", "cookie", "chocolate", "mithai", "shake"],
    avoid: ["biryani", "grill", "steak", "pub", "bar", "brewery", "thali"],
  },
  Snack: {
    strong: ["snack", "chaat", "street food", "roll", "momo", "bites", "sandwich", "fries", "wrap"],
    support: ["stall", "quick bites", "tea", "bakery", "cart"],
    avoid: ["fine dining", "steak", "pub", "bar", "biryani feast"],
  },
};

const PHASE_ROLE_BONUS: Record<FoodTrailPhase, Record<FoodTrailStopRole, number>> = {
  morning: { Breakfast: 6, Cafe: 4, Snack: 2, Dessert: 0, Lunch: -1, Dinner: -4 },
  afternoon: { Lunch: 6, Cafe: 4, Snack: 3, Dessert: 1, Breakfast: -1, Dinner: 1 },
  evening: { Dinner: 6, Dessert: 4, Cafe: 3, Snack: 1, Lunch: 1, Breakfast: -5 },
  late_night: { Snack: 6, Dessert: 4, Cafe: 2, Dinner: 2, Lunch: -4, Breakfast: -6 },
};

const ALL_ROLES = Object.keys(ROLE_PATTERNS) as FoodTrailStopRole[];

function getPlaceKey(place: SavedPlaceRecord): string {
  return String(place.placeId || place.id || "").trim();
}

function normalizeText(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countKeywordMatches(haystack: string, keywords: string[]): number {
  return keywords.reduce((count, keyword) => {
    const pattern = new RegExp(`\\b${escapeRegExp(keyword).replace(/\\ /g, "\\s+")}\\b`, "g");
    const matches = haystack.match(pattern);
    return count + (matches?.length || 0);
  }, 0);
}

function getPlaceEvidenceText(place: SavedPlaceRecord): string {
  const extendedPlace = place as SavedPlaceRecord & {
    subcategory?: unknown;
    text?: unknown;
    description?: unknown;
  };

  return [
    place.title,
    place.metaPrimary,
    place.metaSecondary,
    place.locality,
    place.city,
    place.fullAddress,
    extendedPlace.subcategory,
    extendedPlace.text,
    extendedPlace.description,
    ...(Array.isArray(place.tags) ? place.tags : []),
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(" ");
}

function scorePlaceForRole(place: SavedPlaceRecord, role: FoodTrailStopRole, phase: FoodTrailPhase): number {
  const haystack = getPlaceEvidenceText(place);
  const config = ROLE_PATTERNS[role];
  const strongMatches = countKeywordMatches(haystack, config.strong);
  const supportMatches = countKeywordMatches(haystack, config.support || []);
  const avoidMatches = countKeywordMatches(haystack, config.avoid || []);

  let score = strongMatches * 8 + supportMatches * 3 - avoidMatches * 7 + PHASE_ROLE_BONUS[phase][role];

  if (role === "Cafe" && /\b(filter coffee|chai|tea|coffee)\b/.test(haystack)) score += 2;
  if (role === "Breakfast" && /\b(cafe|bakery|brunch)\b/.test(haystack)) score += 2;
  if (role === "Dessert" && /\b(cafe|bakery)\b/.test(haystack)) score += 1;
  if ((role === "Lunch" || role === "Dinner") && /\b(restaurant|kitchen|house)\b/.test(haystack)) score += 2;
  if ((role === "Breakfast" || role === "Cafe" || role === "Dessert") && /\b(bar|pub|brewery|cocktail)\b/.test(haystack)) {
    score -= 5;
  }

  return score;
}

function inferBestRole(place: SavedPlaceRecord, phase: FoodTrailPhase): FoodTrailStopRole {
  return [...ALL_ROLES]
    .map((role) => ({ role, score: scorePlaceForRole(place, role, phase) }))
    .sort((a, b) => b.score - a.score)[0]?.role || "Snack";
}

function formatWeekdayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

function getWeekendAnchor(now: Date): Date {
  const anchor = new Date(now);
  const day = anchor.getDay();
  const daysUntilSaturday = (6 - day + 7) % 7;
  anchor.setDate(anchor.getDate() + daysUntilSaturday);
  anchor.setHours(11, 30, 0, 0);
  return anchor;
}

function buildTimingPreset(timing: FoodTrailTiming, now: Date): FoodTrailPreset {
  const currentHour = now.getHours();

  if (timing === "today_evening") {
    return {
      timingLabel: "Today evening",
      dateLabel: "Today",
      suggestedStartTimeLabel: "Around 7:30 PM",
      trailStyleLabel: "Dinner and dessert trail",
      desiredRoles: ["Dinner", "Dessert", "Cafe"],
      phase: "evening",
      targetCount: 3,
    };
  }

  if (timing === "tomorrow") {
    return {
      timingLabel: "Tomorrow",
      dateLabel: "Tomorrow",
      suggestedStartTimeLabel: "Around 11:30 AM",
      trailStyleLabel: "Brunch and cafe trail",
      desiredRoles: ["Breakfast", "Cafe", "Dessert"],
      phase: "morning",
      targetCount: 3,
    };
  }

  if (timing === "weekend") {
    const weekendAnchor = getWeekendAnchor(now);
    return {
      timingLabel: "This weekend",
      dateLabel: `${formatWeekdayLabel(weekendAnchor)} weekend`,
      suggestedStartTimeLabel: "Around 12:00 PM",
      trailStyleLabel: "Weekend food crawl",
      desiredRoles: ["Lunch", "Cafe", "Snack", "Dessert"],
      phase: "afternoon",
      targetCount: 4,
    };
  }

  if (currentHour < 11) {
    return {
      timingLabel: "Now / Today",
      dateLabel: "Today",
      suggestedStartTimeLabel: "Around 9:30 AM",
      trailStyleLabel: "Breakfast and cafe trail",
      desiredRoles: ["Breakfast", "Cafe", "Snack"],
      phase: "morning",
      targetCount: 3,
    };
  }

  if (currentHour < 16) {
    return {
      timingLabel: "Now / Today",
      dateLabel: "Today",
      suggestedStartTimeLabel: "Around 1:00 PM",
      trailStyleLabel: "Lunch and cafe trail",
      desiredRoles: ["Lunch", "Cafe", "Snack"],
      phase: "afternoon",
      targetCount: 3,
    };
  }

  if (currentHour < 22) {
    return {
      timingLabel: "Now / Today",
      dateLabel: "Today",
      suggestedStartTimeLabel: "Around 7:45 PM",
      trailStyleLabel: "Dinner and dessert trail",
      desiredRoles: ["Dinner", "Dessert", "Cafe"],
      phase: "evening",
      targetCount: 3,
    };
  }

  return {
    timingLabel: "Now / Today",
    dateLabel: "Tonight",
    suggestedStartTimeLabel: "Around 10:45 PM",
    trailStyleLabel: "Late-night bites trail",
    desiredRoles: ["Snack", "Dessert"],
    phase: "late_night",
    targetCount: 2,
  };
}

export function resolveDefaultFoodTrailTiming(now: Date): FoodTrailTiming {
  const hour = now.getHours();
  if (hour >= 22) return "tomorrow";
  if (hour >= 18) return "today_evening";
  return "now_today";
}

function dedupePlaces(places: SavedPlaceRecord[]): SavedPlaceRecord[] {
  const seen = new Set<string>();
  return places.filter((place) => {
    const key = getPlaceKey(place);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rankPlacesForRole(
  places: SavedPlaceRecord[],
  desiredRole: FoodTrailStopRole,
  phase: FoodTrailPhase,
  previousStop: FoodTrailStop | null,
): ScoredPlace[] {
  return [...places]
    .map((place) => {
      const actualRole = inferBestRole(place, phase);
      const desiredScore = scorePlaceForRole(place, desiredRole, phase);
      const localityBonus =
        previousStop && normalizeText(previousStop.locality) && normalizeText(place.locality) === normalizeText(previousStop.locality)
          ? 2
          : 0;
      const fallbackScore = scorePlaceForRole(place, actualRole, phase);

      return {
        place,
        actualRole,
        score: desiredScore + localityBonus,
        fallbackScore,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.fallbackScore !== a.fallbackScore) return b.fallbackScore - a.fallbackScore;
      return a.place.title.localeCompare(b.place.title);
    });
}

function chooseCandidateIndex(candidateCount: number, rebuildSeed: number, roleIndex: number): number {
  if (candidateCount <= 1) return 0;
  return (rebuildSeed + roleIndex) % candidateCount;
}

function pickStops(
  places: SavedPlaceRecord[],
  preset: FoodTrailPreset,
  rebuildSeed: number,
): FoodTrailStop[] {
  const remaining = [...places];
  const selected: FoodTrailStop[] = [];

  while (selected.length < preset.targetCount && remaining.length) {
    const desiredRole = preset.desiredRoles[selected.length % preset.desiredRoles.length];
    const ranked = rankPlacesForRole(remaining, desiredRole, preset.phase, selected[selected.length - 1] || null);
    if (!ranked.length) break;

    const bestScore = ranked[0].score;
    const viable = ranked.filter((item) => item.score >= bestScore - 2 && item.score > 0);
    const pool = viable.length ? viable.slice(0, 3) : ranked.slice(0, 3);
    const picked = pool[chooseCandidateIndex(pool.length, rebuildSeed, selected.length)] || ranked[0];
    const selectedRole = scorePlaceForRole(picked.place, desiredRole, preset.phase) > 0 ? desiredRole : picked.actualRole;
    const pickedIndex = remaining.findIndex((place) => getPlaceKey(place) === getPlaceKey(picked.place));
    const nextPlace = pickedIndex >= 0 ? remaining.splice(pickedIndex, 1)[0] : remaining.shift();

    if (!nextPlace) break;

    selected.push({
      placeId: getPlaceKey(nextPlace),
      title: nextPlace.title,
      locality: nextPlace.locality || nextPlace.city || "Saved place",
      role: selectedRole,
      travelGapLabel: null,
    });
  }

  return selected.map((stop, index) => ({
    ...stop,
    travelGapLabel: index === 0 ? null : TRAVEL_GAP_LABELS[(index - 1) % TRAVEL_GAP_LABELS.length],
  }));
}

function buildWhyRouteLabel(stops: FoodTrailStop[]): string {
  if (!stops.length) return "Built from the saved places that best fit this time window.";

  const firstRole = stops[0].role.toLowerCase();
  const laterCafe = stops.slice(1).some((stop) => stop.role === "Cafe");
  const localities = stops
    .map((stop) => normalizeText(stop.locality))
    .filter(Boolean);
  const hasLocalityCluster = new Set(localities).size < localities.length;

  const parts = [`Starts with ${/^[aeiou]/.test(firstRole) ? "an" : "a"} ${firstRole}`];
  if (laterCafe) parts.push("keeps cafes later");
  if (hasLocalityCluster) {
    parts.push("loosely groups nearby saved spots");
  } else if (stops.length > 1) {
    parts.push("keeps the handoff between stops simple");
  }
  return `${parts.join(", ")}.`;
}

export function buildFoodTrailPlan(
  places: SavedPlaceRecord[],
  timing: FoodTrailTiming,
  options?: { now?: Date; rebuildSeed?: number },
): FoodTrailPlan {
  const now = options?.now || new Date();
  const rebuildSeed = options?.rebuildSeed || 0;
  const preset = buildTimingPreset(timing, now);
  const dedupedPlaces = dedupePlaces(places);
  const tastePlaces = dedupedPlaces.filter((place) => place.category === "Taste");
  const targetCount = Math.min(preset.targetCount, tastePlaces.length);
  const stops = pickStops(tastePlaces, { ...preset, targetCount }, rebuildSeed);
  const totalDurationLabel =
    stops.length >= 4 ? "Around 3.5-4.5 hours" : stops.length === 3 ? "Around 2.5-3 hours" : "Around 1.5-2 hours";
  const summaryLabel =
    preset.phase === "late_night"
      ? `${stops.length} saved stops that could work later tonight`
      : stops.length >= 4
        ? `${stops.length} stops across your saved food places`
        : `${stops.length} saved stops for a short food run`;

  return {
    timing,
    timingLabel: preset.timingLabel,
    dateLabel: preset.dateLabel,
    suggestedStartTimeLabel: preset.suggestedStartTimeLabel,
    trailStyleLabel: preset.trailStyleLabel,
    totalDurationLabel,
    summaryLabel,
    whyRouteLabel: buildWhyRouteLabel(stops),
    stops,
  };
}
