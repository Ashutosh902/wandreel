import assert from "node:assert/strict";
import test from "node:test";
import { __resetPostgresTestConfig, __setPostgresTestConfig, type PostgresDatabase } from "../auth/postgresAuth";
import { acceptStrollStopOrder, StrollReorderValidationError } from "./store";

type StopRow = {
  id: string;
  place_id: string;
  sequence: number;
  owned_place_id: string | null;
};

function strollRow() {
  return {
    id: "stroll-1",
    name: "Patna Stroll",
    description: null,
    city: "Patna",
    status: "ready",
    source: "manual",
    start_date: null,
    end_date: null,
    requested_start_time: null,
    traveller_count: null,
    interests_json: [],
    latitude: null,
    longitude: null,
    total_distance_meters: null,
    estimated_duration_minutes: null,
    stop_count: 2,
    failure_code: null,
    failure_message: null,
    created_at: "2026-07-11T10:00:00.000Z",
    updated_at: "2026-07-11T10:00:00.000Z",
    curated_at: "2026-07-11T10:00:00.000Z",
    archived_at: null,
  };
}

function createDatabaseMock(options: { stops?: StopRow[]; strollExists?: boolean } = {}) {
  const stops = options.stops ?? [
    { id: "stop-1", place_id: "place-1", sequence: 1, owned_place_id: "place-1" },
    { id: "stop-2", place_id: "place-2", sequence: 2, owned_place_id: "place-2" },
  ];
  const tx: string[] = [];
  const database = {
    query: async (sql: string) => {
      if (/from strolls s/i.test(sql) && /where s\.user_id = \$1 and s\.id = \$2/i.test(sql)) {
        return options.strollExists === false ? { rows: [], rowCount: 0 } : { rows: [strollRow()], rowCount: 1 };
      }
      if (/from stroll_stops ss/i.test(sql)) {
        return {
          rows: [...stops]
            .sort((a, b) => a.sequence - b.sequence)
            .map((stop) => ({
              id: stop.id,
              place_id: stop.place_id,
              place_title: stop.id,
              place_category: "Explore",
              place_metadata_json: {},
              sequence: stop.sequence,
              reason: null,
              generated_description: null,
              description_generation_meta_json: null,
              estimated_visit_duration_minutes: null,
              arrival_estimate: null,
              departure_estimate: null,
              route_distance_meters: null,
              route_duration_minutes: null,
            })),
          rowCount: stops.length,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => {
        if (sql === "begin" || sql === "commit" || sql === "rollback") {
          tx.push(sql);
          return { rows: [], rowCount: 0 };
        }
        if (/select ss\.id/i.test(sql)) {
          return { rows: [...stops].sort((a, b) => a.sequence - b.sequence), rowCount: stops.length };
        }
        if (/select id from strolls/i.test(sql)) {
          return options.strollExists === false ? { rows: [], rowCount: 0 } : { rows: [{ id: "stroll-1" }], rowCount: 1 };
        }
        if (/update stroll_stops/i.test(sql)) {
          const stopId = String(params?.[1] ?? "");
          const sequence = Number(params?.[2]);
          const stop = stops.find((item) => item.id === stopId);
          if (stop) stop.sequence = sequence;
          return { rows: [], rowCount: stop ? 1 : 0 };
        }
        if (/update strolls/i.test(sql)) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    }),
  } as unknown as PostgresDatabase;

  return { database, stops, tx };
}

test.afterEach(() => {
  __resetPostgresTestConfig();
});

test("acceptStrollStopOrder persists accepted order transactionally", async () => {
  const mock = createDatabaseMock();
  __setPostgresTestConfig({ databaseOverride: mock.database, databaseUrlOverride: "postgres://unit-test" });

  const updated = await acceptStrollStopOrder("user-1", "stroll-1", ["stop-2", "stop-1"]);

  assert.deepEqual(mock.tx, ["begin", "commit"]);
  assert.deepEqual(mock.stops.sort((a, b) => a.sequence - b.sequence).map((stop) => stop.id), ["stop-2", "stop-1"]);
  assert.deepEqual(updated?.stops.map((stop) => stop.id), ["stop-2", "stop-1"]);
});

test("acceptStrollStopOrder returns null for unauthorized scoped access", async () => {
  const mock = createDatabaseMock({ stops: [], strollExists: false });
  __setPostgresTestConfig({ databaseOverride: mock.database, databaseUrlOverride: "postgres://unit-test" });

  const updated = await acceptStrollStopOrder("user-2", "missing", ["stop-1"]);

  assert.equal(updated, null);
  assert.deepEqual(mock.tx, ["begin", "rollback"]);
});

test("acceptStrollStopOrder rejects duplicate, missing, foreign, and non-owned stops", async () => {
  for (const [stopIds, code, stops] of [
    [["stop-1", "stop-1"], "duplicate_stop", undefined],
    [["stop-1"], "partial_reorder_not_supported", undefined],
    [["stop-1", "foreign"], "foreign_stop", undefined],
    [["stop-1", "stop-2"], "foreign_place", [
      { id: "stop-1", place_id: "place-1", sequence: 1, owned_place_id: "place-1" },
      { id: "stop-2", place_id: "place-2", sequence: 2, owned_place_id: null },
    ]],
  ] as const) {
    const mock = createDatabaseMock({ stops: stops ? [...stops] : undefined });
    __setPostgresTestConfig({ databaseOverride: mock.database, databaseUrlOverride: "postgres://unit-test" });
    await assert.rejects(
      () => acceptStrollStopOrder("user-1", "stroll-1", [...stopIds]),
      (error) => error instanceof StrollReorderValidationError && error.code === code,
    );
    assert.deepEqual(mock.tx, ["begin", "rollback"]);
    __resetPostgresTestConfig();
  }
});
