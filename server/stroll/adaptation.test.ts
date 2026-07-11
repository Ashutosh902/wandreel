import assert from "node:assert/strict";
import test from "node:test";
import { recommendStrollAdaptation } from "./adaptation";
import type { StrollDetail, StrollStop } from "./types";
import type { StrollLiveConditionsResponse } from "./liveIntelligence";

function stop(overrides: Partial<StrollStop>): StrollStop {
  return {
    id: "stop-1",
    placeId: "place-1",
    placeTitle: "Outdoor Garden",
    placeCategory: "Explore",
    placeLocality: "Patna",
    placeAddress: "Patna",
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
    suitability: { weather: "outdoor", openingHours: null, notes: [] },
    ...overrides,
  };
}

function stroll(stops: StrollStop[]): StrollDetail {
  return {
    id: "stroll-1",
    name: "Patna Stroll",
    description: null,
    city: "Patna",
    status: "ready",
    source: "manual",
    startDate: null,
    endDate: null,
    requestedStartTime: "10:30",
    travellerCount: null,
    interests: [],
    latitude: null,
    longitude: null,
    totalDistanceMeters: null,
    estimatedDurationMinutes: null,
    stopCount: stops.length,
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-07-11T09:00:00.000Z",
    updatedAt: "2026-07-11T09:00:00.000Z",
    curatedAt: "2026-07-11T09:00:00.000Z",
    archivedAt: null,
    stops,
  };
}

function live(overrides: Partial<StrollLiveConditionsResponse> = {}): StrollLiveConditionsResponse {
  return {
    strollId: "stroll-1",
    status: "available",
    fetchedTimestamp: "2026-07-11T10:00:00.000Z",
    expiryTimestamp: "2026-07-11T10:30:00.000Z",
    conditions: [{
      id: "weather-1",
      provider: "open_meteo",
      conditionType: "weather",
      severity: "high",
      confidence: null,
      sourceTimestamp: "2026-07-11T10:00:00.000Z",
      fetchedTimestamp: "2026-07-11T10:00:00.000Z",
      expiryTimestamp: "2026-07-11T10:30:00.000Z",
      message: "Rain showers are reported near this Stroll.",
      payload: { weatherCode: 80 },
    }],
    providers: [],
    ...overrides,
  };
}

test("recommendStrollAdaptation proposes sheltered stops before outdoor stops using verified weather", () => {
  const originalStops = [
    stop({ id: "outdoor", placeId: "place-outdoor", placeTitle: "Garden", sequence: 1, suitability: { weather: "outdoor", openingHours: null, notes: [] } }),
    stop({ id: "indoor", placeId: "place-indoor", placeTitle: "Museum", sequence: 2, suitability: { weather: "indoor", openingHours: { open: true }, notes: [] } }),
  ];
  const recommendation = recommendStrollAdaptation(stroll(originalStops), {
    now: new Date("2026-07-11T10:05:00.000Z"),
    liveConditions: live(),
    currentLocation: { latitude: 25.6, longitude: 85.1 },
  });

  assert.equal(recommendation.status, "recommended");
  assert.deepEqual(recommendation.originalStopIds, ["outdoor", "indoor"]);
  assert.deepEqual(recommendation.proposedStopIds, ["indoor", "outdoor"]);
  assert.equal(originalStops[0]?.sequence, 1);
  assert.equal(recommendation.evidence.some((item) => item.type === "live_condition"), true);
  assert.equal(recommendation.evidence.some((item) => item.type === "current_location"), true);
});

test("recommendStrollAdaptation falls back when no reliable recommendation is available", () => {
  const recommendation = recommendStrollAdaptation(stroll([
    stop({ id: "one", sequence: 1, suitability: { weather: "unknown", openingHours: null, notes: [] } }),
    stop({ id: "two", sequence: 2, suitability: { weather: "unknown", openingHours: null, notes: [] } }),
  ]), {
    now: new Date("2026-07-11T10:05:00.000Z"),
    liveConditions: live({ conditions: [] }),
  });

  assert.equal(recommendation.status, "none");
  assert.match(recommendation.reason, /no current verified weather alerts/i);
});

test("recommendStrollAdaptation rejects stale or unavailable live inputs", () => {
  const baseStroll = stroll([
    stop({ id: "outdoor", sequence: 1, suitability: { weather: "outdoor", openingHours: null, notes: [] } }),
    stop({ id: "indoor", sequence: 2, suitability: { weather: "indoor", openingHours: null, notes: [] } }),
  ]);
  const stale = recommendStrollAdaptation(baseStroll, {
    now: new Date("2026-07-11T11:05:00.000Z"),
    liveConditions: live(),
  });
  const unavailable = recommendStrollAdaptation(baseStroll, {
    now: new Date("2026-07-11T10:05:00.000Z"),
    liveConditions: live({ status: "unavailable", conditions: [] }),
  });

  assert.equal(stale.status, "none");
  assert.equal(unavailable.status, "none");
  assert.match(unavailable.reason, /live inputs are unavailable/i);
});
