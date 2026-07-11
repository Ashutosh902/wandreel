import test from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryStrollCurationJobStore,
  StrollCurationConflictError,
  type StrollCurationPersistence,
} from "./jobStore";
import type { StrollStatus, StrollSummary } from "./types";

function stroll(status: StrollStatus, overrides: Partial<StrollSummary> = {}): StrollSummary {
  return {
    id: "stroll-1",
    name: "Patna Stroll",
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function createPersistence(initialStatus: StrollStatus) {
  const transitions: StrollStatus[] = [];
  const failures: Array<{ code: string; message: string }> = [];
  let current = stroll(initialStatus);
  let validationError: Error | null = null;

  const persistence: StrollCurationPersistence = {
    getStrollSummary: async () => current,
    markQueued: async () => {
      current = stroll("queued");
      transitions.push("queued");
      return current;
    },
    markCurating: async () => {
      current = stroll("curating");
      transitions.push("curating");
      return current;
    },
    markReady: async () => {
      current = stroll("ready", { curatedAt: "2026-07-11T10:01:00.000Z" });
      transitions.push("ready");
      return current;
    },
    markFailed: async (_userId, _strollId, code, message) => {
      current = stroll("failed", { failureCode: code, failureMessage: message });
      transitions.push("failed");
      failures.push({ code, message });
      return current;
    },
    validateReady: async () => {
      if (validationError) throw validationError;
    },
  };

  return {
    failures,
    persistence,
    transitions,
    setStatus: (status: StrollStatus) => {
      current = stroll(status);
    },
    failValidation: (error: Error) => {
      validationError = error;
    },
  };
}

test("Stroll curation job store persists queued to curating to ready", async () => {
  const fake = createPersistence("draft");
  const store = new InMemoryStrollCurationJobStore({ persistence: fake.persistence });

  const result = await store.trigger({ userId: "user-1", strollId: "stroll-1" });
  const completed = await result.completion;

  assert.equal(result.duplicate, false);
  assert.equal(completed?.status, "ready");
  assert.deepEqual(fake.transitions, ["queued", "curating", "ready"]);
});

test("Stroll curation job store persists queued or curating failures", async () => {
  const fake = createPersistence("draft");
  const store = new InMemoryStrollCurationJobStore({
    persistence: fake.persistence,
    runner: async () => {
      throw new Error("curator unavailable");
    },
  });

  const result = await store.trigger({ userId: "user-1", strollId: "stroll-1" });
  const completed = await result.completion;

  assert.equal(completed?.status, "failed");
  assert.deepEqual(fake.transitions, ["queued", "curating", "failed"]);
  assert.equal(fake.failures[0]?.code, "curation_failed");
});

test("Stroll curation retry only starts from failed Strolls", async () => {
  const fake = createPersistence("draft");
  const store = new InMemoryStrollCurationJobStore({ persistence: fake.persistence });

  await assert.rejects(
    () => store.trigger({ userId: "user-1", strollId: "stroll-1", mode: "retry" }),
    (error) => error instanceof StrollCurationConflictError && error.code === "invalid_retry_state",
  );

  fake.setStatus("failed");
  const result = await store.trigger({ userId: "user-1", strollId: "stroll-1", mode: "retry" });
  await result.completion;

  assert.equal(result.duplicate, false);
  assert.deepEqual(fake.transitions, ["queued", "curating", "ready"]);
});

test("Stroll curation job store protects duplicate active triggers", async () => {
  const fake = createPersistence("draft");
  const paused = deferred<void>();
  const store = new InMemoryStrollCurationJobStore({
    persistence: fake.persistence,
    runner: async () => paused.promise,
  });

  const first = await store.trigger({ userId: "user-1", strollId: "stroll-1" });
  const duplicate = await store.trigger({ userId: "user-1", strollId: "stroll-1" });
  paused.resolve();
  await first.completion;

  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.job.id, first.job.id);
  assert.deepEqual(fake.transitions, ["queued", "curating", "ready"]);
});

test("Stroll curation job store marks timeout failures", async () => {
  const fake = createPersistence("draft");
  const paused = deferred<void>();
  const store = new InMemoryStrollCurationJobStore({
    persistence: fake.persistence,
    runner: async () => paused.promise,
    timeoutMs: 5,
  });

  const result = await store.trigger({ userId: "user-1", strollId: "stroll-1" });
  const completed = await result.completion;

  assert.equal(completed?.status, "failed");
  assert.equal(fake.failures[0]?.code, "timeout");
});

test("Stroll curation validation failure is persisted", async () => {
  const fake = createPersistence("draft");
  fake.failValidation(Object.assign(new Error("bad stop ownership"), { code: "invalid_stop_ownership" }));
  const store = new InMemoryStrollCurationJobStore({ persistence: fake.persistence });

  const result = await store.trigger({ userId: "user-1", strollId: "stroll-1" });
  const completed = await result.completion;

  assert.equal(completed?.status, "failed");
  assert.equal(fake.failures[0]?.code, "invalid_stop_ownership");
});

test("Stroll curation marks ready before enrichment completes", async () => {
  const fake = createPersistence("draft");
  let enrichmentStarted = false;
  let resolveEnrichment: () => void = () => undefined;
  const enrichmentDone = new Promise<void>((resolve) => {
    resolveEnrichment = resolve;
  });
  const store = new InMemoryStrollCurationJobStore({
    persistence: {
      ...fake.persistence,
      enrichStops: () => {
        enrichmentStarted = true;
        return enrichmentDone;
      },
    },
  });
  const result = await store.trigger({ userId: "user-1", strollId: "stroll-1" });
  const completed = await result.completion;

  assert.equal(completed?.status, "ready");
  assert.equal(enrichmentStarted, true);
  assert.deepEqual(fake.transitions, ["queued", "curating", "ready"]);

  resolveEnrichment();
});

test("Stroll curation generates stops before deterministic ready validation", async () => {
  const fake = createPersistence("draft");
  const calls: string[] = [];
  const store = new InMemoryStrollCurationJobStore({
    persistence: {
      ...fake.persistence,
      generateStops: async () => {
        calls.push("generate");
      },
      validateReady: async () => {
        calls.push("validate");
      },
    },
  });

  const result = await store.trigger({ userId: "user-1", strollId: "stroll-1" });
  const completed = await result.completion;

  assert.equal(completed?.status, "ready");
  assert.deepEqual(calls, ["generate", "validate"]);
  assert.deepEqual(fake.transitions, ["queued", "curating", "ready"]);
});
