import express from "express";
import { runExtractionPipeline, type ExtractionMode } from "./extraction";
import { intelligenceJobStore, runIntelligencePipeline, type IntelligenceMode } from "./intelligence";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "wandreel-api" });
});

app.post("/api/metadata/extract", async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    const modeRaw = String(req.body?.mode || "quick").trim().toLowerCase();
    const mode: ExtractionMode = modeRaw === "deep" ? "deep" : "quick";

    if (!url) {
      return res.status(400).json({ ok: false, error: "url is required" });
    }

    const result = await runExtractionPipeline({ url, mode });
    return res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "extraction failed";
    return res.status(500).json({ ok: false, error: message });
  }
});

app.post("/api/intelligence/extract", async (req, res) => {
  try {
    const modeRaw = String(req.body?.mode || "sync").trim().toLowerCase();
    const mode: IntelligenceMode = modeRaw === "async" ? "async" : "sync";
    const source = req.body?.source;

    if (!source || typeof source !== "object") {
      return res.status(400).json({ ok: false, error: "source extraction payload is required" });
    }

    if (mode === "async") {
      const job = await intelligenceJobStore.create({ source });
      return res.status(202).json({
        ok: true,
        mode,
        jobId: job.id,
        status: job.status,
        createdAtIso: job.createdAtIso,
      });
    }

    const result = await runIntelligencePipeline({ source });
    return res.json({ ok: true, mode, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "intelligence extraction failed";
    return res.status(500).json({ ok: false, error: message });
  }
});

app.get("/api/intelligence/jobs/:jobId", async (req, res) => {
  const jobId = String(req.params.jobId || "").trim();
  if (!jobId) {
    return res.status(400).json({ ok: false, error: "jobId is required" });
  }

  const job = await intelligenceJobStore.get(jobId);
  if (!job) {
    return res.status(404).json({ ok: false, error: "job not found" });
  }

  return res.json({ ok: true, job });
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`wandreel api running on http://localhost:${port}`);
});
