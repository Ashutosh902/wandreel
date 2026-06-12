import crypto from "node:crypto";
import type { IntelligenceJob, IntelligenceRequest } from "./types";
import { runIntelligencePipeline } from "./pipeline";
import {
  createReelJob,
  finalizeReelAnalyticsAttempt,
  persistReelAnalyticsAttemptArtifacts,
  updateReelJob,
  upsertReelAnalyticsEntities,
} from "../auth/postgresAuth";
import { saveAttemptHypothesisSummary } from "../attemptHypothesisStore";
import { buildAttemptHypothesisSummary } from "./hypothesisSummary";

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
    try {
      await createReelJob({
        jobId: id,
        runId: req.analytics?.runId ?? null,
        attemptId: req.analytics?.attemptId ?? null,
        attemptNumber: req.analytics?.attemptNumber ?? null,
        jobType: req.analytics?.triggerType === "retry" ? "intelligence_retry_async" : "intelligence_async",
        status: "queued",
        progressJson: {
          stage: "intelligence",
          sourcePlatform: req.source?.metadata?.platform ?? null,
        },
      });
    } catch {
      // Durable jobs are best-effort.
    }
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
      await updateReelJob({
        jobId: id,
        status: "running",
        progressJson: {
          stage: "intelligence",
          sourcePlatform: req.source?.metadata?.platform ?? null,
        },
      });
    } catch {
      // Durable jobs are best-effort.
    }

    try {
      const result = await runIntelligencePipeline(req);
      const hypothesisSummary = req.analytics?.attemptNumber
        ? buildAttemptHypothesisSummary({
            source: req.source,
            result,
            attemptNumber: req.analytics.attemptNumber,
          })
        : null;
      if (req.analytics?.attemptNumber && hypothesisSummary) {
        saveAttemptHypothesisSummary({
          mode: req.source.mode === "deep" ? "deep" : "quick",
          url: req.source.canonicalUrl || req.source.metadata?.canonicalUrl || req.source.metadata?.sourceUrl || req.source.source,
          attemptNumber: req.analytics.attemptNumber,
          summary: hypothesisSummary,
        });
      }
      if (req.analytics?.attemptId) {
        try {
          await persistReelAnalyticsAttemptArtifacts({
            attemptId: req.analytics.attemptId,
            intelligenceResult: result,
            hypothesisSummary,
          });
        } catch {
          // Attempt artifacts are best-effort.
        }
      }
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
      if (req.analytics?.runId && req.analytics?.attemptId && req.analytics?.attemptNumber) {
        try {
          await upsertReelAnalyticsEntities({
            runId: req.analytics.runId,
            attemptId: req.analytics.attemptId,
            attemptNumber: req.analytics.attemptNumber,
            entities: (result.output?.structuredEntities || []).map((entity, index) => ({
              entityIndex: index,
              entityType: typeof entity.category === "string" ? entity.category : null,
              title: typeof entity.name === "string" ? entity.name : null,
              subtitle:
                (typeof entity.locality === "string" && entity.locality) ||
                (typeof entity.city === "string" && entity.city) ||
                (typeof entity.address === "string" && entity.address) ||
                null,
              placeCandidateId:
                typeof entity.placeId === "string"
                  ? entity.placeId
                  : typeof entity.googleMapsQuery === "string"
                    ? entity.googleMapsQuery
                    : null,
              finalPlaceId: typeof entity.placeId === "string" ? entity.placeId : null,
              confidence:
                typeof entity.confidence === "number"
                  ? entity.confidence
                  : entity.confidence === "high"
                    ? 0.9
                    : entity.confidence === "medium"
                      ? 0.6
                      : entity.confidence === "low"
                        ? 0.3
                        : null,
              metadataJson: entity as unknown as Record<string, unknown>,
            })),
          });
        } catch {
          // Entity analytics should not fail the job completion path.
        }
      }
      try {
        await updateReelJob({
          jobId: id,
          status: "completed",
          progressJson: {
            stage: "intelligence",
            sourcePlatform: req.source?.metadata?.platform ?? null,
            entityCount: Array.isArray(result.output?.structuredEntities) ? result.output.structuredEntities.length : 0,
          },
          resultJson: result as unknown as Record<string, unknown>,
          errorMessage: null,
        });
      } catch {
        // Durable jobs are best-effort.
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
      try {
        await updateReelJob({
          jobId: id,
          status: "failed",
          progressJson: {
            stage: "intelligence",
            sourcePlatform: req.source?.metadata?.platform ?? null,
          },
          errorMessage: error instanceof Error ? error.message : "unknown_error",
        });
      } catch {
        // Durable jobs are best-effort.
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
