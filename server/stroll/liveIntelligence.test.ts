import assert from "node:assert/strict";
import test from "node:test";
import {
  StrollLiveIntelligenceService,
  createOpenMeteoWeatherProvider,
  rejectExpiredConditions,
  type LiveCondition,
  type LiveConditionProvider,
} from "./liveIntelligence";
import type { StrollDetail } from "./types";

function stroll(overrides: Partial<StrollDetail> = {}): StrollDetail {
  return {
    id: "stroll-1",
    name: "Patna Stroll",
    description: null,
    city: "Patna",
    status: "ready",
    source: "manual",
    startDate: null,
    endDate: null,
    requestedStartTime: null,
    travellerCount: null,
    interests: [],
    latitude: null,
    longitude: null,
    totalDistanceMeters: null,
    estimatedDurationMinutes: null,
    stopCount: 1,
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:00:00.000Z",
    curatedAt: "2026-07-11T10:00:00.000Z",
    archivedAt: null,
    stops: [
      {
        id: "stop-1",
        placeId: "place-1",
        placeTitle: "Golghar",
        placeCategory: "Explore",
        placeLocality: "Patna",
        placeAddress: "Golghar, Patna",
        placeDescription: null,
        placeImageUrl: null,
        placeVideoUrl: null,
        latitude: 25.612,
        longitude: 85.143,
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
      },
    ],
    ...overrides,
  };
}

function condition(overrides: Partial<LiveCondition> = {}): LiveCondition {
  return {
    id: "condition-1",
    provider: "unit_weather",
    conditionType: "weather",
    severity: "moderate",
    confidence: 0.8,
    sourceTimestamp: "2026-07-11T10:00:00.000Z",
    fetchedTimestamp: "2026-07-11T10:00:00.000Z",
    expiryTimestamp: "2026-07-11T10:30:00.000Z",
    message: "Rain is reported near this Stroll.",
    payload: { weatherCode: 61 },
    ...overrides,
  };
}

function provider(status: "success" | "failed" | "unavailable", conditions: LiveCondition[] = []): LiveConditionProvider {
  return {
    name: "unit_weather",
    conditionType: "weather",
    fetch: async (_stroll, now) => ({
      provider: "unit_weather",
      conditionType: "weather",
      status,
      fetchedTimestamp: now.toISOString(),
      expiryTimestamp: status === "success" ? new Date(now.getTime() + 600_000).toISOString() : null,
      conditions,
      errorCode: status === "success" ? undefined : "provider_unavailable",
      errorMessage: status === "success" ? undefined : "Provider unavailable.",
    }),
  };
}

test("Open-Meteo provider returns structured weather conditions on verified alert data", async () => {
  const calls: string[] = [];
  const fetcher = async (url: string | URL | Request) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        current: {
          time: "2026-07-11T10:00",
          weather_code: 95,
          precipitation: 3,
          wind_speed_10m: 12,
          wind_gusts_10m: 18,
        },
      }),
    } as Response;
  };
  const result = await createOpenMeteoWeatherProvider(fetcher).fetch(stroll(), new Date("2026-07-11T10:05:00.000Z"));

  assert.equal(result.status, "success");
  assert.equal(result.provider, "open_meteo");
  assert.equal(result.conditions.length, 2);
  assert.equal(result.conditions[0]?.conditionType, "weather");
  assert.equal(result.conditions[0]?.severity, "critical");
  assert.match(calls[0] || "", /api\.open-meteo\.com/);
});

test("provider failures produce unavailable live response without throwing", async () => {
  const service = new StrollLiveIntelligenceService({ providers: [provider("failed")], ttlMs: 1_000 });
  const response = await service.getLiveConditions(stroll(), new Date("2026-07-11T10:00:00.000Z"));

  assert.equal(response.status, "unavailable");
  assert.deepEqual(response.conditions, []);
  assert.equal(response.providers[0]?.status, "failed");
});

test("live condition cache reuses provider results until short TTL expires", async () => {
  let calls = 0;
  const service = new StrollLiveIntelligenceService({
    ttlMs: 60_000,
    providers: [{
      name: "unit_weather",
      conditionType: "weather",
      fetch: async (_stroll, now) => {
        calls += 1;
        return provider("success", [condition({ id: `condition-${calls}` })]).fetch(stroll(), now);
      },
    }],
  });

  const first = await service.getLiveConditions(stroll(), new Date("2026-07-11T10:00:00.000Z"));
  const second = await service.getLiveConditions(stroll(), new Date("2026-07-11T10:00:10.000Z"));

  assert.equal(calls, 1);
  assert.equal(first.conditions[0]?.id, second.conditions[0]?.id);
});

test("expired cached conditions are not returned as current", async () => {
  const service = new StrollLiveIntelligenceService({
    ttlMs: 60_000,
    providers: [provider("success", [condition({ expiryTimestamp: "2026-07-11T10:00:05.000Z" })])],
  });

  const fresh = await service.getLiveConditions(stroll(), new Date("2026-07-11T10:00:00.000Z"));
  const stale = await service.getLiveConditions(stroll(), new Date("2026-07-11T10:00:10.000Z"));

  assert.equal(fresh.conditions.length, 1);
  assert.equal(stale.conditions.length, 0);
  assert.deepEqual(rejectExpiredConditions(fresh.conditions, new Date("2026-07-11T10:00:10.000Z")), []);
});

test("provider success with no alerts returns no-alert response without all-clear condition", async () => {
  const fetcher = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      current: {
        time: "2026-07-11T10:00",
        weather_code: 1,
        precipitation: 0,
        wind_speed_10m: 4,
      },
    }),
  }) as Response;
  const service = new StrollLiveIntelligenceService({ providers: [createOpenMeteoWeatherProvider(fetcher)] });
  const response = await service.getLiveConditions(stroll(), new Date("2026-07-11T10:05:00.000Z"));

  assert.equal(response.status, "available");
  assert.deepEqual(response.conditions, []);
  assert.equal(response.providers[0]?.status, "success");
});

test("weather provider is unavailable when no coordinates are stored", async () => {
  const result = await createOpenMeteoWeatherProvider(async () => {
    throw new Error("fetch should not run");
  }).fetch(stroll({ latitude: null, longitude: null, stops: [] }), new Date("2026-07-11T10:00:00.000Z"));

  assert.equal(result.status, "unavailable");
  assert.equal(result.errorCode, "missing_coordinates");
  assert.deepEqual(result.conditions, []);
});
