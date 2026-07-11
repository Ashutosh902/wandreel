import type { PersistentStrollDetail, PersistentStrollStop } from "./strollLibrary";

export type StrollMapStop = PersistentStrollStop & {
  markerNumber: number;
  lat: number;
  lng: number;
};

export type StrollDetailLoadState = "loading" | "ready" | "error";

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

export function formatStopDuration(minutes: number | null) {
  if (!minutes) return null;
  return `${minutes} min`;
}

export function formatRouteDistance(meters: number | null) {
  if (!meters) return null;
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km from previous`;
  return `${meters} m from previous`;
}
