import type { CategoryLabel } from "./home.data";
import type { SavedPlaceRecord } from "./savedPlaces";

export type WeekendPlannerTiming = "this_saturday" | "this_sunday" | "next_weekend" | "pick_later";
export type WeekendStopRole = "Food stop" | "Explore stop" | "Activity" | "Break";

export type WeekendPlannerStop = {
  placeId: string;
  title: string;
  category: CategoryLabel;
  locality: string;
  role: WeekendStopRole;
  travelGapLabel: string | null;
};

export type WeekendPlannerPlan = {
  timing: WeekendPlannerTiming;
  timingLabel: string;
  dateLabel: string;
  suggestedStartTimeLabel: string;
  planStyleLabel: string;
  whyPlanLabel: string;
  summaryLabel: string;
  stops: WeekendPlannerStop[];
};

type WeekendPlannerPreset = {
  timingLabel: string;
  dateLabel: string;
  suggestedStartTimeLabel: string;
  planStyleLabel: string;
  desiredStops: Array<{ category: CategoryLabel; role: WeekendStopRole }>;
};

type RankedWeekendPlace = {
  place: SavedPlaceRecord;
  score: number;
};

const RELEVANT_CATEGORIES: CategoryLabel[] = ["Taste", "Explore", "Activity"];
const TRAVEL_GAP_LABELS = ["12-18 min", "15-22 min", "10-15 min", "18-25 min"];

function normalizeText(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function getPlaceKey(place: SavedPlaceRecord): string {
  return String(place.placeId || place.id || "").trim();
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

function isBreakFriendly(place: SavedPlaceRecord): boolean {
  const haystack = [place.title, place.metaPrimary, place.metaSecondary, ...(place.tags || [])]
    .map((item) => normalizeText(item))
    .join(" ");
  return /\b(cafe|coffee|tea|dessert|gelato|ice cream|snack|chaat|bakery|pastry)\b/.test(haystack);
}

function buildWeekendPreset(timing: WeekendPlannerTiming): WeekendPlannerPreset {
  switch (timing) {
    case "this_saturday":
      return {
        timingLabel: "This Saturday",
        dateLabel: "Saturday",
        suggestedStartTimeLabel: "Around 10:30 AM",
        planStyleLabel: "Saturday morning route",
        desiredStops: [
          { category: "Taste", role: "Food stop" },
          { category: "Explore", role: "Explore stop" },
          { category: "Activity", role: "Activity" },
          { category: "Taste", role: "Break" },
        ],
      };
    case "this_sunday":
      return {
        timingLabel: "This Sunday",
        dateLabel: "Sunday",
        suggestedStartTimeLabel: "Around 11:00 AM",
        planStyleLabel: "Sunday easy route",
        desiredStops: [
          { category: "Taste", role: "Food stop" },
          { category: "Activity", role: "Activity" },
          { category: "Explore", role: "Explore stop" },
          { category: "Taste", role: "Break" },
        ],
      };
    case "pick_later":
      return {
        timingLabel: "Pick later",
        dateLabel: "Later",
        suggestedStartTimeLabel: "When you are ready",
        planStyleLabel: "Flexible city route",
        desiredStops: [
          { category: "Explore", role: "Explore stop" },
          { category: "Taste", role: "Food stop" },
          { category: "Activity", role: "Activity" },
        ],
      };
    case "next_weekend":
    default:
      return {
        timingLabel: "Next weekend",
        dateLabel: "Next weekend",
        suggestedStartTimeLabel: "Around 11:30 AM",
        planStyleLabel: "Weekend city route",
        desiredStops: [
          { category: "Explore", role: "Explore stop" },
          { category: "Taste", role: "Food stop" },
          { category: "Activity", role: "Activity" },
          { category: "Taste", role: "Break" },
        ],
      };
  }
}

export function resolveDefaultWeekendPlannerTiming(now: Date): WeekendPlannerTiming {
  const day = now.getDay();
  const hour = now.getHours();
  if (day === 6) return hour < 16 ? "this_saturday" : "this_sunday";
  if (day === 0) return hour < 15 ? "this_sunday" : "next_weekend";
  return "next_weekend";
}

export function isWeekendPlannerAction(ctaAction: string, targetCategory?: string | null): boolean {
  return (
    ctaAction === "view_city_plan" ||
    ctaAction === "plan_weekend_explore" ||
    ctaAction === "create_itinerary" ||
    (ctaAction === "view_dominant_category" && targetCategory === "Explore")
  );
}

function chooseCandidateIndex(candidateCount: number, rebuildSeed: number, roleIndex: number): number {
  if (candidateCount <= 1) return 0;
  return (rebuildSeed + roleIndex) % candidateCount;
}

function rankWeekendPlaces(
  places: SavedPlaceRecord[],
  desired: { category: CategoryLabel; role: WeekendStopRole },
  previousStop: WeekendPlannerStop | null,
): RankedWeekendPlace[] {
  return [...places]
    .filter((place) => place.category === desired.category)
    .map((place) => {
      const localityBonus =
        previousStop && normalizeText(previousStop.locality) && normalizeText(place.locality) === normalizeText(previousStop.locality)
          ? 2
          : 0;
      const breakBonus = desired.role === "Break" && isBreakFriendly(place) ? 3 : 0;
      return { place, score: localityBonus + breakBonus };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.place.title.localeCompare(b.place.title);
    });
}

function pickWeekendStops(
  places: SavedPlaceRecord[],
  preset: WeekendPlannerPreset,
  rebuildSeed: number,
): WeekendPlannerStop[] {
  const remaining = [...places];
  const selected: WeekendPlannerStop[] = [];

  for (const desired of preset.desiredStops) {
    const ranked = rankWeekendPlaces(remaining, desired, selected[selected.length - 1] || null);
    if (!ranked.length) continue;
    const pool = ranked.slice(0, Math.min(3, ranked.length));
    const picked = pool[chooseCandidateIndex(pool.length, rebuildSeed, selected.length)] || ranked[0];
    const pickedIndex = remaining.findIndex((place) => getPlaceKey(place) === getPlaceKey(picked.place));
    const nextPlace = pickedIndex >= 0 ? remaining.splice(pickedIndex, 1)[0] : remaining.shift();
    if (!nextPlace) continue;
    selected.push({
      placeId: getPlaceKey(nextPlace),
      title: nextPlace.title,
      category: nextPlace.category,
      locality: nextPlace.locality || nextPlace.city || "Saved place",
      role: desired.role,
      travelGapLabel: null,
    });
  }

  return selected.map((stop, index) => ({
    ...stop,
    travelGapLabel: index === 0 ? null : TRAVEL_GAP_LABELS[(index - 1) % TRAVEL_GAP_LABELS.length],
  }));
}

function buildWhyPlanLabel(stops: WeekendPlannerStop[]): string {
  if (!stops.length) return "Built from your saved city spots.";
  const categories = new Set(stops.map((stop) => stop.category));
  const localities = new Set(stops.map((stop) => normalizeText(stop.locality)).filter(Boolean));
  const parts = ["Mixes saved food, explore, and activity stops"];
  if (categories.size >= 3) parts.push("keeps the route varied");
  if (localities.size < stops.length) parts.push("and lightly groups nearby areas");
  return `${parts.join(" ")}.`;
}

export function buildWeekendPlan(
  places: SavedPlaceRecord[],
  timing: WeekendPlannerTiming,
  options?: { now?: Date; rebuildSeed?: number },
): WeekendPlannerPlan {
  const preset = buildWeekendPreset(timing);
  const rebuildSeed = options?.rebuildSeed || 0;
  const filteredPlaces = dedupePlaces(places).filter((place) => RELEVANT_CATEGORIES.includes(place.category));
  const stops = pickWeekendStops(filteredPlaces, preset, rebuildSeed);
  const summaryLabel =
    stops.length >= 4
      ? `${stops.length} saved places for a fuller weekend run`
      : `${stops.length} saved places for a light weekend route`;

  return {
    timing,
    timingLabel: preset.timingLabel,
    dateLabel: preset.dateLabel,
    suggestedStartTimeLabel: preset.suggestedStartTimeLabel,
    planStyleLabel: preset.planStyleLabel,
    summaryLabel,
    whyPlanLabel: buildWhyPlanLabel(stops),
    stops,
  };
}
