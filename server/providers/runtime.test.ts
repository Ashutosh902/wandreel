import assert from "node:assert/strict";
import test from "node:test";
import { ProviderError, ProviderRuntime, classifyProviderFailure } from "./runtime";

test("ProviderRuntime times out hanging provider requests and aborts the signal", async () => {
  const runtime = new ProviderRuntime({ onTelemetry: () => undefined });
  let aborted = false;

  await assert.rejects(
    runtime.execute({
      provider: "unit",
      operation: "hang",
      timeoutMs: 10,
      task: ({ signal }) => new Promise((resolve) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        setTimeout(resolve, 200);
      }),
    }),
    (error) => error instanceof ProviderError && error.kind === "timeout",
  );

  assert.equal(aborted, true);
});

test("ProviderRuntime retries retryable failures only", async () => {
  const runtime = new ProviderRuntime({ onTelemetry: () => undefined });
  let attempts = 0;

  const result = await runtime.execute({
    provider: "unit",
    operation: "retry",
    timeoutMs: 100,
    retries: 1,
    retryDelayMs: 1,
    task: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new ProviderError("temporary outage", { kind: "network", retryable: true });
      }
      return "ok";
    },
  });

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
});

test("ProviderRuntime caches successful values until expiry", async () => {
  const runtime = new ProviderRuntime({ onTelemetry: () => undefined });
  let calls = 0;
  const options = {
    provider: "unit",
    operation: "cache",
    cacheKey: "unit-cache",
    cacheTtlMs: 1_000,
    task: async () => {
      calls += 1;
      return `value-${calls}`;
    },
  };

  assert.equal(await runtime.execute(options), "value-1");
  assert.equal(await runtime.execute(options), "value-1");
  assert.equal(calls, 1);
});

test("ProviderRuntime coalesces duplicate in-flight requests", async () => {
  const runtime = new ProviderRuntime({ onTelemetry: () => undefined });
  let calls = 0;
  const task = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return "shared";
  };

  const [first, second] = await Promise.all([
    runtime.execute({ provider: "unit", operation: "dedupe", dedupeKey: "same", task }),
    runtime.execute({ provider: "unit", operation: "dedupe", dedupeKey: "same", task }),
  ]);

  assert.equal(first, "shared");
  assert.equal(second, "shared");
  assert.equal(calls, 1);
});

test("ProviderRuntime opens a circuit after repeated failures", async () => {
  const runtime = new ProviderRuntime({ onTelemetry: () => undefined });
  const options = {
    provider: "unit",
    operation: "circuit",
    circuitBreaker: { failureThreshold: 1, cooldownMs: 1_000 },
    task: async () => {
      throw new ProviderError("bad gateway", { kind: "http", status: 502, retryable: false });
    },
  };

  await assert.rejects(runtime.execute(options));
  await assert.rejects(
    runtime.execute(options),
    (error) => error instanceof ProviderError && error.kind === "circuit_open",
  );
});

test("classifyProviderFailure recognizes provider errors and generic timeout messages", () => {
  assert.equal(classifyProviderFailure(new ProviderError("rate limit", { kind: "rate_limited" })).kind, "rate_limited");
  assert.equal(classifyProviderFailure(new Error("request timed out")).kind, "timeout");
});
