/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStrollStopDirectionsUrl,
  formatRouteDistance,
  formatStopDuration,
  getNumberedMapStops,
  getOrderedStrollStops,
  getStrollMapFallbackReason,
  getStrollMapGestureHandling,
  getStrollRoutePath,
  hasStoredRouteData,
  hasValidReelUrl,
  selectStopById,
} from "./strollDetail";
import type { PersistentStrollStop } from "./strollLibrary";

function stop(overrides: Partial<PersistentStrollStop>): PersistentStrollStop {
  return {
    id: "stop-1",
    placeId: "place-1",
    placeTitle: "Golghar",
    placeCategory: "Explore",
    placeLocality: "Patna",
    placeAddress: "Golghar, Patna",
    placeDescription: null,
    placeImageUrl: null,
    placeVideoUrl: null,
    latitude: null,
    longitude: null,
    sequence: 1,
    reason: null,
    generatedDescription: null,
    descriptionGenerationMeta: null,
    estimatedVisitDurationMinutes: null,
    arrivalEstimate: null,
    departureEstimate: null,
    routeDistanceMeters: null,
    routeDurationMinutes: null,
    suitability: { weather: "unknown", openingHours: null, notes: [] },
    ...overrides,
  };
}

test("getOrderedStrollStops sorts stops for textual list and markers", () => {
  const ordered = getOrderedStrollStops({ stops: [stop({ id: "two", sequence: 2 }), stop({ id: "one", sequence: 1 })] });

  assert.deepEqual(ordered.map((item) => item.id), ["one", "two"]);
});

test("getNumberedMapStops renders ordered marker numbers only for coordinate-backed stops", () => {
  const markers = getNumberedMapStops([
    stop({ id: "missing", sequence: 1 }),
    stop({ id: "mapped", sequence: 2, latitude: 25.6, longitude: 85.1 }),
  ]);

  assert.deepEqual(markers.map((item) => ({ id: item.id, markerNumber: item.markerNumber })), [
    { id: "mapped", markerNumber: 2 },
  ]);
});

test("marker and textual stop selection resolve the selected stop", () => {
  const stops = [stop({ id: "one", sequence: 1 }), stop({ id: "two", sequence: 2 })];

  assert.equal(selectStopById(stops, "two")?.sequence, 2);
  assert.equal(selectStopById(stops, "missing"), null);
});

test("directions visibility and URL generation prefer coordinates then address", () => {
  assert.equal(
    buildStrollStopDirectionsUrl(stop({ latitude: 25.6, longitude: 85.1 })),
    "https://www.google.com/maps/search/?api=1&query=25.6%2C85.1",
  );
  assert.equal(
    buildStrollStopDirectionsUrl(stop({ placeAddress: "Gandhi Maidan, Patna" })),
    "https://www.google.com/maps/search/?api=1&query=Gandhi%20Maidan%2C%20Patna",
  );
  assert.equal(buildStrollStopDirectionsUrl(stop({ placeTitle: null, placeLocality: null, placeAddress: null })), null);
});

test("reel action visibility requires a valid URL", () => {
  assert.equal(hasValidReelUrl(stop({ placeVideoUrl: "https://example.com/reel" })), true);
  assert.equal(hasValidReelUrl(stop({ placeVideoUrl: "javascript:alert(1)" })), false);
  assert.equal(hasValidReelUrl(stop({ placeVideoUrl: "" })), false);
});

test("route path and route-data classification use stored stop data", () => {
  const stops = [
    stop({ id: "one", sequence: 1, latitude: 25.6, longitude: 85.1 }),
    stop({ id: "two", sequence: 2, latitude: 25.7, longitude: 85.2, routeDistanceMeters: 1250 }),
  ];
  const markers = getNumberedMapStops(stops);

  assert.deepEqual(getStrollRoutePath(markers), [{ lat: 25.6, lng: 85.1 }, { lat: 25.7, lng: 85.2 }]);
  assert.equal(hasStoredRouteData(stops), true);
});

test("map-loading failure fallback reasons are explicit", () => {
  assert.equal(getStrollMapFallbackReason({ hasMapsKey: false, isMapLoaded: false, hasMapLoadError: false, mapStopCount: 1 }), "missing_key");
  assert.equal(getStrollMapFallbackReason({ hasMapsKey: true, isMapLoaded: false, hasMapLoadError: true, mapStopCount: 1 }), "load_error");
  assert.equal(getStrollMapFallbackReason({ hasMapsKey: true, isMapLoaded: false, hasMapLoadError: false, mapStopCount: 1 }), "loading");
  assert.equal(getStrollMapFallbackReason({ hasMapsKey: true, isMapLoaded: true, hasMapLoadError: false, mapStopCount: 0 }), "missing_coordinates");
  assert.equal(getStrollMapFallbackReason({ hasMapsKey: true, isMapLoaded: true, hasMapLoadError: false, mapStopCount: 1 }), null);
});

test("reduced-motion map behavior uses less aggressive gesture handling", () => {
  assert.equal(getStrollMapGestureHandling(true), "cooperative");
  assert.equal(getStrollMapGestureHandling(false), "greedy");
});

test("stop meta formatters hide missing data", () => {
  assert.equal(formatStopDuration(45), "45 min");
  assert.equal(formatStopDuration(null), null);
  assert.equal(formatRouteDistance(1250), "1.3 km from previous");
  assert.equal(formatRouteDistance(null), null);
});
