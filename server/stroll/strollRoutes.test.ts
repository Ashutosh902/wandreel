import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { __resetPostgresTestConfig, __setPostgresTestConfig, type PostgresDatabase } from "../auth/postgresAuth";
import { registerStrollRoutes } from "./routes";
import { clearRateLimitBuckets } from "./rateLimits";

type QueryCall = {
  sql: string;
  params: unknown[] | undefined;
};

function strollRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "stroll-1",
    name: "Patna Stroll",
    description: null,
    city: "Patna",
    status: "draft",
    source: "manual",
    start_date: "2026-07-12",
    end_date: "2026-07-12",
    requested_start_time: "10:30",
    traveller_count: 2,
    interests_json: ["Food"],
    latitude: 25.5941,
    longitude: 85.1376,
    total_distance_meters: null,
    estimated_duration_minutes: null,
    stop_count: 2,
    created_at: "2026-07-11T10:00:00.000Z",
    updated_at: "2026-07-11T10:00:00.000Z",
    curated_at: null,
    archived_at: null,
    ...overrides,
  };
}

function onboardingRow(decision = "accepted") {
  return {
    onboarding_decision: decision,
    onboarding_decision_at: "2026-07-11T10:00:00.000Z",
    default_traveller_count: 2,
    default_interests_json: ["Food"],
    default_start_time: "10:30",
    created_at: "2026-07-11T10:00:00.000Z",
    updated_at: "2026-07-11T10:00:00.000Z",
  };
}

function bookmarkRow() {
  return {
    id: "bookmark-1",
    card_key: "hero-1",
    hero_type: "city_category_insight",
    cta_action: "open_food_trail",
    title: "Food trail",
    subtitle: "Try this",
    metadata_json: { city: "Patna" },
    matching_place_ids_json: ["place-1"],
    created_at: "2026-07-11T10:00:00.000Z",
    updated_at: "2026-07-11T10:00:00.000Z",
  };
}

function createRouteDatabaseMock() {
  const calls: QueryCall[] = [];
  const clientCalls: QueryCall[] = [];
  let interactionShouldFail = false;
  const stopRows = [
    {
      id: "stop-1",
      place_id: "place-1",
      place_title: "Golghar",
      place_category: "Explore",
      place_metadata_json: {
        locality: "Patna",
        fullAddress: "Golghar, Patna",
        imageUrl: "https://example.com/golghar.jpg",
        videoUrl: "https://example.com/reel",
        lat: 25.612,
        lng: 85.143,
        weatherSuitability: "outdoor",
      },
      sequence: 1,
      reason: "Starts with a landmark.",
      generated_description: null,
      description_generation_meta_json: null,
      estimated_visit_duration_minutes: null,
      arrival_estimate: null,
      departure_estimate: null,
      route_distance_meters: null,
      route_duration_minutes: null,
      owned_place_id: "place-1",
    },
    {
      id: "stop-2",
      place_id: "place-2",
      place_title: "Cafe",
      place_category: "Taste",
      place_metadata_json: { weatherSuitability: "indoor" },
      sequence: 2,
      reason: null,
      generated_description: null,
      description_generation_meta_json: null,
      estimated_visit_duration_minutes: null,
      arrival_estimate: null,
      departure_estimate: null,
      route_distance_meters: null,
      route_duration_minutes: null,
      owned_place_id: "place-2",
    },
  ];

  const database = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (/from user_stroll_preferences/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/insert into user_stroll_preferences/i.test(sql)) return { rows: [onboardingRow()], rowCount: 1 };
      if (/user_id = \$1 and s\.client_request_id = \$2/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/from user_saved_places/i.test(sql) && /place_id = any/i.test(sql)) {
        const requested = Array.isArray(params?.[1]) ? params?.[1] as string[] : [];
        return {
          rows: requested.filter((placeId) => placeId !== "foreign-place").map((place_id) => ({ place_id })),
          rowCount: requested.filter((placeId) => placeId !== "foreign-place").length,
        };
      }
      if (/from strolls s/i.test(sql) && /order by s\.updated_at desc/i.test(sql)) {
        return { rows: [strollRow(), strollRow({ id: "stroll-archived", status: "archived" })], rowCount: 2 };
      }
      if (/from strolls s/i.test(sql) && /where s\.user_id = \$1 and s\.id = \$2/i.test(sql)) {
        return params?.[1] === "missing" ? { rows: [], rowCount: 0 } : { rows: [strollRow()], rowCount: 1 };
      }
      if (/from stroll_stops/i.test(sql)) {
        return {
          rows: [...stopRows].sort((a, b) => a.sequence - b.sequence),
          rowCount: 2,
        };
      }
      if (/insert into hero_bookmarks/i.test(sql)) return { rows: [bookmarkRow()], rowCount: 1 };
      if (/from hero_bookmarks/i.test(sql)) return { rows: [bookmarkRow()], rowCount: 1 };
      if (/update hero_bookmarks/i.test(sql)) return { rows: [], rowCount: 1 };
      if (/insert into hero_interactions/i.test(sql)) {
        if (interactionShouldFail) throw new Error("analytics insert unavailable");
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => {
        clientCalls.push({ sql, params });
        if (sql === "begin" || sql === "commit" || sql === "rollback") return { rows: [], rowCount: 0 };
        if (/insert into strolls/i.test(sql)) return { rows: [strollRow()], rowCount: 1 };
        if (/select ss\.id/i.test(sql)) {
          return String(params?.[1] ?? "") === "missing"
            ? { rows: [], rowCount: 0 }
            : { rows: [...stopRows].sort((a, b) => a.sequence - b.sequence), rowCount: stopRows.length };
        }
        if (/select id from strolls/i.test(sql)) {
          return String(params?.[1] ?? "") === "missing" ? { rows: [], rowCount: 0 } : { rows: [{ id: "stroll-1" }], rowCount: 1 };
        }
        if (/update stroll_stops/i.test(sql)) {
          const stopId = String(params?.[1] ?? "");
          const sequence = Number(params?.[2]);
          const stop = stopRows.find((item) => item.id === stopId);
          if (stop) stop.sequence = sequence;
          return { rows: [], rowCount: stop ? 1 : 0 };
        }
        if (/update strolls/i.test(sql)) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined,
    }),
  } as unknown as PostgresDatabase;

  return {
    calls,
    clientCalls,
    database,
    stopRows,
    failHeroInteractions: () => {
      interactionShouldFail = true;
    },
  };
}

function createApp(
  userId = "user-1",
  liveConditionsService?: Parameters<typeof registerStrollRoutes>[1]["liveConditionsService"],
  routeOptions: Partial<Parameters<typeof registerStrollRoutes>[1]> = {},
) {
  const app = express();
  app.use(express.json());
  registerStrollRoutes(app, {
    requireAuth: (req, _res, next) => {
      (req as express.Request & { authUser?: { userId: string } }).authUser = { userId };
      next();
    },
    liveConditionsService,
    ...routeOptions,
  });
  return app;
}

async function request(app: express.Express, path: string, init: RequestInit = {}) {
  const server = app.listen(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test.afterEach(() => {
  __resetPostgresTestConfig();
  clearRateLimitBuckets();
});

test("GET /api/stroll/onboarding returns unseen default without a row", async () => {
  const mock = createRouteDatabaseMock();
  __setPostgresTestConfig({ databaseOverride: mock.database, databaseUrlOverride: "postgres://unit-test" });

  const response = await request(createApp(), "/api/stroll/onboarding");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    onboarding: {
      decision: "unseen",
      decisionAt: null,
      defaultTravellerCount: null,
      defaultInterests: [],
      defaultStartTime: null,
      createdAt: null,
      updatedAt: null,
    },
  });
});

test("PATCH /api/stroll/onboarding upserts accepted decision", async () => {
  const mock = createRouteDatabaseMock();
  __setPostgresTestConfig({ databaseOverride: mock.database, databaseUrlOverride: "postgres://unit-test" });

  const response = await request(createApp(), "/api/stroll/onboarding", {
    method: "PATCH",
    body: JSON.stringify({ decision: "accepted", defaultTravellerCount: 2, defaultInterests: ["Food"] }),
  });

  assert.equal(response.status, 200);
  assert.equal((response.body.onboarding as Record<string, unknown>).decision, "accepted");
  assert.match(mock.calls[0]?.sql || "", /insert into user_stroll_preferences/i);
});

test("POST /api/strolls creates an idempotent draft with ordered stops", async () => {
  const mock = createRouteDatabaseMock();
  __setPostgresTestConfig({ databaseOverride: mock.database, databaseUrlOverride: "postgres://unit-test" });

  const response = await request(createApp(), "/api/strolls", {
    method: "POST",
    body: JSON.stringify({
      clientRequestId: "request-1",
      source: "manual",
      name: "Patna Stroll",
      city: "Patna",
      startDate: "2026-07-12",
      endDate: "2026-07-12",
      requestedStartTime: "10:30",
      travellerCount: 2,
      interests: ["Food", "Heritage"],
      latitude: 25.5941,
      longitude: 85.1376,
      placeIds: ["place-1", "place-2"],
    }),
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.created, true);
  assert.equal((response.body.stroll as Record<string, unknown>).status, "draft");
  assert.equal((response.body.stroll as Record<string, unknown>).stopCount, 2);
  assert.equal(mock.clientCalls.filter((call) => /insert into stroll_stops/i.test(call.sql)).length, 2);
});

test("POST /api/strolls rejects draft placeIds not owned by the user", async () => {
  const mock = createRouteDatabaseMock();
  __setPostgresTestConfig({ databaseOverride: mock.database, databaseUrlOverride: "postgres://unit-test" });

  const response = await request(createApp(), "/api/strolls", {
    method: "POST",
    body: JSON.stringify({
      clientRequestId: "request-foreign",
      source: "manual",
      city: "Patna",
      placeIds: ["place-1", "foreign-place"],
    }),
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "invalid_place_ids");
  assert.equal(mock.clientCalls.some((call) => /insert into strolls/i.test(call.sql)), false);
});

test("POST /api/strolls rate limits excessive draft creation attempts", async () => {
  const mock = createRouteDatabaseMock();
  __setPostgresTestConfig({ databaseOverride: mock.database, databaseUrlOverride: "postgres://unit-test" });
  const app = createApp("user-1", undefined, {
    rateLimits: {
      create: { keyPrefix: "unit-create", windowMs: 60_000, max: 1 },
    },
  });

  const payload = {
    clientRequestId: "client-rate-limit",
    source: "manual",
    city: "Patna",
    placeIds: ["place-1"],
  };

  const first = await request(app, "/api/strolls", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const second = await request(app, "/api/strolls", {
    method: "POST",
    body: JSON.stringify({ ...payload, clientRequestId: "client-rate-limit-2" }),
  });

  assert.equal(first.status, 201);
  assert.equal(second.status, 429);
  assert.equal(second.body.code, "rate_limited");
});

test("GET /api/strolls/:strollId returns 404 when the scoped user lookup finds no row", async () => {
  const mock = createRouteDatabaseMock();
  __setPostgresTestConfig({ databaseOverride: mock.database, databaseUrlOverride: "postgres://unit-test" });

  const response = await request(createApp("user-2"), "/api/strolls/missing");

  assert.equal(response.status, 404);
  assert.deepEqual(mock.calls[0]?.params, ["user-2", "missing"]);
});

test("GET /api/strolls/:strollId includes ordered stops", async () => {
  const mock = createRouteDatabaseMock();
  __setPostgresTestConfig({ databaseOverride: mock.database, databaseUrlOverride: "postgres://unit-test" });

  const response = await request(createApp(), "/api/strolls/stroll-1");

  assert.equal(response.status, 200);
  assert.deepEqual(((response.body.stroll as Record<string, unknown>).stops as Array<Record<string, unknown>>).map(
    (stop) => stop.placeId,
  ), ["place-1", "place-2"]);
  const firstStop = ((response.body.stroll as Record<string, unknown>).stops as Array<Record<string, unknown>>)[0];
  assert.equal(firstStop?.placeTitle, "Golghar");
  assert.equal(firstStop?.placeAddress, "Golghar, Patna");
  assert.equal(firstStop?.latitude, 25.612);
});

test("GET /api/strolls/:strollId/live-conditions enforces ownership and returns provider state", async () => {
  const mock = createRouteDatabaseMock();
  __setPostgresTestConfig({ databaseOverride: mock.database, databaseUrlOverride: "postgres://unit-test" });
  let receivedStrollId: string | null = null;

  const response = await request(createApp("user-1", {
    getLiveConditions: async (stroll) => {
      receivedStrollId = stroll?.id ?? null;
      return {
        strollId: stroll?.id ?? "",
        status: "available",
        fetchedTimestamp: "2026-07-11T10:00:00.000Z",
        expiryTimestamp: "2026-07-11T10:10:00.000Z",
        conditions: [],
        providers: [{
          provider: "unit_weather",
          conditionType: "weather",
          status: "success",
          fetchedTimestamp: "2026-07-11T10:00:00.000Z",
          expiryTimestamp: "2026-07-11T10:10:00.000Z",
          conditions: [],
        }],
      };
    },
  }), "/api/strolls/stroll-1/live-conditions");

  assert.equal(response.status, 200);
  assert.equal(receivedStrollId, "stroll-1");
  assert.equal((response.body.live as Record<string, unknown>).status, "available");

  const unauthorized = await request(createApp("user-2"), "/api/strolls/missing/live-conditions");
  assert.equal(unauthorized.status, 404);
});

test("GET /api/strolls/:strollId/adaptation-recommendation returns verified reorder proposal", async () => {
  const mock = createRouteDatabaseMock();
  __setPostgresTestConfig({ databaseOverride: mock.database, databaseUrlOverride: "postgres://unit-test" });

  const response = await request(createApp("user-1", {
    getLiveConditions: async (stroll) => ({
      strollId: stroll.id,
      status: "available",
      fetchedTimestamp: "2026-07-11T10:00:00.000Z",
      expiryTimestamp: "2026-07-11T10:30:00.000Z",
      conditions: [{
        id: "weather-1",
        provider: "unit_weather",
        conditionType: "weather",
        severity: "high",
        confidence: null,
        sourceTimestamp: "2026-07-11T10:00:00.000Z",
        fetchedTimestamp: "2026-07-11T10:00:00.000Z",
        expiryTimestamp: "2099-07-11T10:30:00.000Z",
        message: "Rain is reported near this Stroll.",
        payload: {},
      }],
      providers: [],
    }),
  }), "/api/strolls/stroll-1/adaptation-recommendation?currentLat=25.6&currentLng=85.1");

  assert.equal(response.status, 200);
  const recommendation = response.body.recommendation as Record<string, unknown>;
  assert.equal(recommendation.status, "recommended");
  assert.deepEqual(recommendation.proposedStopIds, ["stop-2", "stop-1"]);
});

test("POST /api/strolls/:strollId/reorder explicitly persists accepted full order", async () => {
  const mock = createRouteDatabaseMock();
  __setPostgresTestConfig({ databaseOverride: mock.database, databaseUrlOverride: "postgres://unit-test" });

  const response = await request(createApp(), "/api/strolls/stroll-1/reorder", {
    method: "POST",
    body: JSON.stringify({ stopIds: ["stop-2", "stop-1"] }),
  });
  const reload = await request(createApp(), "/api/strolls/stroll-1");

  assert.equal(response.status, 200);
  assert.deepEqual(((response.body.stroll as Record<string, unknown>).stops as Array<Record<string, unknown>>).map((stop) => stop.id), ["stop-2", "stop-1"]);
  assert.deepEqual(((reload.body.stroll as Record<string, unknown>).stops as Array<Record<string, unknown>>).map((stop) => stop.id), ["stop-2", "stop-1"]);
});

test("POST /api/strolls/:strollId/reorder rejects unauthorized and duplicate reorder attempts", async () => {
  const mock = createRouteDatabaseMock();
  __setPostgresTestConfig({ databaseOverride: mock.database, databaseUrlOverride: "postgres://unit-test" });

  const unauthorized = await request(createApp("user-2"), "/api/strolls/missing/reorder", {
    method: "POST",
    body: JSON.stringify({ stopIds: ["stop-2", "stop-1"] }),
  });
  const duplicate = await request(createApp(), "/api/strolls/stroll-1/reorder", {
    method: "POST",
    body: JSON.stringify({ stopIds: ["stop-1", "stop-1"] }),
  });

  assert.equal(unauthorized.status, 404);
  assert.equal(duplicate.status, 400);
});

test("hero bookmark routes upsert, list, and remove", async () => {
  const mock = createRouteDatabaseMock();
  __setPostgresTestConfig({ databaseOverride: mock.database, databaseUrlOverride: "postgres://unit-test" });
  const app = createApp();

  const save = await request(app, "/api/hero-bookmarks", {
    method: "POST",
    body: JSON.stringify({ cardKey: "hero-1", title: "Food trail", matchingPlaceIds: ["place-1"] }),
  });
  const list = await request(app, "/api/hero-bookmarks");
  const remove = await request(app, "/api/hero-bookmarks/remove", {
    method: "POST",
    body: JSON.stringify({ cardKey: "hero-1" }),
  });

  assert.equal(save.status, 200);
  assert.equal(list.status, 200);
  assert.equal(remove.status, 200);
  assert.equal(remove.body.removed, true);
});

test("POST /api/hero-interactions is best effort", async () => {
  const mock = createRouteDatabaseMock();
  mock.failHeroInteractions();
  __setPostgresTestConfig({ databaseOverride: mock.database, databaseUrlOverride: "postgres://unit-test" });

  const originalConsoleError = console.error;
  console.error = () => undefined;
  let response: Awaited<ReturnType<typeof request>>;
  try {
    response = await request(createApp(), "/api/hero-interactions", {
      method: "POST",
      body: JSON.stringify({ cardKey: "hero-1", action: "clicked" }),
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, recorded: false });
});
