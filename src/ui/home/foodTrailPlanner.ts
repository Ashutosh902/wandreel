import type { SavedPlaceRecord } from "./savedPlaces";

export type FoodTrailTiming = "now_today" | "today_evening" | "tomorrow" | "weekend";
export type FoodTrailStopRole = "Meal" | "Cafe" | "Dessert" | "Snack";

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
  stops: FoodTrailStop[];
};

type FoodTrailPreset = {
  timingLabel: string;
  dateLabel: string;
  suggestedStartTimeLabel: string;
  trailStyleLabel: string;
  desiredRoles: FoodTrailStopRole[];
};

const TRAVEL_GAP_LABELS = ["10-15 min", "15-20 min", "20-25 min", "10-12 min"];

function getPlaceKey(place: SavedPlaceRecord): string {
  return String(place.placeId || place.id || "").trim();
}

function normalizeText(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function classifyStopRole(place: SavedPlaceRecord): FoodTrailStopRole {
  const haystack = [
    place.title,
    place.metaPrimary,
    place.metaSecondary,
    place.locality,
    ...(Array.isArray(place.tags) ? place.tags : []),
  ]
    .map((value) => normalizeText(value))
    .join(" ");

  if (/\b(cafe|coffee|espresso|roastery|bakery|brunch)\b/.test(haystack)) return "Cafe";
  if (/\b(dessert|pastry|ice cream|gelato|kulfi|cake|sweet|waffle|brownie)\b/.test(haystack)) return "Dessert";
  if (/\b(snack|chaat|street|roll|momo|bites|sandwich)\b/.test(haystack)) return "Snack";
  return "Meal";
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
      suggestedStartTimeLabel: "7:30 PM",
      trailStyleLabel: "Dinner and dessert trail",
      desiredRoles: ["Meal", "Dessert", "Cafe", "Snack"],
    };
  }

  if (timing === "tomorrow") {
    return {
      timingLabel: "Tomorrow",
      dateLabel: "Tomorrow",
      suggestedStartTimeLabel: "11:30 AM",
      trailStyleLabel: "Brunch and cafe trail",
      desiredRoles: ["Meal", "Cafe", "Dessert", "Snack"],
    };
  }

  if (timing === "weekend") {
    const weekendAnchor = getWeekendAnchor(now);
    return {
      timingLabel: "This weekend",
      dateLabel: `${formatWeekdayLabel(weekendAnchor)} weekend`,
      suggestedStartTimeLabel: "12:00 PM",
      trailStyleLabel: "Weekend food crawl",
      desiredRoles: ["Meal", "Cafe", "Snack", "Dessert"],
    };
  }

  if (currentHour < 11) {
    return {
      timingLabel: "Now / Today",
      dateLabel: "Today",
      suggestedStartTimeLabel: "9:30 AM",
      trailStyleLabel: "Breakfast and cafe trail",
      desiredRoles: ["Cafe", "Meal", "Dessert", "Snack"],
    };
  }

  if (currentHour < 15) {
    return {
      timingLabel: "Now / Today",
      dateLabel: "Today",
      suggestedStartTimeLabel: "1:00 PM",
      trailStyleLabel: "Lunch and cafe trail",
      desiredRoles: ["Meal", "Cafe", "Snack", "Dessert"],
    };
  }

  if (currentHour < 18) {
    return {
      timingLabel: "Now / Today",
      dateLabel: "Today",
      suggestedStartTimeLabel: "4:30 PM",
      trailStyleLabel: "Cafe and snack trail",
      desiredRoles: ["Cafe", "Snack", "Dessert", "Meal"],
    };
  }

  if (currentHour < 22) {
    return {
      timingLabel: "Now / Today",
      dateLabel: "Today",
      suggestedStartTimeLabel: "7:45 PM",
      trailStyleLabel: "Dinner and dessert trail",
      desiredRoles: ["Meal", "Dessert", "Cafe", "Snack"],
    };
  }

  return {
    timingLabel: "Now / Today",
    dateLabel: "Tonight",
    suggestedStartTimeLabel: "10:30 PM",
    trailStyleLabel: "Late-night bites trail",
    desiredRoles: ["Snack", "Dessert", "Cafe", "Meal"],
  };
}

export function resolveDefaultFoodTrailTiming(now: Date): FoodTrailTiming {
  const hour = now.getHours();
  if (hour >= 22) return "tomorrow";
  if (hour >= 18) return "today_evening";
  return "now_today";
}

function rotatePlaces<T>(items: T[], offset: number): T[] {
  if (!items.length) return items;
  const normalizedOffset = ((offset % items.length) + items.length) % items.length;
  if (!normalizedOffset) return items;
  return [...items.slice(normalizedOffset), ...items.slice(0, normalizedOffset)];
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

function pickStops(
  places: SavedPlaceRecord[],
  desiredRoles: FoodTrailStopRole[],
  targetCount: number,
): FoodTrailStop[] {
  const remaining = [...places];
  const selected: FoodTrailStop[] = [];

  const takeNextMatch = (role: FoodTrailStopRole) => {
    const matchIndex = remaining.findIndex((place) => classifyStopRole(place) === role);
    const nextPlace = matchIndex >= 0 ? remaining.splice(matchIndex, 1)[0] : remaining.shift();
    if (!nextPlace) return;
    selected.push({
      placeId: getPlaceKey(nextPlace),
      title: nextPlace.title,
      locality: nextPlace.locality || nextPlace.city || "Saved place",
      role: classifyStopRole(nextPlace),
      travelGapLabel: null,
    });
  };

  while (selected.length < targetCount && remaining.length) {
    for (const role of desiredRoles) {
      if (selected.length >= targetCount || !remaining.length) break;
      takeNextMatch(role);
    }
  }

  return selected.map((stop, index) => ({
    ...stop,
    travelGapLabel: index === 0 ? null : TRAVEL_GAP_LABELS[(index - 1) % TRAVEL_GAP_LABELS.length],
  }));
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
  const rotatedPlaces = rotatePlaces(dedupedPlaces, rebuildSeed);
  const rotatedDesiredRoles = rotatePlaces(preset.desiredRoles, rebuildSeed);
  const targetCount = timing === "weekend" ? Math.min(4, rotatedPlaces.length) : Math.min(3, rotatedPlaces.length);
  const stops = pickStops(rotatedPlaces, rotatedDesiredRoles, targetCount);
  const totalDurationLabel = stops.length >= 4 ? "3.5-4.5 hours" : stops.length === 3 ? "2.5-3 hours" : "1.5-2 hours";
  const summaryLabel =
    stops.length >= 4
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
    stops,
  };
}
