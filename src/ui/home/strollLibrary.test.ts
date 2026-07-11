/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchStrollLibrary,
  fetchStrollDetail,
  fetchStrollStatus,
  getStrollIdsToPoll,
  getStrollLibraryViewState,
  getStrollStatusPresentation,
  mergePolledStroll,
  retryStrollCuration,
  type PersistentStrollSummary,
  type StrollLibraryStatus,
} from "./strollLibrary";

function stroll(status: StrollLibraryStatus, overrides: Partial<PersistentStrollSummary> = {}): PersistentStrollSummary {
  return {
    id: `stroll-${status}`,
    name: `${status} Stroll`,
    description: null,
    city: "Patna",
    status,
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
    stopCount: 2,
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:00:00.000Z",
    curatedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function createFetchMock(payload: unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    };
  };
  return { calls, fetcher };
}

test("getStrollLibraryViewState covers loading, empty, error, and ready states", () => {
  assert.equal(getStrollLibraryViewState({ loadState: "loading", strolls: [], error: null }), "loading");
  assert.equal(getStrollLibraryViewState({ loadState: "ready", strolls: [], error: null }), "empty");
  assert.equal(getStrollLibraryViewState({ loadState: "error", strolls: [], error: "nope" }), "error");
  assert.equal(getStrollLibraryViewState({ loadState: "error", strolls: [stroll("draft")], error: "stale" }), "ready");
});

test("getStrollStatusPresentation distinguishes each Stroll status", () => {
  assert.equal(getStrollStatusPresentation("draft").label, "Draft");
  assert.equal(getStrollStatusPresentation("queued").label, "Queued");
  assert.equal(getStrollStatusPresentation("curating").label, "Curating");
  assert.equal(getStrollStatusPresentation("ready").label, "Ready");
  assert.equal(getStrollStatusPresentation("failed").label, "Failed");
});

test("getStrollIdsToPoll only includes queued and curating Strolls", () => {
  assert.deepEqual(getStrollIdsToPoll([
    stroll("draft"),
    stroll("queued"),
    stroll("curating"),
    stroll("ready"),
    stroll("failed"),
    stroll("archived"),
  ]), ["stroll-queued", "stroll-curating"]);
});

test("mergePolledStroll updates persisted state after status refetch and removes archived Strolls", () => {
  const list = [stroll("queued", { id: "stroll-1" }), stroll("ready", { id: "stroll-2" })];
  const readyList = mergePolledStroll(list, stroll("ready", { id: "stroll-1", name: "Ready after refetch" }));
  const archivedList = mergePolledStroll(readyList, stroll("archived", { id: "stroll-2" }));

  assert.equal(readyList[0]?.status, "ready");
  assert.equal(readyList[0]?.name, "Ready after refetch");
  assert.deepEqual(archivedList.map((item) => item.id), ["stroll-1"]);
});

test("fetchStrollLibrary loads persistent Strolls from backend API", async () => {
  const mock = createFetchMock({ ok: true, strolls: [stroll("draft")] });
  const strolls = await fetchStrollLibrary("https://api.test/", mock.fetcher);

  assert.equal(strolls[0]?.status, "draft");
  assert.equal(mock.calls[0]?.url, "https://api.test/api/strolls");
  assert.equal(mock.calls[0]?.init?.credentials, "include");
});

test("fetchStrollStatus reads a single Stroll status for polling", async () => {
  const mock = createFetchMock({ ok: true, stroll: stroll("ready", { id: "stroll/a b" }) });
  const result = await fetchStrollStatus("https://api.test", "stroll/a b", mock.fetcher);

  assert.equal(result.status, "ready");
  assert.equal(mock.calls[0]?.url, "https://api.test/api/strolls/stroll%2Fa%20b/status");
});

test("fetchStrollDetail loads ordered stop detail from the backend API", async () => {
  const mock = createFetchMock({
    ok: true,
    stroll: {
      ...stroll("ready", { id: "stroll-1" }),
      stops: [{ id: "stop-1", placeId: "place-1", sequence: 1, placeTitle: "Golghar" }],
    },
  });
  const result = await fetchStrollDetail("https://api.test", "stroll-1", mock.fetcher);

  assert.equal(result.stops[0]?.placeTitle, "Golghar");
  assert.equal(mock.calls[0]?.url, "https://api.test/api/strolls/stroll-1");
});

test("retryStrollCuration posts to the retry endpoint", async () => {
  const mock = createFetchMock({ ok: true, stroll: stroll("queued") });
  const result = await retryStrollCuration("https://api.test", "stroll-1", mock.fetcher);

  assert.equal(result.status, "queued");
  assert.equal(mock.calls[0]?.url, "https://api.test/api/strolls/stroll-1/retry");
  assert.equal(mock.calls[0]?.init?.method, "POST");
});

test("Stroll API helpers surface backend errors", async () => {
  const mock = createFetchMock({ ok: false, error: "Stroll not found" }, 404);

  await assert.rejects(() => fetchStrollStatus("https://api.test", "missing", mock.fetcher), /Stroll not found/);
});
