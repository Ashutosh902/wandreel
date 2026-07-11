import test from "node:test";
import assert from "node:assert/strict";
import {
  DurableStrollCurationJobStore,
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

type MockDurableJobRow = {
  id: string;
  user_id: string;
  stroll_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  trigger_mode: "initial" | "retry" | "recovery";
  attempt_count: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  next_run_at: string;
  started_at: string | null;
  succeeded_at: string | null;
  failed_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
};

function createDurableJobDatabase(initialJobs: MockDurableJobRow[] = []) {
  const jobs = [...initialJobs];
  const now = () => "2026-07-11T10:00:00.000Z";
  const isExpired = (value: string | null) => !value || Date.parse(value) < Date.parse(now());

  const database = {
    query: async <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
      const result = (rows: MockDurableJobRow[], rowCount = rows.length) => ({
        rows: rows as unknown as T[],
        rowCount,
      });

      if (/select \*/i.test(sql) && /from stroll_curation_jobs/i.test(sql) && /status in \('queued', 'running'\)/i.test(sql)) {
        const [userId, strollId] = params;
        return result(
          jobs
            .filter((job) => job.user_id === userId && job.stroll_id === strollId && (job.status === "queued" || job.status === "running"))
            .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
            .slice(0, 1),
        );
      }

      if (/insert into stroll_curation_jobs/i.test(sql)) {
        const [id, userId, strollId, mode] = params as string[];
        if (jobs.some((job) => job.stroll_id === strollId && (job.status === "queued" || job.status === "running"))) {
          throw Object.assign(new Error("duplicate active job"), { code: "23505" });
        }
        const row: MockDurableJobRow = {
          id,
          user_id: userId,
          stroll_id: strollId,
          status: "queued",
          trigger_mode: mode as "initial" | "retry",
          attempt_count: 0,
          max_attempts: 3,
          lease_owner: null,
          lease_expires_at: null,
          heartbeat_at: null,
          next_run_at: now(),
          started_at: null,
          succeeded_at: null,
          failed_at: null,
          failure_code: null,
          failure_message: null,
          created_at: now(),
          updated_at: now(),
        };
        jobs.push(row);
        return result([row]);
      }

      if (/set status = 'running'/i.test(sql)) {
        const [jobId, workerId] = params as string[];
        const job = jobs.find((item) => item.id === jobId);
        if (!job || !(job.status === "queued" || job.status === "running")) return result([]);
        if (job.status === "running" && !isExpired(job.lease_expires_at) && job.lease_owner !== workerId) {
          return result([]);
        }
        job.status = "running";
        job.attempt_count += 1;
        job.lease_owner = workerId;
        job.lease_expires_at = "2026-07-11T10:01:00.000Z";
        job.heartbeat_at = now();
        job.started_at = job.started_at ?? now();
        job.updated_at = now();
        return result([job]);
      }

      if (/set heartbeat_at = now\(\)/i.test(sql)) {
        return result([], 1);
      }

      if (/set status = 'succeeded'/i.test(sql)) {
        const [jobId, workerId] = params as string[];
        const job = jobs.find((item) => item.id === jobId && item.lease_owner === workerId);
        if (!job) return result([]);
        job.status = "succeeded";
        job.lease_owner = null;
        job.lease_expires_at = null;
        job.succeeded_at = now();
        job.failure_code = null;
        job.failure_message = null;
        job.updated_at = now();
        return result([], 1);
      }

      if (/set status = 'failed'/i.test(sql)) {
        const [jobId, workerId, code, message] = params as string[];
        const job = jobs.find((item) => item.id === jobId && item.lease_owner === workerId);
        if (!job) return result([]);
        job.status = "failed";
        job.lease_owner = null;
        job.lease_expires_at = null;
        job.failed_at = now();
        job.failure_code = code;
        job.failure_message = message;
        job.updated_at = now();
        return result([], 1);
      }

      if (/set status = 'queued'/i.test(sql) && /trigger_mode = 'recovery'/i.test(sql)) {
        const recovered = jobs.filter((job) => job.status === "running" && isExpired(job.lease_expires_at));
        for (const job of recovered) {
          job.status = "queued";
          job.trigger_mode = "recovery";
          job.lease_owner = null;
          job.lease_expires_at = null;
          job.heartbeat_at = null;
          job.next_run_at = now();
          job.updated_at = now();
        }
        return result(recovered);
      }

      throw new Error(`Unhandled durable job SQL: ${sql}`);
    },
    connect: async () => {
      throw new Error("connect not used by durable job tests");
    },
  };

  return { database, jobs };
}

function durableJob(overrides: Partial<MockDurableJobRow> = {}): MockDurableJobRow {
  return {
    id: "job-1",
    user_id: "user-1",
    stroll_id: "stroll-1",
    status: "running",
    trigger_mode: "initial",
    attempt_count: 1,
    max_attempts: 3,
    lease_owner: "dead-worker",
    lease_expires_at: "2026-07-11T09:59:00.000Z",
    heartbeat_at: "2026-07-11T09:58:00.000Z",
    next_run_at: "2026-07-11T09:58:00.000Z",
    started_at: "2026-07-11T09:58:00.000Z",
    succeeded_at: null,
    failed_at: null,
    failure_code: null,
    failure_message: null,
    created_at: "2026-07-11T09:58:00.000Z",
    updated_at: "2026-07-11T09:58:00.000Z",
    ...overrides,
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

test("durable Stroll curation job completes through DB-backed state", async () => {
  const fake = createPersistence("draft");
  const db = createDurableJobDatabase();
  const calls: string[] = [];
  const store = new DurableStrollCurationJobStore({
    database: db.database as any,
    persistence: {
      ...fake.persistence,
      generateStops: async () => {
        calls.push("generate");
      },
      validateReady: async () => {
        calls.push("validate");
      },
    },
    workerId: "worker-1",
    heartbeatMs: 60_000,
  });

  const result = await store.trigger({ userId: "user-1", strollId: "stroll-1" });
  const completed = await result.completion;

  assert.equal(result.duplicate, false);
  assert.equal(completed?.status, "ready");
  assert.equal(db.jobs[0]?.status, "succeeded");
  assert.equal(db.jobs[0]?.attempt_count, 1);
  assert.deepEqual(calls, ["generate", "validate"]);
  assert.deepEqual(fake.transitions, ["queued", "curating", "ready"]);
});

test("durable Stroll curation job prevents duplicate active triggers", async () => {
  const fake = createPersistence("draft");
  const db = createDurableJobDatabase();
  const paused = deferred<void>();
  const store = new DurableStrollCurationJobStore({
    database: db.database as any,
    persistence: fake.persistence,
    runner: async () => paused.promise,
    workerId: "worker-1",
    heartbeatMs: 60_000,
  });

  const first = await store.trigger({ userId: "user-1", strollId: "stroll-1" });
  const duplicate = await store.trigger({ userId: "user-1", strollId: "stroll-1" });
  paused.resolve();
  await first.completion;

  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.job.id, first.job.id);
  assert.equal(db.jobs.length, 1);
});

test("durable Stroll curation recovers an expired running lease", async () => {
  const fake = createPersistence("curating");
  const db = createDurableJobDatabase([durableJob()]);
  const store = new DurableStrollCurationJobStore({
    database: db.database as any,
    persistence: fake.persistence,
    workerId: "worker-2",
    heartbeatMs: 60_000,
  });

  const recovered = await store.recoverStaleJobs();
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(recovered, 1);
  assert.equal(db.jobs[0]?.status, "succeeded");
  assert.equal(db.jobs[0]?.attempt_count, 2);
  assert.deepEqual(fake.transitions, ["queued", "curating", "ready"]);
});

test("durable Stroll curation reconciles active Stroll status with no durable job", async () => {
  const fake = createPersistence("curating");
  const db = createDurableJobDatabase();
  const store = new DurableStrollCurationJobStore({
    database: db.database as any,
    persistence: fake.persistence,
    workerId: "worker-1",
  });

  const status = await store.getStatus("user-1", "stroll-1");

  assert.equal(status?.status, "failed");
  assert.equal(status?.failureCode, "stale_curation_job");
  assert.deepEqual(fake.transitions, ["failed"]);
});
