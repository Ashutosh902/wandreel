import crypto from "node:crypto";
import type { ExtractionResult } from "./types";
import { runExtractionPipeline } from "./pipeline";
import { createReelJob, updateReelJob } from "../auth/postgresAuth";

type ExtractionJobStatus = "queued" | "running" | "completed" | "failed";

export type ExtractionJob = {
  id: string;
  status: ExtractionJobStatus;
  createdAtIso: string;
  updatedAtIso: string;
  error: string | null;
  result: ExtractionResult | null;
};

export interface ExtractionJobStore {
  createDeep(url: string): Promise<ExtractionJob>;
  get(id: string): Promise<ExtractionJob | null>;
}

export class InMemoryExtractionJobStore implements ExtractionJobStore {
  private readonly jobs = new Map<string, ExtractionJob>();

  async createDeep(url: string): Promise<ExtractionJob> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const job: ExtractionJob = {
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
        jobType: "extraction_deep_async",
        status: "queued",
        progressJson: { stage: "extraction", mode: "deep", sourceUrl: url },
      });
    } catch {
      // Durable jobs are best-effort.
    }
    void this.run(id, url);
    return job;
  }

  async get(id: string): Promise<ExtractionJob | null> {
    return this.jobs.get(id) || null;
  }

  private async run(id: string, url: string): Promise<void> {
    const running = this.jobs.get(id);
    if (!running) return;
    running.status = "running";
    running.updatedAtIso = new Date().toISOString();
    this.jobs.set(id, running);
    try {
      await updateReelJob({
        jobId: id,
        status: "running",
        progressJson: { stage: "extraction", mode: "deep", sourceUrl: url },
      });
    } catch {
      // Durable jobs are best-effort.
    }

    try {
      const result = await runExtractionPipeline({ url, mode: "deep" });
      try {
        await updateReelJob({
          jobId: id,
          status: "completed",
          progressJson: { stage: "extraction", mode: "deep", sourceUrl: url },
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
      try {
        await updateReelJob({
          jobId: id,
          status: "failed",
          progressJson: { stage: "extraction", mode: "deep", sourceUrl: url },
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

export const extractionJobStore: ExtractionJobStore = new InMemoryExtractionJobStore();
