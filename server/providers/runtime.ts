export type ProviderFailureKind =
  | "timeout"
  | "abort"
  | "http"
  | "rate_limited"
  | "network"
  | "circuit_open"
  | "unknown";

export type ProviderTelemetryEvent = {
  provider: string;
  operation: string;
  outcome: "success" | "failure" | "cache_hit" | "deduped";
  durationMs: number;
  attempt: number;
  failureKind?: ProviderFailureKind;
  failureCode?: string;
  status?: number;
  cacheKey?: string;
  dedupeKey?: string;
};

export type ProviderExecutionContext = {
  signal: AbortSignal;
  attempt: number;
};

export type ProviderRuntimeOptions = {
  provider: string;
  operation: string;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  cacheKey?: string;
  cacheTtlMs?: number;
  dedupeKey?: string;
  maxConcurrency?: number;
  circuitBreaker?: {
    failureThreshold: number;
    cooldownMs: number;
  };
  task: (context: ProviderExecutionContext) => Promise<unknown>;
};

type CacheEntry = {
  expiresAtMs: number;
  value: unknown;
};

type CircuitState = {
  failures: number;
  openUntilMs: number;
};

export class ProviderError extends Error {
  readonly kind: ProviderFailureKind;
  readonly code: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, options: {
    kind: ProviderFailureKind;
    code?: string;
    status?: number;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(message, { cause: options.cause });
    this.name = "ProviderError";
    this.kind = options.kind;
    this.code = options.code ?? options.kind;
    this.status = options.status;
    this.retryable = options.retryable ?? isRetryableKind(options.kind, options.status);
  }
}

export function isRetryableKind(kind: ProviderFailureKind, status?: number) {
  if (kind === "timeout" || kind === "network") return true;
  if (kind === "http" && typeof status === "number") return status >= 500 || status === 429;
  if (kind === "rate_limited") return true;
  return false;
}

export function classifyProviderFailure(error: unknown): {
  kind: ProviderFailureKind;
  code: string;
  status?: number;
  retryable: boolean;
  message: string;
} {
  if (error instanceof ProviderError) {
    return {
      kind: error.kind,
      code: error.code,
      status: error.status,
      retryable: error.retryable,
      message: error.message,
    };
  }

  const name = typeof (error as { name?: unknown })?.name === "string" ? String((error as { name: string }).name) : "";
  const message = error instanceof Error ? error.message : "Provider request failed.";
  if (name === "AbortError") {
    return { kind: "abort", code: "provider_aborted", retryable: false, message };
  }
  if (/timeout|timed out/i.test(message)) {
    return { kind: "timeout", code: "provider_timeout", retryable: true, message };
  }
  if (/fetch failed|network|ECONNRESET|ENOTFOUND|ECONNREFUSED/i.test(message)) {
    return { kind: "network", code: "provider_network_error", retryable: true, message };
  }

  return { kind: "unknown", code: "provider_unknown_error", retryable: false, message };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheIsFresh(entry: CacheEntry | undefined, nowMs: number) {
  return Boolean(entry && entry.expiresAtMs > nowMs);
}

export class ProviderRuntime {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly circuits = new Map<string, CircuitState>();
  private activeCount = 0;
  private readonly queue: Array<() => void> = [];
  private readonly onTelemetry?: (event: ProviderTelemetryEvent) => void;
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxConcurrency: number;

  constructor(options: {
    defaultTimeoutMs?: number;
    defaultMaxConcurrency?: number;
    onTelemetry?: (event: ProviderTelemetryEvent) => void;
  } = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 10_000;
    this.defaultMaxConcurrency = Math.max(1, options.defaultMaxConcurrency ?? 8);
    this.onTelemetry = options.onTelemetry;
  }

  async execute<T>(options: Omit<ProviderRuntimeOptions, "task"> & {
    task: (context: ProviderExecutionContext) => Promise<T>;
  }): Promise<T> {
    const nowMs = Date.now();
    const cacheKey = options.cacheKey;
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cacheIsFresh(cached, nowMs)) {
        this.emitTelemetry(options, {
          outcome: "cache_hit",
          startedAt: nowMs,
          attempt: 0,
          cacheKey,
          dedupeKey: options.dedupeKey,
        });
        return cached!.value as T;
      }
      if (cached) this.cache.delete(cacheKey);
    }

    const dedupeKey = options.dedupeKey;
    if (dedupeKey) {
      const existing = this.inFlight.get(dedupeKey);
      if (existing) {
        this.emitTelemetry(options, {
          outcome: "deduped",
          startedAt: nowMs,
          attempt: 0,
          cacheKey,
          dedupeKey,
        });
        return existing as Promise<T>;
      }
    }

    const promise = this.runWithCircuitAndCache<T>(options);
    if (dedupeKey) {
      this.inFlight.set(dedupeKey, promise);
      promise.finally(() => this.inFlight.delete(dedupeKey)).catch(() => undefined);
    }
    return promise;
  }

  clear() {
    this.cache.clear();
    this.inFlight.clear();
    this.circuits.clear();
    this.queue.length = 0;
    this.activeCount = 0;
  }

  private async runWithCircuitAndCache<T>(options: Omit<ProviderRuntimeOptions, "task"> & {
    task: (context: ProviderExecutionContext) => Promise<T>;
  }) {
    this.assertCircuitClosed(options);
    try {
      const value = await this.runWithRetries(options);
      this.recordCircuitSuccess(options);
      if (options.cacheKey && options.cacheTtlMs && options.cacheTtlMs > 0) {
        this.cache.set(options.cacheKey, {
          expiresAtMs: Date.now() + options.cacheTtlMs,
          value,
        });
      }
      return value;
    } catch (error) {
      this.recordCircuitFailure(options);
      throw error;
    }
  }

  private async runWithRetries<T>(options: Omit<ProviderRuntimeOptions, "task"> & {
    task: (context: ProviderExecutionContext) => Promise<T>;
  }) {
    const retries = Math.max(0, options.retries ?? 0);
    let lastError: unknown;
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      const startedAt = Date.now();
      try {
        const value = await this.withConcurrency(
          options.maxConcurrency ?? this.defaultMaxConcurrency,
          () => this.runAttempt(options, attempt),
        );
        this.emitTelemetry(options, {
          outcome: "success",
          startedAt,
          attempt,
          cacheKey: options.cacheKey,
          dedupeKey: options.dedupeKey,
        });
        return value;
      } catch (error) {
        lastError = error;
        const failure = classifyProviderFailure(error);
        this.emitTelemetry(options, {
          outcome: "failure",
          startedAt,
          attempt,
          failure,
          cacheKey: options.cacheKey,
          dedupeKey: options.dedupeKey,
        });
        if (attempt > retries || !failure.retryable) throw error;
        await sleep(options.retryDelayMs ?? 100);
      }
    }
    throw lastError;
  }

  private async runAttempt<T>(options: Omit<ProviderRuntimeOptions, "task"> & {
    task: (context: ProviderExecutionContext) => Promise<T>;
  }, attempt: number) {
    const timeoutMs = Math.max(1, options.timeoutMs ?? this.defaultTimeoutMs);
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new ProviderError(`${options.provider} ${options.operation} timed out.`, {
          kind: "timeout",
          code: "provider_timeout",
          retryable: true,
        }));
      }, timeoutMs);
    });

    try {
      return await Promise.race([
        options.task({ signal: controller.signal, attempt }),
        timeout,
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private async withConcurrency<T>(limit: number, task: () => Promise<T>) {
    const safeLimit = Math.max(1, limit);
    if (this.activeCount >= safeLimit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.activeCount += 1;
    try {
      return await task();
    } finally {
      this.activeCount = Math.max(0, this.activeCount - 1);
      const next = this.queue.shift();
      if (next) next();
    }
  }

  private circuitKey(options: Pick<ProviderRuntimeOptions, "provider" | "operation">) {
    return `${options.provider}:${options.operation}`;
  }

  private assertCircuitClosed(options: Pick<ProviderRuntimeOptions, "provider" | "operation" | "circuitBreaker">) {
    const breaker = options.circuitBreaker;
    if (!breaker) return;
    const state = this.circuits.get(this.circuitKey(options));
    if (state && state.openUntilMs > Date.now()) {
      throw new ProviderError(`${options.provider} ${options.operation} circuit is open.`, {
        kind: "circuit_open",
        code: "provider_circuit_open",
        retryable: false,
      });
    }
  }

  private recordCircuitSuccess(options: Pick<ProviderRuntimeOptions, "provider" | "operation" | "circuitBreaker">) {
    if (!options.circuitBreaker) return;
    this.circuits.delete(this.circuitKey(options));
  }

  private recordCircuitFailure(options: Pick<ProviderRuntimeOptions, "provider" | "operation" | "circuitBreaker">) {
    const breaker = options.circuitBreaker;
    if (!breaker) return;
    const key = this.circuitKey(options);
    const current = this.circuits.get(key) ?? { failures: 0, openUntilMs: 0 };
    const failures = current.failures + 1;
    this.circuits.set(key, {
      failures,
      openUntilMs: failures >= breaker.failureThreshold ? Date.now() + breaker.cooldownMs : current.openUntilMs,
    });
  }

  private emitTelemetry(options: Pick<ProviderRuntimeOptions, "provider" | "operation">, input: {
    outcome: ProviderTelemetryEvent["outcome"];
    startedAt: number;
    attempt: number;
    failure?: ReturnType<typeof classifyProviderFailure>;
    cacheKey?: string;
    dedupeKey?: string;
  }) {
    const event: ProviderTelemetryEvent = {
      provider: options.provider,
      operation: options.operation,
      outcome: input.outcome,
      durationMs: Math.max(0, Date.now() - input.startedAt),
      attempt: input.attempt,
      failureKind: input.failure?.kind,
      failureCode: input.failure?.code,
      status: input.failure?.status,
      cacheKey: input.cacheKey,
      dedupeKey: input.dedupeKey,
    };
    if (this.onTelemetry) this.onTelemetry(event);
    else console.info("[provider-runtime]", event);
  }
}

export const sharedProviderRuntime = new ProviderRuntime({
  defaultTimeoutMs: Number(process.env.PROVIDER_TIMEOUT_MS || 10_000),
  defaultMaxConcurrency: Number(process.env.PROVIDER_MAX_CONCURRENCY || 8),
});
