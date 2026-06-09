import { extractMetadata } from "./metadata";
import { selectSourceScreenshotsDetailed } from "./frameSelection";
import { enrichWithFrameOcr } from "./ocr";
import { enrichWithTranscript } from "./transcript";
import { runVisualFallback } from "./visualFallback";
import { buildCombinedText } from "./combinedText";
import type { ExtractionMode, ExtractionResult, OcrResult, ScreenshotAsset, VisualFallbackResult } from "./types";
import { canonicalizeUrl } from "./url";
import { recordSla } from "../metrics/slaTracker";

type CacheEntry = {
  expiresAt: number;
  result: ExtractionResult;
};

const extractionCache = new Map<string, CacheEntry>();
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_METADATA_BUDGET_MS = 12000;
const DEFAULT_TRANSCRIPT_BUDGET_MS = 60000;
const DEFAULT_OCR_BUDGET_MS = 20000;
const DEFAULT_VISUAL_FALLBACK_BUDGET_MS = 45000;

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

function isTraceEnabled(debugEnabled: boolean): boolean {
  return debugEnabled || String(process.env.EXTRACTION_DEBUG_TRACE || "").toLowerCase() === "true";
}

function summarizeScreenshot(shot: ScreenshotAsset): Record<string, unknown> {
  return {
    origin: shot.origin,
    label: shot.label,
    timestampSec: shot.timestampSec ?? null,
    sizeBytes: shot.sizeBytes ?? (shot.url.startsWith("data:") ? Math.round(shot.url.length * 0.75) : null),
    sourcePath: shot.sourcePath ?? null,
    urlKind: shot.url.startsWith("data:") ? "data_url" : "remote_url",
  };
}

function buildExtractionDebug(input: {
  metadata: ExtractionResult["metadata"];
  metadataFailureReason: string | null;
  screenshotsDebug?: Record<string, unknown> | null;
  screenshots?: ScreenshotAsset[];
  ocr: OcrResult | null;
  visualFallback: VisualFallbackResult | null;
}): Record<string, unknown> {
  const selectedCandidate = input.visualFallback?.selectedCandidate || null;
  return {
    mediaIngestion: {
      platform: input.metadata.platform,
      canonicalUrl: input.metadata.canonicalUrl,
      metadataProvider: input.metadata.provider,
      mediaUrlAvailable: Boolean((input.screenshotsDebug?.mediaIngestion as any)?.mediaUrlAvailable),
      thumbnailImageUrlAvailable: Boolean(input.metadata.imageUrl),
      metadataFailureReason: input.metadataFailureReason,
    },
    frameExtraction: input.screenshotsDebug?.frameExtraction || {
      didRun: false,
      reason: "not_attempted",
    },
    screenshots: input.screenshotsDebug?.screenshots || {
      count: input.screenshots?.length || 0,
      sentCandidates: (input.screenshots || []).map(summarizeScreenshot),
    },
    ocr: {
      attempted: input.ocr?.attempted ?? false,
      used: input.ocr?.used ?? false,
      text: input.ocr?.text || "",
      reason: input.ocr?.reason || null,
      confidence: null,
      sourceImages: (input.screenshots || []).map(summarizeScreenshot),
    },
    visualRecognition: input.visualFallback?.debug?.visualRecognition || {
      didRun: false,
      reason: input.visualFallback?.reason || "not_attempted",
    },
    candidateVerification: input.visualFallback?.debug?.candidateVerification || [],
    finalOutput: {
      selectedCandidate,
      possibleMatches:
        (input.visualFallback?.debug?.selection as any)?.possibleMatches ||
        input.visualFallback?.candidates?.slice(0, 3) ||
        [],
      finalEntity: selectedCandidate
        ? {
            name: selectedCandidate.candidateName || selectedCandidate.query,
            aliases: selectedCandidate.aliases || [],
            locality: selectedCandidate.locality,
            city: selectedCandidate.city,
            state: selectedCandidate.state,
            country: selectedCandidate.country,
            formattedAddress: selectedCandidate.formattedAddress,
          }
        : null,
      needsReview: input.visualFallback?.needsReview ?? true,
      locationVerified: selectedCandidate?.locationVerified ?? false,
      confidence: input.visualFallback?.confidence || "low",
      summaryText: input.visualFallback?.summaryText || "",
    },
  };
}

export async function runExtractionPipeline(input: { url: string; mode: ExtractionMode; debug?: boolean }): Promise<ExtractionResult> {
  const debugEnabled = Boolean(input.debug);
  const traceEnabled = isTraceEnabled(debugEnabled);
  const cacheTtlMs = getNumberEnv("EXTRACTION_CACHE_TTL_MS", DEFAULT_CACHE_TTL_MS);
  const cacheKey = `${input.mode}:${canonicalizeUrl(input.url)}`;
  const cached = extractionCache.get(cacheKey);
  if (!debugEnabled && cached && cached.expiresAt > nowMs()) {
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
      visualFallback: null,
      source: metadata.sourceUrl,
      platform: metadata.platform,
      canonicalUrl: metadata.canonicalUrl,
      stageStatus: {
        basicMetadata: metadataStatus,
        caption: captionText ? "success" : "partial",
        transcript: "partial",
        ocr: "partial",
        visualFallback: "partial",
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
        visualFallback: {
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
        visualFallback: 0,
      },
      stageFailures: metadataFailureReason ? { basicMetadata: metadataFailureReason } : {},
      ...combined,
      perf: {
        totalMs: nowMs() - totalStartedAt,
        metadataMs,
        transcriptMs: 0,
        ocrMs: 0,
        visualFallbackMs: 0,
      },
      sla: {
        totalMs: nowMs() - totalStartedAt,
        metadataMs,
        transcriptMs: 0,
        ocrMs: 0,
        visualFallbackMs: 0,
      },
      cache: { hit: false, key: cacheKey },
    };
    if (debugEnabled || traceEnabled) {
      quickResult.debug = buildExtractionDebug({
        metadata,
        metadataFailureReason,
        screenshotsDebug: null,
        screenshots: [],
        ocr: null,
        visualFallback: null,
      });
      console.info("[extraction-debug]", quickResult.debug);
    }
    if (!debugEnabled && !isLowSignalInstagramResult(quickResult)) {
      extractionCache.set(cacheKey, { expiresAt: nowMs() + cacheTtlMs, result: cloneResult(quickResult) });
    }
    const agg = recordSla("extraction.total", quickResult.sla?.totalMs ?? quickResult.perf?.totalMs ?? 0);
    if (Number(process.env.EXTRACTION_SLA_LOG_EVERY || 0) > 0 && agg.sampleSize % Number(process.env.EXTRACTION_SLA_LOG_EVERY) === 0) {
      console.info("[sla][extraction.total]", { p50: agg.p50, p95: agg.p95, sampleSize: agg.sampleSize });
    }
    return quickResult;
  }

  const transcriptStartedAt = nowMs();
  const screenshotsStartedAt = nowMs();
  const transcriptPromise = withBudget(
    enrichWithTranscript(metadata),
    getNumberEnv("EXTRACTION_TRANSCRIPT_BUDGET_MS", DEFAULT_TRANSCRIPT_BUDGET_MS),
    () => ({ attempted: true, used: false, source: null, text: "", reason: "timeout" }),
  );
  const screenshotsPromise = withBudget(
    selectSourceScreenshotsDetailed(metadata),
    getNumberEnv("EXTRACTION_VISUAL_FALLBACK_BUDGET_MS", DEFAULT_VISUAL_FALLBACK_BUDGET_MS),
    () => ({
      screenshots: [],
      debug: {
        mediaIngestion: {
          platform: metadata.platform,
          canonicalUrl: metadata.canonicalUrl,
          metadataProvider: metadata.provider,
          mediaUrlAvailable: false,
          thumbnailImageUrlAvailable: Boolean(metadata.imageUrl),
        },
        frameExtraction: {
          didRun: metadata.platform === "youtube" || metadata.platform === "instagram",
          ok: false,
          error: "timeout",
          count: 0,
        },
        screenshots: {
          count: 0,
          videoFrameCount: 0,
          metadataImageCount: 0,
          sentCandidates: [],
        },
      },
    }),
  );
  const [transcript, screenshotSelection] = await Promise.all([transcriptPromise, screenshotsPromise]);
  const screenshots = screenshotSelection.screenshots;
  const screenshotsDebug = screenshotSelection.debug;
  const screenshotsMs = nowMs() - screenshotsStartedAt;
  const ocrStartedAt = nowMs();
  const ocr = await withBudget(
    enrichWithFrameOcr(metadata, screenshots),
    getNumberEnv("EXTRACTION_OCR_BUDGET_MS", DEFAULT_OCR_BUDGET_MS),
    () => ({ attempted: true, used: false, text: "", reason: "timeout" }),
  );
  const transcriptMs = nowMs() - transcriptStartedAt;
  const ocrMs = nowMs() - ocrStartedAt;
  const visualFallbackStartedAt = nowMs();
  const visualFallback = await withBudget(
    runVisualFallback({ metadata, transcript, ocr, screenshots }),
    getNumberEnv("EXTRACTION_VISUAL_FALLBACK_BUDGET_MS", DEFAULT_VISUAL_FALLBACK_BUDGET_MS),
    () => ({
      attempted: true,
      triggered: true,
      reason: "timeout",
      provider: "shared_visual_fallback" as const,
      confidence: "low" as const,
      needsReview: true,
      screenshots: [],
      textQueries: [],
      visualQueries: [],
      candidates: [],
      selectedCandidate: null,
      summaryText: "Visual fallback timed out before producing verified candidates.",
    }),
  );
  const visualFallbackMs = nowMs() - visualFallbackStartedAt;

  const result: ExtractionResult = {
    mode: input.mode,
    metadata,
    transcript,
    ocr,
    visualFallback,
    source: metadata.sourceUrl,
    platform: metadata.platform,
    canonicalUrl: metadata.canonicalUrl,
    stageStatus: {
      basicMetadata: metadataFailureReason ? "partial" : "success",
      caption: String(metadata.description || "").trim() ? "success" : "partial",
      transcript: transcript.used ? "success" : transcript.attempted ? "partial" : "failed",
      ocr: ocr.used ? "success" : ocr.attempted ? "partial" : "failed",
      visualFallback: !visualFallback.triggered ? "partial" : visualFallback.selectedCandidate ? "success" : visualFallback.attempted ? "partial" : "failed",
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
      visualFallback: {
        status: !visualFallback.triggered ? "partial" : visualFallback.selectedCandidate ? "success" : visualFallback.attempted ? "partial" : "failed",
        provider: visualFallback.provider,
        reason: visualFallback.reason,
        chars: String(visualFallback.summaryText || "").trim().length,
      },
    },
    stageTimingsMs: {
      basicMetadata: metadataMs,
      caption: 0,
      transcript: transcriptMs,
      ocr: ocrMs,
      visualFallback: visualFallbackMs,
    },
    stageFailures: {
      ...(metadataFailureReason ? { basicMetadata: metadataFailureReason } : {}),
      ...(transcript.reason && !transcript.used ? { transcript: transcript.reason } : {}),
      ...(ocr.reason && !ocr.used ? { ocr: ocr.reason } : {}),
      ...(visualFallback.reason && !visualFallback.selectedCandidate ? { visualFallback: visualFallback.reason } : {}),
    },
    ...buildCombinedText({ metadata, transcript, ocr }),
    perf: {
      totalMs: nowMs() - totalStartedAt,
      metadataMs,
      transcriptMs: Math.max(transcriptMs, screenshotsMs),
      ocrMs,
      visualFallbackMs,
    },
    sla: {
      totalMs: nowMs() - totalStartedAt,
      metadataMs,
      transcriptMs: Math.max(transcriptMs, screenshotsMs),
      ocrMs,
      visualFallbackMs,
    },
    cache: { hit: false, key: cacheKey },
  };

  if (debugEnabled || traceEnabled) {
    result.debug = buildExtractionDebug({
      metadata,
      metadataFailureReason,
      screenshotsDebug,
      screenshots,
      ocr,
      visualFallback,
    });
    console.info("[extraction-debug]", result.debug);
  }

  if (!debugEnabled && !isLowSignalInstagramResult(result)) {
    extractionCache.set(cacheKey, { expiresAt: nowMs() + cacheTtlMs, result: cloneResult(result) });
  }
  const agg = recordSla("extraction.total", result.sla?.totalMs ?? result.perf?.totalMs ?? 0);
  if (Number(process.env.EXTRACTION_SLA_LOG_EVERY || 0) > 0 && agg.sampleSize % Number(process.env.EXTRACTION_SLA_LOG_EVERY) === 0) {
    console.info("[sla][extraction.total]", { p50: agg.p50, p95: agg.p95, sampleSize: agg.sampleSize });
  }
  return result;
}
