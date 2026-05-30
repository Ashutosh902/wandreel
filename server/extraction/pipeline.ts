import { extractMetadata } from "./metadata";
import { enrichWithFrameOcr } from "./ocr";
import { enrichWithTranscript } from "./transcript";
import { buildCombinedText } from "./combinedText";
import type { ExtractionMode, ExtractionResult } from "./types";
import { canonicalizeUrl } from "./url";
import { recordSla } from "../metrics/slaTracker";

type CacheEntry = {
  expiresAt: number;
  result: ExtractionResult;
};

const extractionCache = new Map<string, CacheEntry>();
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_METADATA_BUDGET_MS = 12000;
const DEFAULT_TRANSCRIPT_BUDGET_MS = 8000;
const DEFAULT_OCR_BUDGET_MS = 8000;

function getNumberEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function nowMs(): number {
  return Date.now();
}

async function withBudget<T>(work: Promise<T>, budgetMs: number, fallback: () => T): Promise<T> {
  let timedOut = false;
  const timeout = new Promise<T>((resolve) => {
    setTimeout(() => {
      timedOut = true;
      resolve(fallback());
    }, budgetMs);
  });
  const result = await Promise.race([work, timeout]);
  return timedOut ? fallback() : result;
}

function cloneResult(result: ExtractionResult): ExtractionResult {
  return JSON.parse(JSON.stringify(result)) as ExtractionResult;
}

function isLowSignalInstagramResult(result: ExtractionResult): boolean {
  if (result.metadata.platform !== "instagram") return false;
  const title = String(result.metadata.title || "").trim().toLowerCase();
  const description = String(result.metadata.description || "").trim().toLowerCase();
  if (title === "instagram") return true;
  if (!description) return true;
  if (description.includes("create an account or log in to instagram")) return true;
  return false;
}

export async function runExtractionPipeline(input: { url: string; mode: ExtractionMode }): Promise<ExtractionResult> {
  const cacheTtlMs = getNumberEnv("EXTRACTION_CACHE_TTL_MS", DEFAULT_CACHE_TTL_MS);
  const cacheKey = `${input.mode}:${canonicalizeUrl(input.url)}`;
  const cached = extractionCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs()) {
    const cachedResult = cloneResult(cached.result);
    cachedResult.cache = { hit: true, key: cacheKey };
    return cachedResult;
  }

  const totalStartedAt = nowMs();
  const metadataStartedAt = nowMs();
  let metadataFailureReason: string | null = null;
  const metadata = await withBudget(
    extractMetadata(input.url),
    getNumberEnv("EXTRACTION_METADATA_BUDGET_MS", DEFAULT_METADATA_BUDGET_MS),
    () => ({
      sourceUrl: input.url,
      canonicalUrl: canonicalizeUrl(input.url),
      platform: "web" as const,
      title: "Untitled",
      description: "",
      siteName: null,
      imageUrl: null,
      fetchedAtIso: new Date().toISOString(),
      provider: "html" as const,
    }),
  ).catch((error: unknown) => {
    metadataFailureReason = error instanceof Error ? error.message : "metadata_failed";
    return {
      sourceUrl: input.url,
      canonicalUrl: canonicalizeUrl(input.url),
      platform: "web" as const,
      title: "Untitled",
      description: "",
      siteName: null,
      imageUrl: null,
      fetchedAtIso: new Date().toISOString(),
      provider: "html" as const,
    };
  });
  const metadataMs = nowMs() - metadataStartedAt;

  if (input.mode === "quick") {
    const combined = buildCombinedText({ metadata, transcript: null, ocr: null });
    const metadataStatus = metadataFailureReason ? "partial" : "success";
    const captionText = String(metadata.description || "").trim();
    const quickResult: ExtractionResult = {
      mode: input.mode,
      metadata,
      transcript: null,
      ocr: null,
      source: metadata.sourceUrl,
      platform: metadata.platform,
      canonicalUrl: metadata.canonicalUrl,
      stageStatus: {
        basicMetadata: metadataStatus,
        caption: captionText ? "success" : "partial",
        transcript: "partial",
        ocr: "partial",
      },
      stages: {
        basicMetadata: {
          status: metadataStatus,
          provider: metadata.provider,
          reason: metadataFailureReason,
          chars: [metadata.title, metadata.description].join(" ").trim().length,
        },
        caption: {
          status: captionText ? "success" : "partial",
          provider: metadata.provider,
          reason: captionText ? null : "caption_not_available",
          chars: captionText.length,
        },
        transcript: {
          status: "partial",
          provider: "not_attempted_quick_mode",
          reason: "quick_mode",
          chars: 0,
        },
        ocr: {
          status: "partial",
          provider: "not_attempted_quick_mode",
          reason: "quick_mode",
          chars: 0,
        },
      },
      stageTimingsMs: {
        basicMetadata: metadataMs,
        caption: 0,
        transcript: 0,
        ocr: 0,
      },
      stageFailures: metadataFailureReason ? { basicMetadata: metadataFailureReason } : {},
      ...combined,
      perf: {
        totalMs: nowMs() - totalStartedAt,
        metadataMs,
        transcriptMs: 0,
        ocrMs: 0,
      },
      sla: {
        totalMs: nowMs() - totalStartedAt,
        metadataMs,
        transcriptMs: 0,
        ocrMs: 0,
      },
      cache: { hit: false, key: cacheKey },
    };
    if (!isLowSignalInstagramResult(quickResult)) {
      extractionCache.set(cacheKey, { expiresAt: nowMs() + cacheTtlMs, result: cloneResult(quickResult) });
    }
    const agg = recordSla("extraction.total", quickResult.sla?.totalMs ?? quickResult.perf?.totalMs ?? 0);
    if (Number(process.env.EXTRACTION_SLA_LOG_EVERY || 0) > 0 && agg.sampleSize % Number(process.env.EXTRACTION_SLA_LOG_EVERY) === 0) {
      console.info("[sla][extraction.total]", { p50: agg.p50, p95: agg.p95, sampleSize: agg.sampleSize });
    }
    return quickResult;
  }

  const transcriptStartedAt = nowMs();
  const ocrStartedAt = nowMs();
  const [transcript, ocr] = await Promise.all([
    withBudget(
      enrichWithTranscript(metadata),
      getNumberEnv("EXTRACTION_TRANSCRIPT_BUDGET_MS", DEFAULT_TRANSCRIPT_BUDGET_MS),
      () => ({ attempted: true, used: false, source: null, text: "", reason: "timeout" }),
    ),
    withBudget(
      enrichWithFrameOcr(metadata),
      getNumberEnv("EXTRACTION_OCR_BUDGET_MS", DEFAULT_OCR_BUDGET_MS),
      () => ({ attempted: true, used: false, text: "", reason: "timeout" }),
    ),
  ]);
  const transcriptMs = nowMs() - transcriptStartedAt;
  const ocrMs = nowMs() - ocrStartedAt;

  const result: ExtractionResult = {
    mode: input.mode,
    metadata,
    transcript,
    ocr,
    source: metadata.sourceUrl,
    platform: metadata.platform,
    canonicalUrl: metadata.canonicalUrl,
    stageStatus: {
      basicMetadata: metadataFailureReason ? "partial" : "success",
      caption: String(metadata.description || "").trim() ? "success" : "partial",
      transcript: transcript.used ? "success" : transcript.attempted ? "partial" : "failed",
      ocr: ocr.used ? "success" : ocr.attempted ? "partial" : "failed",
    },
    stages: {
      basicMetadata: {
        status: metadataFailureReason ? "partial" : "success",
        provider: metadata.provider,
        reason: metadataFailureReason,
        chars: [metadata.title, metadata.description].join(" ").trim().length,
      },
      caption: {
        status: String(metadata.description || "").trim() ? "success" : "partial",
        provider: metadata.provider,
        reason: String(metadata.description || "").trim() ? null : "caption_not_available",
        chars: String(metadata.description || "").trim().length,
      },
      transcript: {
        status: transcript.used ? "success" : transcript.attempted ? "partial" : "failed",
        provider: transcript.source || "none",
        reason: transcript.reason,
        chars: String(transcript.text || "").trim().length,
      },
      ocr: {
        status: ocr.used ? "success" : ocr.attempted ? "partial" : "failed",
        provider: "frame_ocr",
        reason: ocr.reason,
        chars: String(ocr.text || "").trim().length,
      },
    },
    stageTimingsMs: {
      basicMetadata: metadataMs,
      caption: 0,
      transcript: transcriptMs,
      ocr: ocrMs,
    },
    stageFailures: {
      ...(metadataFailureReason ? { basicMetadata: metadataFailureReason } : {}),
      ...(transcript.reason && !transcript.used ? { transcript: transcript.reason } : {}),
      ...(ocr.reason && !ocr.used ? { ocr: ocr.reason } : {}),
    },
    ...buildCombinedText({ metadata, transcript, ocr }),
    perf: {
      totalMs: nowMs() - totalStartedAt,
      metadataMs,
      transcriptMs,
      ocrMs,
    },
    sla: {
      totalMs: nowMs() - totalStartedAt,
      metadataMs,
      transcriptMs,
      ocrMs,
    },
    cache: { hit: false, key: cacheKey },
  };

  if (!isLowSignalInstagramResult(result)) {
    extractionCache.set(cacheKey, { expiresAt: nowMs() + cacheTtlMs, result: cloneResult(result) });
  }
  const agg = recordSla("extraction.total", result.sla?.totalMs ?? result.perf?.totalMs ?? 0);
  if (Number(process.env.EXTRACTION_SLA_LOG_EVERY || 0) > 0 && agg.sampleSize % Number(process.env.EXTRACTION_SLA_LOG_EVERY) === 0) {
    console.info("[sla][extraction.total]", { p50: agg.p50, p95: agg.p95, sampleSize: agg.sampleSize });
  }
  return result;
}
