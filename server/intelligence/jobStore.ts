import crypto from "node:crypto";
import type { IntelligenceJob, IntelligenceRequest } from "./types";
import { runIntelligencePipeline } from "./pipeline";
import { finalizeReelAnalyticsAttempt } from "../auth/postgresAuth";

export interface IntelligenceJobStore {
  create(req: IntelligenceRequest): Promise<IntelligenceJob>;
  get(id: string): Promise<IntelligenceJob | null>;
}

export class InMemoryIntelligenceJobStore implements IntelligenceJobStore {
  private readonly jobs = new Map<string, IntelligenceJob>();

  async create(req: IntelligenceRequest): Promise<IntelligenceJob> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const job: IntelligenceJob = {
      id,
      status: "queued",
      createdAtIso: now,
      updatedAtIso: now,
      error: null,
      result: null,
    };

    this.jobs.set(id, job);
    void this.run(id, req);
    return job;
  }

  async get(id: string): Promise<IntelligenceJob | null> {
    return this.jobs.get(id) || null;
  }

  private async run(id: string, req: IntelligenceRequest): Promise<void> {
    const running = this.jobs.get(id);
    if (!running) return;

    running.status = "running";
    running.updatedAtIso = new Date().toISOString();
    this.jobs.set(id, running);

    try {
      const result = await runIntelligencePipeline(req);
      if (req.analytics?.attemptId) {
        try {
          await finalizeReelAnalyticsAttempt({
            attemptId: req.analytics.attemptId,
            status: "completed",
            sourcePlatform: req.source?.metadata?.platform ? String(req.source.metadata.platform) : null,
            model: result.providerMeta?.model ?? null,
            inputTokens: result.usage?.inputTokens ?? null,
            outputTokens: result.usage?.outputTokens ?? null,
            totalTokens: result.usage?.totalTokens ?? null,
            providerLatencyMs: result.timingsMs?.provider ?? null,
            totalLatencyMs: result.timingsMs?.total ?? null,
            entityCount: Array.isArray(result.output?.structuredEntities) ? result.output.structuredEntities.length : 0,
            intelligenceStatus: result.output?.status ?? null,
            validationErrorCount: Array.isArray(result.validationErrors) ? result.validationErrors.length : 0,
          });
        } catch {
          // Analytics should not fail the job completion path.
        }
      }
      const completed = this.jobs.get(id);
      if (!completed) return;
      completed.status = "completed";
      completed.result = result;
      completed.updatedAtIso = new Date().toISOString();
      this.jobs.set(id, completed);
    } catch (error) {
      if (req.analytics?.attemptId) {
        try {
          await finalizeReelAnalyticsAttempt({
            attemptId: req.analytics.attemptId,
            status: "failed",
            sourcePlatform: req.source?.metadata?.platform ? String(req.source.metadata.platform) : null,
            failureReason: error instanceof Error ? error.message : "unknown_error",
          });
        } catch {
          // Analytics should not fail the job failure path.
        }
      }
      const failed = this.jobs.get(id);
      if (!failed) return;
      failed.status = "failed";
      failed.error = error instanceof Error ? error.message : "unknown_error";
      failed.updatedAtIso = new Date().toISOString();
      this.jobs.set(id, failed);
    }
  }
}

export const intelligenceJobStore: IntelligenceJobStore = new InMemoryIntelligenceJobStore();
