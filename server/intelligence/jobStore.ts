import crypto from "node:crypto";
import type { IntelligenceJob, IntelligenceRequest } from "./types";
import { runIntelligencePipeline } from "./pipeline";

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
      const completed = this.jobs.get(id);
      if (!completed) return;
      completed.status = "completed";
      completed.result = result;
      completed.updatedAtIso = new Date().toISOString();
      this.jobs.set(id, completed);
    } catch (error) {
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
