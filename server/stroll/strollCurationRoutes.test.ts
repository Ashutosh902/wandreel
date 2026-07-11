import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { StrollCurationConflictError, type StrollCurationJob } from "./jobStore";
import { registerStrollRoutes } from "./routes";

function job(overrides: Partial<StrollCurationJob> = {}): StrollCurationJob {
  return {
    id: "job-1",
    userId: "user-1",
    strollId: "stroll-1",
    status: "queued",
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:00:00.000Z",
    ...overrides,
  };
}

function createApp(options: {
  userId?: string;
  statusResult?: unknown | null;
  retryError?: StrollCurationConflictError;
}) {
  const app = express();
  app.use(express.json());
  registerStrollRoutes(app, {
    requireAuth: (req, _res, next) => {
      if (options.userId) {
        (req as express.Request & { authUser?: { userId: string } }).authUser = { userId: options.userId };
      }
      next();
    },
    curationJobStore: {
      getStatus: async () => options.statusResult ?? null,
      trigger: async ({ mode }) => {
        if (mode === "retry" && options.retryError) throw options.retryError;
        return {
          duplicate: false,
          job: job(),
          stroll: { id: "stroll-1", status: mode === "retry" ? "queued" : "draft" },
          completion: Promise.resolve(null),
        };
      },
    },
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

test("GET /api/strolls/:strollId/status returns 404 for unauthorized scoped access", async () => {
  const response = await request(createApp({ userId: "user-2", statusResult: null }), "/api/strolls/stroll-1/status");

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { ok: false, error: "Stroll not found" });
});

test("POST /api/strolls/:strollId/retry returns 404 for unauthorized scoped access", async () => {
  const response = await request(createApp({
    userId: "user-2",
    retryError: new StrollCurationConflictError(404, "stroll_not_found", "Stroll not found."),
  }), "/api/strolls/stroll-1/retry", { method: "POST" });

  assert.equal(response.status, 404);
  assert.equal(response.body.code, "stroll_not_found");
});

test("POST /api/strolls/:strollId/retry returns 409 when the Stroll is not failed", async () => {
  const response = await request(createApp({
    userId: "user-1",
    retryError: new StrollCurationConflictError(409, "invalid_retry_state", "Only failed Strolls can be retried."),
  }), "/api/strolls/stroll-1/retry", { method: "POST" });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "invalid_retry_state");
});

test("POST /api/strolls/:strollId/curate serializes the curation job without completion promise", async () => {
  const response = await request(createApp({ userId: "user-1" }), "/api/strolls/stroll-1/curate", { method: "POST" });
  const responseJob = response.body.job as Record<string, unknown>;

  assert.equal(response.status, 202);
  assert.equal(responseJob.status, "queued");
  assert.equal("completion" in responseJob, false);
});
