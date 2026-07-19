import { randomUUID } from "node:crypto";
import { getPostgresDatabase, isPostgresConfigured, type PostgresDatabase } from "../auth/postgresAuth";
import {
  getStrollSummary,
  generatePersistedStrollStopsFromSavedPlaces,
  markStrollCurating,
  markStrollFailed,
  markStrollQueued,
  markStrollReady,
  validatePersistedStrollForReady,
  enrichPersistedStrollStopDescriptions,
} from "./store";
import type { StrollStatus, StrollSummary } from "./types";
import {
  bestEffortObservability,
  completeOperationRun,
  createOperationRun,
  recordFailureEvent,
  recordProductEvent,
} from "../observability/store";

export type StrollCurationJobStatus = "queued" | "curating" | "ready" | "failed";

export type StrollCurationJob = {
  id: string;
  userId: string;
  strollId: string;
  status: StrollCurationJobStatus;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TriggerStrollCurationMode = "initial" | "retry";

export type TriggerStrollCurationResult = {
  duplicate: boolean;
  job: StrollCurationJob;
  stroll: StrollSummary;
  completion: Promise<StrollSummary | null>;
};

export type StrollCurationPersistence = {
  getStrollSummary: (userId: string, strollId: string) => Promise<StrollSummary | null>;
  markQueued: (userId: string, strollId: string) => Promise<StrollSummary | null>;
  markCurating: (userId: string, strollId: string) => Promise<StrollSummary | null>;
  markReady: (userId: string, strollId: string) => Promise<StrollSummary | null>;
  markFailed: (
    userId: string,
    strollId: string,
    failureCode: string,
    failureMessage: string,
  ) => Promise<StrollSummary | null>;
  generateStops?: (userId: string, strollId: string) => Promise<void>;
  validateReady: (userId: string, strollId: string) => Promise<void>;
  enrichStops?: (userId: string, strollId: string) => Promise<void>;
};

export type StrollCurationRunner = (job: StrollCurationJob) => Promise<void>;

type DurableJobStatus = "queued" | "running" | "succeeded" | "failed";

type DurableJobRow = {
  id: string;
  user_id: string;
  stroll_id: string;
  status: DurableJobStatus;
  trigger_mode: TriggerStrollCurationMode | "recovery";
  attempt_count: number | string;
  max_attempts: number | string;
  lease_owner: string | null;
  lease_expires_at: string | Date | null;
  heartbeat_at: string | Date | null;
  next_run_at: string | Date | null;
  started_at: string | Date | null;
  succeeded_at: string | Date | null;
  failed_at: string | Date | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export class StrollCurationConflictError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "StrollCurationConflictError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class StrollCurationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StrollCurationError";
    this.code = code;
  }
}

type JobRecord = StrollCurationJob & {
  completion: Promise<StrollSummary | null>;
};

type TriggerOptions = {
  userId: string;
  strollId: string;
  mode?: TriggerStrollCurationMode;
};

const activeStatuses = new Set<StrollStatus>(["queued", "curating"]);
const allowedInitialStatuses = new Set<StrollStatus>(["draft", "failed"]);

function defaultPersistence(): StrollCurationPersistence {
  return {
    getStrollSummary,
    markQueued: markStrollQueued,
    markCurating: markStrollCurating,
    markReady: markStrollReady,
    markFailed: markStrollFailed,
    generateStops: generatePersistedStrollStopsFromSavedPlaces,
    validateReady: validatePersistedStrollForReady,
    enrichStops: enrichPersistedStrollStopDescriptions,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function makeJobId(userId: string, strollId: string) {
  return `${userId}:${strollId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function failureFromError(error: unknown) {
  if (error instanceof StrollCurationError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: "curation_failed", message: error.message };
  }
  return { code: "curation_failed", message: "Stroll curation failed." };
}

async function defaultRunner() {
  return undefined;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new StrollCurationError("timeout", "Stroll curation timed out."));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export class InMemoryStrollCurationJobStore {
  private readonly jobsByStroll = new Map<string, JobRecord>();
  private readonly persistence: StrollCurationPersistence;
  private readonly runner: StrollCurationRunner;
  private readonly timeoutMs: number;

  constructor(options: {
    persistence?: StrollCurationPersistence;
    runner?: StrollCurationRunner;
    timeoutMs?: number;
  } = {}) {
    this.persistence = options.persistence ?? defaultPersistence();
    this.runner = options.runner ?? defaultRunner;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async getStatus(userId: string, strollId: string): Promise<StrollSummary | null> {
    return this.persistence.getStrollSummary(userId, strollId);
  }

  async trigger(options: TriggerOptions): Promise<TriggerStrollCurationResult> {
    const mode = options.mode ?? "initial";
    const activeJob = this.jobsByStroll.get(this.key(options.userId, options.strollId));
    const existing = await this.persistence.getStrollSummary(options.userId, options.strollId);
    if (!existing) {
      throw new StrollCurationConflictError(404, "stroll_not_found", "Stroll not found.");
    }

    if (activeJob && (activeJob.status === "queued" || activeJob.status === "curating")) {
      return { duplicate: true, job: activeJob, stroll: existing, completion: activeJob.completion };
    }

    if (activeStatuses.has(existing.status)) {
      const job = this.rememberPassiveJob(options.userId, options.strollId, existing.status);
      return { duplicate: true, job, stroll: existing, completion: job.completion };
    }

    if (mode === "retry" && existing.status !== "failed") {
      throw new StrollCurationConflictError(409, "invalid_retry_state", "Only failed Strolls can be retried.");
    }

    if (mode === "initial" && !allowedInitialStatuses.has(existing.status)) {
      throw new StrollCurationConflictError(409, "invalid_curation_state", "This Stroll cannot be queued for curation.");
    }

    const queued = await this.persistence.markQueued(options.userId, options.strollId);
    if (!queued) {
      throw new StrollCurationConflictError(404, "stroll_not_found", "Stroll not found.");
    }

    const job = this.makeJob(options.userId, options.strollId, "queued");
    const placeholder: JobRecord = { ...job, completion: Promise.resolve(null) };
    this.jobsByStroll.set(this.key(options.userId, options.strollId), placeholder);

    const completion = this.run(job).finally(() => {
      const current = this.jobsByStroll.get(this.key(options.userId, options.strollId));
      if (current?.id === job.id) this.jobsByStroll.delete(this.key(options.userId, options.strollId));
    });
    const record: JobRecord = { ...job, completion };
    this.jobsByStroll.set(this.key(options.userId, options.strollId), record);

    return { duplicate: false, job: record, stroll: queued, completion };
  }

  private async run(job: StrollCurationJob): Promise<StrollSummary | null> {
    try {
      this.updateJob(job.userId, job.strollId, { status: "curating", failureCode: null, failureMessage: null });
      await this.persistence.markCurating(job.userId, job.strollId);
      await withTimeout(this.runner(job), this.timeoutMs);
      await this.persistence.generateStops?.(job.userId, job.strollId);
      await this.persistence.validateReady(job.userId, job.strollId);
      const ready = await this.persistence.markReady(job.userId, job.strollId);
      this.updateJob(job.userId, job.strollId, { status: "ready", failureCode: null, failureMessage: null });
      this.enrichStopsBestEffort(job);
      return ready;
    } catch (error) {
      const failure = failureFromError(error);
      const failed = await this.persistence.markFailed(job.userId, job.strollId, failure.code, failure.message);
      this.updateJob(job.userId, job.strollId, {
        status: "failed",
        failureCode: failure.code,
        failureMessage: failure.message,
      });
      return failed;
    }
  }

  private enrichStopsBestEffort(job: StrollCurationJob): void {
    void this.persistence.enrichStops?.(job.userId, job.strollId).catch((error) => {
      console.error("stroll stop enrichment failed", error);
    });
  }

  private rememberPassiveJob(userId: string, strollId: string, status: StrollStatus): JobRecord {
    const normalizedStatus: StrollCurationJobStatus = status === "curating" ? "curating" : "queued";
    const job = this.makeJob(userId, strollId, normalizedStatus);
    return { ...job, completion: Promise.resolve(null) };
  }

  private makeJob(userId: string, strollId: string, status: StrollCurationJobStatus): StrollCurationJob {
    const timestamp = nowIso();
    return {
      id: makeJobId(userId, strollId),
      userId,
      strollId,
      status,
      failureCode: null,
      failureMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  private updateJob(
    userId: string,
    strollId: string,
    patch: Pick<StrollCurationJob, "status"> & Partial<Pick<StrollCurationJob, "failureCode" | "failureMessage">>,
  ) {
    const key = this.key(userId, strollId);
    const job = this.jobsByStroll.get(key);
    if (!job) return;
    const updated: JobRecord = {
      ...job,
      ...patch,
      updatedAt: nowIso(),
    };
    this.jobsByStroll.set(key, updated);
  }

  private key(userId: string, strollId: string) {
    return `${userId}:${strollId}`;
  }
}

function toIso(value: string | Date | null | undefined) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function toNumber(value: number | string | null | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapDurableJobStatus(status: DurableJobStatus): StrollCurationJobStatus {
  if (status === "running") return "curating";
  if (status === "succeeded") return "ready";
  return status;
}

function mapDurableJobRow(row: DurableJobRow): StrollCurationJob {
  return {
    id: row.id,
    userId: row.user_id,
    strollId: row.stroll_id,
    status: mapDurableJobStatus(row.status),
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    createdAt: toIso(row.created_at) ?? "",
    updatedAt: toIso(row.updated_at) ?? "",
  };
}

export class DurableStrollCurationJobStore {
  private readonly database: PostgresDatabase;
  private readonly persistence: StrollCurationPersistence;
  private readonly runner: StrollCurationRunner;
  private readonly timeoutMs: number;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly workerId: string;
  private readonly activeCompletions = new Map<string, Promise<StrollSummary | null>>();

  constructor(options: {
    database?: PostgresDatabase;
    persistence?: StrollCurationPersistence;
    runner?: StrollCurationRunner;
    timeoutMs?: number;
    leaseMs?: number;
    heartbeatMs?: number;
    workerId?: string;
  } = {}) {
    this.database = options.database ?? getPostgresDatabase();
    this.persistence = options.persistence ?? defaultPersistence();
    this.runner = options.runner ?? defaultRunner;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.leaseMs = options.leaseMs ?? 60_000;
    this.heartbeatMs = options.heartbeatMs ?? Math.max(1_000, Math.floor(this.leaseMs / 3));
    this.workerId = options.workerId ?? `stroll-worker-${process.pid}-${randomUUID()}`;
  }

  async getStatus(userId: string, strollId: string): Promise<StrollSummary | null> {
    await this.reconcileStaleStrollStatus(userId, strollId);
    return this.persistence.getStrollSummary(userId, strollId);
  }

  async trigger(options: TriggerOptions): Promise<TriggerStrollCurationResult> {
    const mode = options.mode ?? "initial";
    await this.reconcileStaleStrollStatus(options.userId, options.strollId);
    const existing = await this.persistence.getStrollSummary(options.userId, options.strollId);
    if (!existing) {
      throw new StrollCurationConflictError(404, "stroll_not_found", "Stroll not found.");
    }

    const activeJob = await this.findActiveJob(options.userId, options.strollId);
    if (activeJob) {
      return {
        duplicate: true,
        job: mapDurableJobRow(activeJob),
        stroll: existing,
        completion: this.startJobIfClaimable(activeJob),
      };
    }

    if (mode === "retry" && existing.status !== "failed") {
      throw new StrollCurationConflictError(409, "invalid_retry_state", "Only failed Strolls can be retried.");
    }

    if (mode === "initial" && !allowedInitialStatuses.has(existing.status)) {
      throw new StrollCurationConflictError(409, "invalid_curation_state", "This Stroll cannot be queued for curation.");
    }

    const queued = await this.persistence.markQueued(options.userId, options.strollId);
    if (!queued) {
      throw new StrollCurationConflictError(404, "stroll_not_found", "Stroll not found.");
    }

    let duplicate = false;
    const job = await this.insertQueuedJob(options.userId, options.strollId, mode).catch(async (error) => {
      if (typeof error === "object" && error && "code" in error && error.code === "23505") {
        const active = await this.findActiveJob(options.userId, options.strollId);
        if (active) {
          duplicate = true;
          return active;
        }
      }
      throw error;
    });
    duplicate = duplicate || job.status !== "queued" || toNumber(job.attempt_count, 0) > 0;

    return {
      duplicate,
      job: mapDurableJobRow(job),
      stroll: queued,
      completion: this.startJobIfClaimable(job),
    };
  }

  async recoverStaleJobs(): Promise<number> {
    const recovered = await this.database.query<DurableJobRow>(
      `update stroll_curation_jobs
       set status = 'queued',
           trigger_mode = 'recovery',
           lease_owner = null,
           lease_expires_at = null,
           heartbeat_at = null,
           next_run_at = now(),
           updated_at = now()
       where status = 'running'
         and (lease_expires_at is null or lease_expires_at < now())
       returning *`,
    );

    for (const row of recovered.rows) {
      await this.persistence.markQueued(row.user_id, row.stroll_id);
      this.startJobIfClaimable(row);
    }
    return recovered.rows.length;
  }

  private async reconcileStaleStrollStatus(userId: string, strollId: string): Promise<void> {
    const active = await this.findActiveJob(userId, strollId);
    if (active) return;
    const stroll = await this.persistence.getStrollSummary(userId, strollId);
    if (stroll && activeStatuses.has(stroll.status)) {
      await this.persistence.markFailed(
        userId,
        strollId,
        "stale_curation_job",
        "Stroll curation was interrupted before a durable job could be recovered.",
      );
    }
  }

  private async findActiveJob(userId: string, strollId: string): Promise<DurableJobRow | null> {
    const result = await this.database.query<DurableJobRow>(
      `select *
       from stroll_curation_jobs
       where user_id = $1
         and stroll_id = $2
         and status in ('queued', 'running')
       order by created_at desc
       limit 1`,
      [userId, strollId],
    );
    return result.rows[0] ?? null;
  }

  private async insertQueuedJob(userId: string, strollId: string, mode: TriggerStrollCurationMode): Promise<DurableJobRow> {
    const result = await this.database.query<DurableJobRow>(
      `insert into stroll_curation_jobs (
         id,
         user_id,
         stroll_id,
         status,
         trigger_mode,
         next_run_at
       )
       values ($1, $2, $3, 'queued', $4, now())
       returning *`,
      [randomUUID(), userId, strollId, mode],
    );
    return result.rows[0];
  }

  private startJobIfClaimable(row: DurableJobRow): Promise<StrollSummary | null> {
    const existing = this.activeCompletions.get(row.id);
    if (existing) return existing;
    const completion = this.run(row.id).finally(() => {
      this.activeCompletions.delete(row.id);
    });
    this.activeCompletions.set(row.id, completion);
    return completion;
  }

  private async run(jobId: string): Promise<StrollSummary | null> {
    const claimed = await this.claimJob(jobId);
    if (!claimed) return null;

    const heartbeat = this.startHeartbeat(jobId);
    const operationRunId = isPostgresConfigured()
      ? await createOperationRun(getPostgresDatabase(), {
        operationType: "stroll_generation",
        userId: claimed.user_id,
        requestId: claimed.id,
        correlationId: claimed.stroll_id,
        entityType: "stroll",
        entityId: claimed.stroll_id,
        attemptCount: toNumber(claimed.attempt_count, 0) + 1,
        idempotencyKey: `stroll-generation:${claimed.id}`,
        inputSummary: { triggerMode: claimed.trigger_mode },
      }).catch(() => null)
      : null;
    try {
      await this.persistence.markCurating(claimed.user_id, claimed.stroll_id);
      const job = mapDurableJobRow({ ...claimed, status: "running" });
      await withTimeout(this.runner(job), this.timeoutMs);
      await this.persistence.generateStops?.(job.userId, job.strollId);
      await this.persistence.validateReady(job.userId, job.strollId);
      const ready = await this.persistence.markReady(job.userId, job.strollId);
      await this.markJobSucceeded(jobId);
      if (operationRunId) {
        await bestEffortObservability(() => completeOperationRun(getPostgresDatabase(), {
          operationRunId,
          status: "succeeded",
          outputSummary: { status: "ready" },
        }));
      }
      await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
        eventType: "stroll_generation_succeeded",
        userId: claimed.user_id,
        requestId: claimed.id,
        operationRunId,
        entityType: "stroll",
        entityId: claimed.stroll_id,
        sourceSurface: "stroll",
        outcome: "succeeded",
      }));
      this.enrichStopsBestEffort(job);
      return ready;
    } catch (error) {
      const failure = failureFromError(error);
      await this.markJobFailed(jobId, failure.code, failure.message);
      if (operationRunId) {
        await bestEffortObservability(() => completeOperationRun(getPostgresDatabase(), {
          operationRunId,
          status: "failed",
          outputSummary: { failureCode: failure.code },
        }));
      }
      await bestEffortObservability(() => recordFailureEvent(getPostgresDatabase(), {
        scope: "background_job",
        severity: "error",
        errorCode: failure.code,
        errorCategory: "stroll_generation",
        userId: claimed.user_id,
        requestId: claimed.id,
        correlationId: claimed.stroll_id,
        operationRunId,
        entityType: "stroll",
        entityId: claimed.stroll_id,
        publicMessage: "Failed to curate Stroll",
        internalMessage: failure.message,
        retryable: true,
        attemptNumber: toNumber(claimed.attempt_count, 0) + 1,
        metadata: { triggerMode: claimed.trigger_mode },
      }));
      await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
        eventType: "stroll_generation_failed",
        userId: claimed.user_id,
        requestId: claimed.id,
        operationRunId,
        entityType: "stroll",
        entityId: claimed.stroll_id,
        sourceSurface: "stroll",
        outcome: "failed",
        metadata: { failureCode: failure.code },
      }));
      return this.persistence.markFailed(claimed.user_id, claimed.stroll_id, failure.code, failure.message);
    } finally {
      heartbeat();
    }
  }

  private async claimJob(jobId: string): Promise<DurableJobRow | null> {
    const result = await this.database.query<DurableJobRow>(
      `update stroll_curation_jobs
       set status = 'running',
           attempt_count = attempt_count + 1,
           lease_owner = $2,
           lease_expires_at = now() + ($3::text || ' milliseconds')::interval,
           heartbeat_at = now(),
           started_at = coalesce(started_at, now()),
           updated_at = now()
       where id = $1
         and status in ('queued', 'running')
         and next_run_at <= now()
         and (
           status = 'queued'
           or lease_expires_at is null
           or lease_expires_at < now()
           or lease_owner = $2
         )
       returning *`,
      [jobId, this.workerId, this.leaseMs],
    );
    return result.rows[0] ?? null;
  }

  private startHeartbeat(jobId: string): () => void {
    const interval = setInterval(() => {
      void this.database.query(
        `update stroll_curation_jobs
         set heartbeat_at = now(),
             lease_expires_at = now() + ($3::text || ' milliseconds')::interval,
             updated_at = now()
         where id = $1
           and status = 'running'
           and lease_owner = $2`,
        [jobId, this.workerId, this.leaseMs],
      ).catch((error) => {
        console.error("stroll curation heartbeat failed", error);
      });
    }, this.heartbeatMs);
    interval.unref?.();
    return () => clearInterval(interval);
  }

  private async markJobSucceeded(jobId: string): Promise<void> {
    await this.database.query(
      `update stroll_curation_jobs
       set status = 'succeeded',
           lease_owner = null,
           lease_expires_at = null,
           heartbeat_at = null,
           succeeded_at = now(),
           failure_code = null,
           failure_message = null,
           updated_at = now()
       where id = $1
         and lease_owner = $2`,
      [jobId, this.workerId],
    );
  }

  private async markJobFailed(jobId: string, failureCode: string, failureMessage: string): Promise<void> {
    await this.database.query(
      `update stroll_curation_jobs
       set status = 'failed',
           lease_owner = null,
           lease_expires_at = null,
           heartbeat_at = null,
           failed_at = now(),
           failure_code = $3,
           failure_message = $4,
           updated_at = now()
       where id = $1
         and lease_owner = $2`,
      [jobId, this.workerId, failureCode, failureMessage],
    );
  }

  private enrichStopsBestEffort(job: StrollCurationJob): void {
    void this.persistence.enrichStops?.(job.userId, job.strollId).catch((error) => {
      console.error("stroll stop enrichment failed", error);
    });
  }
}

export const strollCurationJobStore = new DurableStrollCurationJobStore();
