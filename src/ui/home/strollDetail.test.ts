/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFirstStopDescription,
  buildFirstStopLocality,
  buildFirstStopReason,
  buildFirstStopTitle,
  buildInitialStrollJourneyProgress,
  buildJourneyPreviewStops,
  buildJourneySummaryItems,
  buildJourneyWhyItems,
  buildStrollHeaderMeta,
  buildStrollHeaderTitle,
  buildStrollJourneyStorageKey,
  buildStopRowSupportingText,
  buildStrollContextLabel,
  buildStrollStopDirectionsUrl,
  buildWhyThisJourney,
  completeActiveStrollStop,
  formatDisplayVenueName,
  formatRouteDistanceShort,
  formatRouteDuration,
  formatRouteDistance,
  formatStopDuration,
  getActiveStrollStop,
  getNumberedMapStops,
  getNextStrollJourneyPhase,
  getOrderedStrollStops,
  getStrollProgressLabel,
  getStrollStopStatus,
  getStrollMapFallbackReason,
  getStrollMapGestureHandling,
  getStrollRoutePath,
  hasStoredRouteData,
  hasValidReelUrl,
  markStrollStopArrived,
  normalizeStrollJourneyProgress,
  selectStopById,
  skipActiveStrollStop,
  startStrollJourney,
  type StrollJourneyPhase,
} from "./strollDetail";
import {
  buildJourneyFootprints,
  buildJourneyRevealedPath,
  buildJourneyRoutePoints,
  createJourneyMotionController,
  shouldStartJourneyMotion,
  type JourneyMotionSnapshot,
} from "./journeyMotion";
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

test("journey phase progression reaches handoff and respects interruption", () => {
  let phase: StrollJourneyPhase = "idle";

  phase = getNextStrollJourneyPhase(phase);
  assert.equal(phase, "opening");
  phase = getNextStrollJourneyPhase(phase);
  assert.equal(phase, "walking");
  phase = getNextStrollJourneyPhase(phase);
  assert.equal(phase, "wakingMarkers");
  phase = getNextStrollJourneyPhase(phase);
  assert.equal(phase, "completing");
  phase = getNextStrollJourneyPhase(phase);
  assert.equal(phase, "handoff");
  phase = getNextStrollJourneyPhase(phase);
  assert.equal(phase, "controlled");

  assert.equal(getNextStrollJourneyPhase("walking", { prefersReducedMotion: true }), "controlled");
  assert.equal(getNextStrollJourneyPhase("opening", { isInterrupted: true }), "controlled");
});

test("journey footprints stay minimal and calm", () => {
  const footprints = buildJourneyFootprints(
    [{ lat: 25.6, lng: 85.1 }, { lat: 25.61, lng: 85.11 }, { lat: 25.62, lng: 85.12 }, { lat: 25.63, lng: 85.13 }],
    { lat: 25.59, lng: 85.09 },
  );

  assert.equal(footprints.length, 5);
  assert.ok(footprints.every((footprint) => footprint.opacity <= 0.54));
  assert.ok(footprints.every((footprint) => footprint.scale <= 0.9));
  assert.ok(Math.abs(footprints[0].point.lat - 25.598) < 0.000001);
  assert.ok(Math.abs(footprints[0].point.lng - 85.098) < 0.000001);
});

test("journey route reveal starts at current location and progressively reaches stops", () => {
  const route = buildJourneyRoutePoints(
    [{ lat: 25.6, lng: 85.1 }, { lat: 25.7, lng: 85.2 }, { lat: 25.8, lng: 85.3 }],
    { lat: 25.5, lng: 85 },
  );

  assert.deepEqual(route[0], { lat: 25.5, lng: 85 });
  assert.deepEqual(buildJourneyRevealedPath(route, 0), [route[0]]);
  assert.equal(buildJourneyRevealedPath(route, 0.5).length, 3);
  assert.deepEqual(buildJourneyRevealedPath(route, 1), route);
});

test("journey controller wakes markers and hands off after the full route", () => {
  const snapshots: JourneyMotionSnapshot[] = [];
  const scheduled: Array<{ callback: () => void }> = [];
  const controller = createJourneyMotionController({
    routeStopIds: ["first", "second"],
    currentLocationExists: true,
    prefersReducedMotion: false,
    isEnabled: true,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    schedule: (callback) => {
      scheduled.push({ callback });
      return scheduled.length;
    },
    clearSchedule: () => undefined,
  });

  controller.begin();
  while (scheduled.length) {
    scheduled.shift()?.callback();
  }

  assert.ok(snapshots.some((snapshot) => snapshot.phase === "current-location-pulse"));
  assert.ok(snapshots.some((snapshot) => snapshot.phase === "marker-wake" && snapshot.wakeStopId === "first"));
  assert.ok(snapshots.some((snapshot) => snapshot.phase === "marker-wake" && snapshot.wakeStopId === "second"));
  assert.equal(snapshots.at(-1)?.phase, "completed");
  assert.equal(snapshots.at(-1)?.routeRevealProgress, 1);
});

test("journey controller interrupts into a usable full route", () => {
  const snapshots: JourneyMotionSnapshot[] = [];
  const controller = createJourneyMotionController({
    routeStopIds: ["first", "second"],
    currentLocationExists: true,
    prefersReducedMotion: false,
    isEnabled: true,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    schedule: () => 1,
    clearSchedule: () => undefined,
  });

  controller.begin();
  controller.interrupt();

  assert.equal(snapshots.at(-1)?.phase, "interrupted");
  assert.equal(snapshots.at(-1)?.routeRevealProgress, 1);
});

test("journey controller skips animation for reduced motion", () => {
  const snapshots: JourneyMotionSnapshot[] = [];
  const controller = createJourneyMotionController({
    routeStopIds: ["first", "second"],
    currentLocationExists: true,
    prefersReducedMotion: true,
    isEnabled: true,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
  });

  controller.begin();

  assert.deepEqual(snapshots.at(-1), {
    phase: "completed",
    routeRevealProgress: 1,
    activeFootprintIndex: 0,
    wakeStopId: null,
  });
});

test("journey motion starts once per session and stays suppressed after interruption", () => {
  assert.equal(
    shouldStartJourneyMotion({
      loadState: "ready",
      hasUserInteracted: false,
      hasStartedJourney: false,
      allowInitialMotionStart: true,
      prefersReducedMotion: false,
      isEnabled: true,
      fallbackReason: null,
      routePointCount: 3,
    }),
    true,
  );

  assert.equal(
    shouldStartJourneyMotion({
      loadState: "ready",
      hasUserInteracted: true,
      hasStartedJourney: false,
      allowInitialMotionStart: true,
      prefersReducedMotion: false,
      isEnabled: true,
      fallbackReason: null,
      routePointCount: 3,
    }),
    false,
  );

  assert.equal(
    shouldStartJourneyMotion({
      loadState: "ready",
      hasUserInteracted: false,
      hasStartedJourney: true,
      allowInitialMotionStart: true,
      prefersReducedMotion: false,
      isEnabled: true,
      fallbackReason: null,
      routePointCount: 3,
    }),
    false,
  );

  assert.equal(
    shouldStartJourneyMotion({
      loadState: "loading",
      hasUserInteracted: false,
      hasStartedJourney: false,
      allowInitialMotionStart: true,
      prefersReducedMotion: false,
      isEnabled: true,
      fallbackReason: null,
      routePointCount: 3,
    }),
    false,
  );

  assert.equal(
    shouldStartJourneyMotion({
      loadState: "ready",
      hasUserInteracted: false,
      hasStartedJourney: false,
      allowInitialMotionStart: false,
      prefersReducedMotion: false,
      isEnabled: true,
      fallbackReason: null,
      routePointCount: 3,
    }),
    false,
  );
});

test("stop meta formatters hide missing data", () => {
  assert.equal(formatStopDuration(45), "45 min");
  assert.equal(formatStopDuration(null), null);
  assert.equal(formatRouteDistance(1250), "1.3 km from previous");
  assert.equal(formatRouteDistance(null), null);
});

test("guided journey helpers center the place and first step", () => {
  const stroll = {
    name: "Patna Weekend Stroll",
    city: "Patna",
    description: "A calm city route that opens with Patna's broadest landmark view.",
    totalDistanceMeters: 2800,
    requestedStartTime: "09:30:00",
    stopCount: 2,
    stops: [
      stop({
        id: "one",
        sequence: 1,
        placeTitle: "Golghar",
        placeLocality: "Old City, Patna",
        generatedDescription: "Open views, slow steps, and an easy way to arrive in the day.",
        reason: "Start here for the widest sense of the city before the route pulls you inward.",
      }),
      stop({ id: "two", sequence: 2, placeTitle: "Gandhi Maidan" }),
    ],
  };

  assert.equal(buildStrollContextLabel(stroll), "Patna Weekend Stroll");
  assert.equal(buildFirstStopTitle(stroll.stops[0]), "Golghar");
  assert.equal(buildFirstStopLocality(stroll.stops[0], stroll), "Old City, Patna");
  assert.equal(buildFirstStopDescription(stroll.stops[0]), "Open views, slow steps, and an easy way to arrive in the day.");
  assert.equal(
    buildFirstStopDescription(stop({ generatedDescription: null, placeDescription: "A landmark stop from saved place metadata." })),
    "A calm first stop to settle into the day.",
  );
  assert.equal(buildFirstStopReason(stroll.stops[0]), "Start here for the widest sense of the city before the route pulls you inward.");
  assert.deepEqual(buildJourneyPreviewStops(stroll), ["Golghar", "Gandhi Maidan"]);
  assert.deepEqual(buildJourneySummaryItems(stroll), ["2 Stops", "2.8 km", "Around 9:30 AM"]);
  assert.equal(buildWhyThisJourney(stroll), "A calm city route that opens with Patna's broadest landmark view.");
});

test("first stop support copy gently marks the beginning of the route", () => {
  assert.equal(
    buildStopRowSupportingText({ placeAddress: "Golghar, Patna", placeLocality: "Patna", placeId: "place-1" }, 0),
    "Begin here - Golghar, Patna",
  );
  assert.equal(
    buildStopRowSupportingText({ placeAddress: "Gandhi Maidan, Patna", placeLocality: "Patna", placeId: "place-2" }, 1),
    "Gandhi Maidan, Patna",
  );
});

test("journey progress starts, arrives, completes, skips, and preserves active stop separately", () => {
  const stops = [
    stop({ id: "one", sequence: 1 }),
    stop({ id: "two", sequence: 2 }),
    stop({ id: "three", sequence: 3 }),
  ];
  const initial = buildInitialStrollJourneyProgress(stops);

  assert.equal(initial.journeyState, "not_started");
  assert.equal(initial.activeStopId, "one");
  assert.equal(getStrollProgressLabel(initial, stops), "Stop 1 of 3");
  assert.equal(getStrollStopStatus(initial, "one"), "active");

  const started = startStrollJourney(initial, stops);
  assert.equal(started.journeyState, "active");
  assert.equal(started.activeStopId, "one");

  const arrived = markStrollStopArrived(started, stops);
  assert.equal(arrived.arrivedStopId, "one");
  assert.equal(getStrollStopStatus(arrived, "one"), "arrived");

  const afterComplete = completeActiveStrollStop(arrived, stops);
  assert.deepEqual(afterComplete.completedStopIds, ["one"]);
  assert.equal(afterComplete.activeStopId, "two");
  assert.equal(getActiveStrollStop(stops, afterComplete)?.id, "two");

  const afterSkip = skipActiveStrollStop(afterComplete, stops);
  assert.deepEqual(afterSkip.completedStopIds, ["one"]);
  assert.deepEqual(afterSkip.skippedStopIds, ["two"]);
  assert.equal(afterSkip.activeStopId, "three");

  const finished = completeActiveStrollStop(afterSkip, stops);
  assert.equal(finished.journeyState, "completed");
  assert.equal(finished.activeStopId, null);
  assert.equal(getStrollProgressLabel(finished, stops), "3 of 3 stops complete");
});

test("journey progress normalization drops stale ids and scopes local persistence by user and stroll", () => {
  const stops = [stop({ id: "one", sequence: 1 }), stop({ id: "two", sequence: 2 })];
  const normalized = normalizeStrollJourneyProgress({
    journeyState: "active",
    activeStopId: "missing",
    arrivedStopId: "missing",
    completedStopIds: ["one", "one", "missing"],
    skippedStopIds: ["one", "two", "missing"],
  }, stops);

  assert.deepEqual(normalized.completedStopIds, ["one"]);
  assert.deepEqual(normalized.skippedStopIds, ["two"]);
  assert.equal(normalized.journeyState, "completed");
  assert.equal(buildStrollJourneyStorageKey("user-1", "stroll-1"), "wandreel:stroll-journey:user-1:stroll-1");
});

test("new journey display helpers produce compact user-facing copy", () => {
  const stroll = {
    name: "Patna Food Trail",
    city: "Patna",
    startDate: "2026-07-18",
    stopCount: 2,
    totalDistanceMeters: 2800,
    interests: ["Food"],
    stops: [
      stop({ id: "one", sequence: 1, placeTitle: "craftcoffeeindia", placeLocality: "Sri Krishna Puri", placeCategory: "Coffee" }),
      stop({ id: "two", sequence: 2, placeTitle: "Everest Momo", placeCategory: "Momos" }),
    ],
  };

  assert.equal(formatDisplayVenueName("craftcoffeeindia"), "Craftcoffeeindia");
  assert.equal(formatRouteDistanceShort(2800), "2.8 km");
  assert.equal(formatRouteDuration(140), "2 hr 20 min");
  assert.equal(buildStrollHeaderTitle(stroll), "Stroll in Patna");
  assert.equal(buildStrollHeaderMeta(stroll), "Today • 2 stops • 2.8 km");
  assert.deepEqual(buildJourneyWhyItems(stroll), [
    "Built around your Food interest",
    "Starts near Sri Krishna Puri",
    "Keeps travel manageable",
    "Mixes coffee, momos",
  ]);
});
