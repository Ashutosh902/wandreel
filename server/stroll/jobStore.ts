import {
  getStrollSummary,
  markStrollCurating,
  markStrollFailed,
  markStrollQueued,
  markStrollReady,
  validatePersistedStrollForReady,
  enrichPersistedStrollStopDescriptions,
} from "./store";
import type { StrollStatus, StrollSummary } from "./types";

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
  validateReady: (userId: string, strollId: string) => Promise<void>;
  enrichStops?: (userId: string, strollId: string) => Promise<void>;
};

export type StrollCurationRunner = (job: StrollCurationJob) => Promise<void>;

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

export const strollCurationJobStore = new InMemoryStrollCurationJobStore();
