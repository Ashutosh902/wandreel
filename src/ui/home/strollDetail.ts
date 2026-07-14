import type { PersistentStrollDetail, PersistentStrollStop } from "./strollLibrary";

export type StrollMapStop = PersistentStrollStop & {
  markerNumber: number;
  lat: number;
  lng: number;
};

export type StrollDetailLoadState = "loading" | "ready" | "error";
export type StrollJourneyPhase = "idle" | "opening" | "walking" | "wakingMarkers" | "completing" | "handoff" | "controlled";
export type StrollStopStatus = "upcoming" | "active" | "arrived" | "completed" | "skipped";
export type StrollJourneyState = "not_started" | "active" | "completed";

export type StrollJourneyProgress = {
  journeyState: StrollJourneyState;
  activeStopId: string | null;
  arrivedStopId: string | null;
  completedStopIds: string[];
  skippedStopIds: string[];
};

export const EMPTY_STROLL_JOURNEY_PROGRESS: StrollJourneyProgress = {
  journeyState: "not_started",
  activeStopId: null,
  arrivedStopId: null,
  completedStopIds: [],
  skippedStopIds: [],
};

export function getOrderedStrollStops(stroll: Pick<PersistentStrollDetail, "stops"> | null) {
  return [...(stroll?.stops ?? [])].sort((left, right) => left.sequence - right.sequence);
}

export function getNumberedMapStops(stops: PersistentStrollStop[]): StrollMapStop[] {
  return getOrderedStrollStops({ stops })
    .map((stop, index) => ({
      ...stop,
      markerNumber: index + 1,
      lat: typeof stop.latitude === "number" && Number.isFinite(stop.latitude) ? stop.latitude : Number.NaN,
      lng: typeof stop.longitude === "number" && Number.isFinite(stop.longitude) ? stop.longitude : Number.NaN,
    }))
    .filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lng));
}

export function getStrollRoutePath(mapStops: StrollMapStop[]) {
  return mapStops.map((stop) => ({ lat: stop.lat, lng: stop.lng }));
}

export function hasStoredRouteData(stops: PersistentStrollStop[]) {
  return stops.some((stop) => stop.routeDistanceMeters !== null || stop.routeDurationMinutes !== null);
}

export function selectStopById(stops: PersistentStrollStop[], stopId: string | null) {
  if (!stopId) return null;
  return getOrderedStrollStops({ stops }).find((stop) => stop.id === stopId) ?? null;
}

function uniqueExistingStopIds(stopIds: string[], stops: PersistentStrollStop[]) {
  const validIds = new Set(stops.map((stop) => stop.id));
  const seen = new Set<string>();
  return stopIds.filter((stopId) => {
    if (!validIds.has(stopId) || seen.has(stopId)) return false;
    seen.add(stopId);
    return true;
  });
}

export function normalizeStrollJourneyProgress(
  progress: Partial<StrollJourneyProgress> | null | undefined,
  stops: PersistentStrollStop[],
): StrollJourneyProgress {
  const orderedStops = getOrderedStrollStops({ stops });
  const completedStopIds = uniqueExistingStopIds(Array.isArray(progress?.completedStopIds) ? progress.completedStopIds : [], orderedStops);
  const skippedStopIds = uniqueExistingStopIds(Array.isArray(progress?.skippedStopIds) ? progress.skippedStopIds : [], orderedStops)
    .filter((stopId) => !completedStopIds.includes(stopId));
  const unavailableIds = new Set([...completedStopIds, ...skippedStopIds]);
  const firstAvailableStop = orderedStops.find((stop) => !unavailableIds.has(stop.id)) ?? null;
  const activeStopId = progress?.activeStopId && orderedStops.some((stop) => stop.id === progress.activeStopId)
    ? progress.activeStopId
    : firstAvailableStop?.id ?? null;
  const arrivedStopId = progress?.arrivedStopId === activeStopId ? progress.arrivedStopId : null;
  const allResolved = orderedStops.length > 0 && orderedStops.every((stop) => completedStopIds.includes(stop.id) || skippedStopIds.includes(stop.id));
  const journeyState: StrollJourneyState = allResolved
    ? "completed"
    : progress?.journeyState === "active" || arrivedStopId
      ? "active"
      : "not_started";

  return {
    journeyState,
    activeStopId: journeyState === "completed" ? null : activeStopId,
    arrivedStopId: journeyState === "completed" ? null : arrivedStopId,
    completedStopIds,
    skippedStopIds,
  };
}

export function buildInitialStrollJourneyProgress(stops: PersistentStrollStop[]): StrollJourneyProgress {
  return normalizeStrollJourneyProgress(EMPTY_STROLL_JOURNEY_PROGRESS, stops);
}

export function startStrollJourney(progress: StrollJourneyProgress, stops: PersistentStrollStop[]) {
  const normalized = normalizeStrollJourneyProgress(progress, stops);
  if (normalized.journeyState === "completed") return normalized;
  return {
    ...normalized,
    journeyState: "active" as const,
    activeStopId: normalized.activeStopId ?? getOrderedStrollStops({ stops })[0]?.id ?? null,
    arrivedStopId: null,
  };
}

export function markStrollStopArrived(progress: StrollJourneyProgress, stops: PersistentStrollStop[]) {
  const active = startStrollJourney(progress, stops);
  return {
    ...active,
    arrivedStopId: active.activeStopId,
  };
}

export function completeActiveStrollStop(progress: StrollJourneyProgress, stops: PersistentStrollStop[]) {
  const active = startStrollJourney(progress, stops);
  if (!active.activeStopId) return active;
  const completedStopIds = uniqueExistingStopIds([...active.completedStopIds, active.activeStopId], stops);
  const skippedStopIds = active.skippedStopIds.filter((stopId) => stopId !== active.activeStopId);
  const nextProgress = normalizeStrollJourneyProgress({
    journeyState: "active",
    activeStopId: null,
    arrivedStopId: null,
    completedStopIds,
    skippedStopIds,
  }, stops);
  return nextProgress;
}

export function skipActiveStrollStop(progress: StrollJourneyProgress, stops: PersistentStrollStop[]) {
  const active = startStrollJourney(progress, stops);
  if (!active.activeStopId) return active;
  const skippedStopIds = uniqueExistingStopIds([...active.skippedStopIds, active.activeStopId], stops);
  const completedStopIds = active.completedStopIds.filter((stopId) => stopId !== active.activeStopId);
  return normalizeStrollJourneyProgress({
    journeyState: "active",
    activeStopId: null,
    arrivedStopId: null,
    completedStopIds,
    skippedStopIds,
  }, stops);
}

export function getStrollStopStatus(progress: StrollJourneyProgress, stopId: string): StrollStopStatus {
  if (progress.completedStopIds.includes(stopId)) return "completed";
  if (progress.skippedStopIds.includes(stopId)) return "skipped";
  if (progress.arrivedStopId === stopId) return "arrived";
  if (progress.activeStopId === stopId) return "active";
  return "upcoming";
}

export function getActiveStrollStop(stops: PersistentStrollStop[], progress: StrollJourneyProgress) {
  return selectStopById(stops, progress.activeStopId) ?? getOrderedStrollStops({ stops })[0] ?? null;
}

export function getStrollProgressLabel(progress: StrollJourneyProgress, stops: PersistentStrollStop[]) {
  const orderedStops = getOrderedStrollStops({ stops });
  if (!orderedStops.length) return "No stops yet";
  if (progress.journeyState === "completed") return `${orderedStops.length} of ${orderedStops.length} stops complete`;
  const activeIndex = orderedStops.findIndex((stop) => stop.id === progress.activeStopId);
  return `Stop ${activeIndex >= 0 ? activeIndex + 1 : 1} of ${orderedStops.length}`;
}

export function buildStrollJourneyStorageKey(userId: string | null | undefined, strollId: string) {
  return `wandreel:stroll-journey:${userId?.trim() || "anonymous"}:${strollId}`;
}

export function buildStrollStopDirectionsUrl(stop: Pick<PersistentStrollStop, "placeTitle" | "placeLocality" | "placeAddress" | "latitude" | "longitude">) {
  if (typeof stop.latitude === "number" && typeof stop.longitude === "number") {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${stop.latitude},${stop.longitude}`)}`;
  }
  const query = stop.placeAddress?.trim() || [stop.placeTitle, stop.placeLocality].filter(Boolean).join(" ").trim();
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

export function hasValidReelUrl(stop: Pick<PersistentStrollStop, "placeVideoUrl">) {
  if (!stop.placeVideoUrl) return false;
  try {
    const url = new URL(stop.placeVideoUrl);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function getStrollMapFallbackReason(input: {
  hasMapsKey: boolean;
  isMapLoaded: boolean;
  hasMapLoadError: boolean;
  mapStopCount: number;
}) {
  if (!input.hasMapsKey) return "missing_key";
  if (input.hasMapLoadError) return "load_error";
  if (!input.isMapLoaded) return "loading";
  if (input.mapStopCount === 0) return "missing_coordinates";
  return null;
}

export function getStrollMapGestureHandling(prefersReducedMotion: boolean) {
  return prefersReducedMotion ? "cooperative" : "greedy";
}

export function getNextStrollJourneyPhase(
  currentPhase: StrollJourneyPhase,
  options: { prefersReducedMotion?: boolean; isInterrupted?: boolean } = {},
) {
  if (options.prefersReducedMotion || options.isInterrupted) return "controlled";

  switch (currentPhase) {
    case "idle":
      return "opening";
    case "opening":
      return "walking";
    case "walking":
      return "wakingMarkers";
    case "wakingMarkers":
      return "completing";
    case "completing":
      return "handoff";
    case "handoff":
      return "controlled";
    default:
      return "controlled";
  }
}

export function formatStopDuration(minutes: number | null) {
  if (!minutes) return null;
  return `${minutes} min`;
}

export function formatRouteDistance(meters: number | null) {
  if (!meters) return null;
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km from previous`;
  return `${meters} m from previous`;
}

export function formatRouteDistanceShort(meters: number | null) {
  if (!meters) return null;
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

export function formatRouteDuration(minutes: number | null) {
  if (!minutes) return null;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
  }
  return `${minutes} min`;
}

export function formatDisplayVenueName(value: string | null | undefined, fallback = "This stop") {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  const hasWhitespace = /\s/.test(trimmed);
  const hasMixedOrUpper = /[A-Z]/.test(trimmed.slice(1));
  if (hasWhitespace || hasMixedOrUpper) return trimmed;
  return trimmed
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function buildStrollHeaderTitle(stroll: Pick<PersistentStrollDetail, "city" | "name"> | null) {
  const city = stroll?.city?.trim();
  return city ? `Stroll in ${city}` : buildStrollContextLabel(stroll);
}

export function buildStrollHeaderMeta(stroll: Pick<PersistentStrollDetail, "startDate" | "stopCount" | "totalDistanceMeters" | "stops"> | null) {
  if (!stroll) return "";
  const items: string[] = [];
  items.push("Today");
  const stopCount = stroll.stopCount || getOrderedStrollStops(stroll).length;
  if (stopCount) items.push(`${stopCount} ${stopCount === 1 ? "stop" : "stops"}`);
  const distance = formatRouteDistanceShort(stroll.totalDistanceMeters);
  if (distance) items.push(distance);
  return items.join(" • ");
}

export function buildJourneyWhyItems(stroll: Pick<PersistentStrollDetail, "interests" | "city" | "stops" | "totalDistanceMeters"> | null) {
  if (!stroll) return [];
  const orderedStops = getOrderedStrollStops(stroll);
  const items: string[] = [];
  const firstInterest = stroll.interests?.find((interest) => interest.trim());
  if (firstInterest) items.push(`Built around your ${firstInterest} interest`);
  const firstLocality = orderedStops[0]?.placeLocality?.trim() || stroll.city?.trim();
  if (firstLocality) items.push(`Starts near ${firstLocality}`);
  if (stroll.totalDistanceMeters) items.push("Keeps travel manageable");
  const categories = Array.from(new Set(orderedStops.map((stop) => stop.placeCategory?.trim()).filter(Boolean))).slice(0, 3);
  if (categories.length) items.push(`Mixes ${categories.join(", ").toLowerCase()}`);
  return items.slice(0, 4);
}

function pickFirstSentence(text: string | null | undefined) {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/.+?[.!?](?:\s|$)/);
  return (match?.[0] || trimmed).trim();
}

function titleFromStop(stop: Pick<PersistentStrollStop, "placeTitle" | "placeId"> | null | undefined) {
  return stop?.placeTitle || stop?.placeId || "Your first stop";
}

export function buildStrollContextLabel(stroll: Pick<PersistentStrollDetail, "name"> | null) {
  return stroll?.name?.trim() || "Today's Stroll";
}

export function buildFirstStopTitle(stop: Pick<PersistentStrollStop, "placeTitle" | "placeId"> | null | undefined) {
  return titleFromStop(stop);
}

export function buildFirstStopLocality(
  stop: Pick<PersistentStrollStop, "placeLocality" | "placeAddress"> | null | undefined,
  stroll: Pick<PersistentStrollDetail, "city"> | null,
) {
  return stop?.placeLocality?.trim() || stop?.placeAddress?.trim() || stroll?.city?.trim() || "Ready when you are";
}

export function buildFirstStopDescription(stop: Pick<PersistentStrollStop, "generatedDescription" | "placeDescription"> | null | undefined) {
  const candidate = pickFirstSentence(stop?.generatedDescription) || pickFirstSentence(stop?.placeDescription);
  if (candidate && !/\b(metadata|usable location data|unknown suitability)\b/i.test(candidate)) {
    return candidate;
  }
  return "A calm first stop to settle into the day.";
}

export function buildFirstStopReason(stop: Pick<PersistentStrollStop, "reason"> | null | undefined) {
  return pickFirstSentence(stop?.reason) || "Start here to find the shape of the day before the rest of the journey unfolds.";
}

export function buildJourneyPreviewStops(stroll: Pick<PersistentStrollDetail, "stops"> | null) {
  return getOrderedStrollStops(stroll).map((stop) => titleFromStop(stop));
}

export function buildJourneySummaryItems(
  stroll: Pick<PersistentStrollDetail, "stopCount" | "totalDistanceMeters" | "requestedStartTime" | "stops"> | null,
) {
  if (!stroll) return [];

  const items: string[] = [];
  const stopCount = stroll.stopCount || getOrderedStrollStops(stroll).length;
  if (stopCount > 0) {
    items.push(`${stopCount} ${stopCount === 1 ? "Stop" : "Stops"}`);
  }

  if (typeof stroll.totalDistanceMeters === "number" && Number.isFinite(stroll.totalDistanceMeters) && stroll.totalDistanceMeters > 0) {
    items.push(stroll.totalDistanceMeters >= 1000 ? `${(stroll.totalDistanceMeters / 1000).toFixed(1)} km` : `${Math.round(stroll.totalDistanceMeters)} m`);
  }

  const rawTime = stroll.requestedStartTime?.trim() || getOrderedStrollStops(stroll)[0]?.arrivalEstimate?.trim() || null;
  if (rawTime) {
    const parsed = rawTime.match(/(\d{1,2}):(\d{2})/);
    if (parsed) {
      const hours = Number(parsed[1]);
      const minutes = parsed[2];
      if (Number.isFinite(hours) && hours >= 0 && hours <= 23) {
        const period = hours >= 12 ? "PM" : "AM";
        const normalizedHour = hours % 12 || 12;
        items.push(`Around ${normalizedHour}:${minutes} ${period}`);
      }
    }
  }

  return items;
}

export function buildWhyThisJourney(stroll: Pick<PersistentStrollDetail, "description" | "stops"> | null) {
  return (
    pickFirstSentence(stroll?.description) ||
    pickFirstSentence(getOrderedStrollStops(stroll)[0]?.reason) ||
    "This route begins gently and lets the rest of the day unfold from there."
  );
}

export function buildStopRowSupportingText(
  stop: Pick<PersistentStrollStop, "placeAddress" | "placeLocality" | "placeId">,
  index: number,
) {
  const base = stop.placeAddress || stop.placeLocality || stop.placeId;
  if (!base) return index === 0 ? "Begin here" : "";
  return index === 0 ? `Begin here - ${base}` : base;
}
