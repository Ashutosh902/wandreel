import { extractInstagramCommentEvidence, extractMetadata } from "./metadata";
import {
  createFrameManifest,
  loadScreenshotAssetFromManifest,
  type FrameManifestItem,
  type ScreenshotSelectionMode,
} from "./frameSelection";
import { enrichWithTranscript } from "./transcript";
import { runVisualFallback } from "./visualFallback";
import { buildCombinedText } from "./combinedText";
import { runIntelligencePipeline, runTinyCaptionIntelligence } from "../intelligence";
import { extractVisionOcrFromScreenshots } from "./visionOcr";
import type {
  ExtractionMode,
  ExtractionResult,
  ExtractionTriggerType,
  OcrResult,
  MetadataCommentEvidence,
  ScreenshotAsset,
  TranscriptResult,
  VisualFallbackResult,
} from "./types";
import { canonicalizeUrl, detectSourcePlatform } from "./url";
import { recordSla } from "../metrics/slaTracker";
import { getAttemptHypothesisSummary } from "../attemptHypothesisStore";
import fs from "node:fs/promises";

type CacheEntry = {
  expiresAt: number;
  result: ExtractionResult;
};

type StageDecision = {
  stage: "description" | "transcript" | "ocr" | "visualFallback";
  ran: boolean;
  reason: string;
};

type OrchestrationTrace = {
  attemptNumber: number;
  triggerType: ExtractionTriggerType;
  sourcePlatform: ExtractionResult["metadata"]["platform"];
  route: "quick" | "attempt_1" | "retry_1" | "retry_2";
  transcriptReused?: boolean;
  ocrFrameCount?: number;
  visualFrameCount?: number;
  decisions: StageDecision[];
  acceptedAfter: "description" | "transcript" | "ocr" | "visualFallback" | "manual_review";
  inheritedEvidence?: {
    transcriptAttempts: number[];
    ocrAttempts: number[];
    hypothesisAttempts?: number[];
  };
};

type LlmConfidenceProbe = {
  accepted: boolean;
  confidence: "high" | "medium" | "low";
  status: string | null;
  entityCount: number;
};

type StructuredFastPathDecision = LlmConfidenceProbe & {
  result: import("../intelligence/types").IntelligencePipelineResult;
  model: string | null;
};

type ExtractionDebugTimings = {
  metadataFetchMs: number;
  metadataMs: number;
  commentsMs: number;
  descriptionFastExtractorMs: number;
  descriptionProbeMs: number;
  transcriptProbeMs: number;
  transcriptMs: number;
  frameExtractionMs: number;
  ocrOnlyMs: number;
  ocrMs: number;
  visualFallbackOnlyMs: number;
  visualFallbackMs: number;
  extractionTotalMs: number;
  llmCallsBeforeResponse: number;
};

type ProbeFailureContext = {
  stage: "description" | "transcript";
  mode: ExtractionMode;
  attemptNumber: number;
  triggerType: ExtractionTriggerType;
  metadata: ExtractionResult["metadata"];
};

type AttemptVisualFallbackPolicy = {
  includeVisual: boolean;
  decisionReason: string;
};

const extractionCache = new Map<string, CacheEntry>();
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_METADATA_BUDGET_MS = 12000;
const DEFAULT_TRANSCRIPT_BUDGET_MS = 60000;
const DEFAULT_COMMENT_BUDGET_MS = 1500;

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

function buildCommentTimeoutEvidence(): MetadataCommentEvidence {
  return {
    attempted: true,
    timedOut: true,
    pinnedComment: null,
    topComments: [],
    provider: "instagram_script",
    reason: "timeout",
  };
}

function cloneResult(result: ExtractionResult): ExtractionResult {
  return JSON.parse(JSON.stringify(result)) as ExtractionResult;
}

function buildAttemptCacheKey(mode: ExtractionMode, url: string, attemptNumber: number): string {
  return `${mode}:a${attemptNumber}:${canonicalizeUrl(url)}`;
}

function buildSharedCacheKey(mode: ExtractionMode, url: string): string {
  return `${mode}:${canonicalizeUrl(url)}`;
}

export function getAttemptVisualFallbackPolicy(attemptNumber: number): AttemptVisualFallbackPolicy {
  if (attemptNumber >= 3) {
    return {
      includeVisual: true,
      decisionReason: "retry_2_visual_default_final_attempt",
    };
  }
  if (attemptNumber === 2) {
    return {
      includeVisual: false,
      decisionReason: "retry_1_skips_visual_fallback",
    };
  }
  return {
    includeVisual: false,
    decisionReason: "initial_attempt_only",
  };
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

function normalizeAttemptNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 1) return 1;
  if (parsed >= 3) return 3;
  return 2;
}

function normalizeTriggerType(value: unknown): ExtractionTriggerType {
  return value === "retry" ? "retry" : "initial";
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

function isWeakDescription(metadata: ExtractionResult["metadata"]): boolean {
  const title = String(metadata.title || "").trim();
  const description = String(metadata.description || "").trim();
  const combined = `${title}\n${description}`.replace(/\s+/g, " ").trim().toLowerCase();
  if (!combined) return true;
  if (description.length < 24) return true;
  if (combined === "instagram") return true;
  if (combined.includes("create an account or log in to instagram")) return true;
  if (/^\s*(dm|comment|follow|save|share)\b/i.test(description)) return true;
  return false;
}

function hasMeaningfulOcr(ocr: OcrResult | null): boolean {
  return Boolean(String(ocr?.text || "").trim().length >= 12);
}

function hasMeaningfulTranscript(transcript: TranscriptResult | null): boolean {
  return Boolean(String(transcript?.text || "").trim().length >= 12);
}

function getBestEntityConfidence(source: {
  output?: {
    structuredEntities?: Array<{ confidence?: string | null }>;
  };
}): "high" | "medium" | "low" {
  const entities = Array.isArray(source.output?.structuredEntities) ? source.output?.structuredEntities : [];
  const labels = entities.map((item) => String(item?.confidence || "").trim().toLowerCase());
  if (labels.includes("high")) return "high";
  if (labels.includes("medium")) return "medium";
  return "low";
}

function isUsefulStructuredResult(result: import("../intelligence/types").IntelligencePipelineResult): LlmConfidenceProbe {
  const confidence = getBestEntityConfidence(result);
  const status = result.output?.status ?? null;
  const entityCount = Array.isArray(result.output?.structuredEntities)
    ? result.output.structuredEntities.length
    : 0;

  return {
    accepted: (confidence === "high" || confidence === "medium") && status !== "no_supported_entity_found",
    confidence,
    status,
    entityCount,
  };
}

async function runStructuredFastPathDecision(input: {
  metadata: ExtractionResult["metadata"];
  mode: ExtractionMode;
  attemptNumber: number;
  triggerType: ExtractionTriggerType;
  transcript?: TranscriptResult | null;
  ocr?: OcrResult | null;
}): Promise<StructuredFastPathDecision> {
  const probeSource: ExtractionResult = {
    mode: input.mode,
    metadata: input.metadata,
    transcript: input.transcript ?? { attempted: false, used: false, source: null, text: "", reason: "not_attempted" },
    ocr: input.ocr ?? { attempted: false, used: false, text: "", reason: "not_attempted" },
    visualFallback: {
      attempted: false,
      triggered: false,
      reason: "not_attempted",
      provider: "shared_visual_fallback",
      confidence: "low",
      needsReview: true,
      screenshots: [],
      textQueries: [],
      visualQueries: [],
      candidates: [],
      selectedCandidate: null,
      summaryText: "",
    },
    attemptInfo: {
      attemptNumber: input.attemptNumber,
      triggerType: input.triggerType,
    },
    source: input.metadata.sourceUrl,
    platform: input.metadata.platform,
    canonicalUrl: input.metadata.canonicalUrl,
    ...buildCombinedText({
      metadata: input.metadata,
      transcript: input.transcript ?? null,
      ocr: input.ocr ?? null,
    }),
  };

  const intelligence = await runIntelligencePipeline({
    source: probeSource,
    analytics: {
      attemptNumber: input.attemptNumber,
      triggerType: input.triggerType,
    },
  });
  return {
    ...isUsefulStructuredResult(intelligence),
    result: intelligence,
    model: intelligence.providerMeta?.model || null,
  };
}

async function runTinyCaptionFastPathDecision(input: {
  metadata: ExtractionResult["metadata"];
  mode: ExtractionMode;
  attemptNumber: number;
  triggerType: ExtractionTriggerType;
}): Promise<StructuredFastPathDecision> {
  const probeSource: ExtractionResult = {
    mode: input.mode,
    metadata: input.metadata,
    transcript: { attempted: false, used: false, source: null, text: "", reason: "not_attempted" },
    ocr: { attempted: false, used: false, text: "", reason: "not_attempted" },
    visualFallback: {
      attempted: false,
      triggered: false,
      reason: "not_attempted",
      provider: "shared_visual_fallback",
      confidence: "low",
      needsReview: true,
      screenshots: [],
      textQueries: [],
      visualQueries: [],
      candidates: [],
      selectedCandidate: null,
      summaryText: "",
    },
    attemptInfo: {
      attemptNumber: input.attemptNumber,
      triggerType: input.triggerType,
    },
    source: input.metadata.sourceUrl,
    platform: input.metadata.platform,
    canonicalUrl: input.metadata.canonicalUrl,
    ...buildCombinedText({
      metadata: input.metadata,
      transcript: null,
      ocr: null,
    }),
  };

  const intelligence = await runTinyCaptionIntelligence({
    source: probeSource,
    analytics: {
      attemptNumber: input.attemptNumber,
      triggerType: input.triggerType,
    },
  });

  return {
    ...isUsefulStructuredResult(intelligence),
    result: intelligence,
    model: intelligence.providerMeta?.model || null,
  };
}

function isOpenAiConnectionProbeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /connection error/i.test(message);
}

function buildProbeFailureReason(context: ProbeFailureContext, error: unknown): string {
  if (isOpenAiConnectionProbeError(error)) {
    return `${context.stage}_probe_failed_openai_connection`;
  }
  return `${context.stage}_probe_failed`;
}

async function safeProbeLlmConfidence(
  input: {
    metadata: ExtractionResult["metadata"];
    mode: ExtractionMode;
    attemptNumber: number;
    triggerType: ExtractionTriggerType;
    transcript?: TranscriptResult | null;
    ocr?: OcrResult | null;
  },
  context: ProbeFailureContext,
): Promise<{ probe: LlmConfidenceProbe | null; failureReason: string | null; probeMs: number }> {
  const startedAt = nowMs();
  try {
    const probe = await runStructuredFastPathDecision(input);
    return { probe, failureReason: null, probeMs: nowMs() - startedAt };
  } catch (error) {
    const failureReason = buildProbeFailureReason(context, error);
    console.error("[extraction-probe-failed]", {
      stage: context.stage,
      reason: failureReason,
      error: error instanceof Error ? error.message : String(error || "unknown_error"),
      url: context.metadata.canonicalUrl || context.metadata.sourceUrl,
      platform: context.metadata.platform,
      mode: context.mode,
      attemptNumber: context.attemptNumber,
      triggerType: context.triggerType,
    });
    return { probe: null, failureReason, probeMs: nowMs() - startedAt };
  }
}

async function safeRunTinyFastExtractor(
  input: {
    metadata: ExtractionResult["metadata"];
    mode: ExtractionMode;
    attemptNumber: number;
    triggerType: ExtractionTriggerType;
  },
  context: ProbeFailureContext,
): Promise<{ probe: StructuredFastPathDecision | null; failureReason: string | null; probeMs: number }> {
  const startedAt = nowMs();
  try {
    const probe = await runTinyCaptionFastPathDecision(input);
    return { probe, failureReason: null, probeMs: nowMs() - startedAt };
  } catch (error) {
    const failureReason = buildProbeFailureReason(context, error);
    console.error("[tiny-fast-extractor-failed]", {
      stage: context.stage,
      reason: failureReason,
      error: error instanceof Error ? error.message : String(error || "unknown_error"),
      url: context.metadata.canonicalUrl || context.metadata.sourceUrl,
      platform: context.metadata.platform,
      mode: context.mode,
      attemptNumber: context.attemptNumber,
      triggerType: context.triggerType,
    });
    return { probe: null, failureReason, probeMs: nowMs() - startedAt };
  }
}

function buildExtractionDebug(input: {
  metadata: ExtractionResult["metadata"];
  metadataFailureReason: string | null;
  screenshotsDebug?: Record<string, unknown> | null;
  screenshots?: ScreenshotAsset[];
  ocr: OcrResult | null;
  visualFallback: VisualFallbackResult | null;
  orchestration?: OrchestrationTrace;
  priorAttemptHypotheses?: unknown[] | null;
  timings?: ExtractionDebugTimings;
  fastPath?: {
    attempted: boolean;
    accepted: boolean;
    duplicateDescriptionLlmSkipped: boolean;
    result?: unknown;
    tinyFastExtractorUsed?: boolean;
    tinyFastExtractorMs?: number;
    tinyFastExtractorAccepted?: boolean;
    tinyFastExtractorRejectedReason?: string | null;
    modelUsedForTinyExtractor?: string | null;
    fullPromptSkipped?: boolean;
  };
}): Record<string, unknown> {
  const selectedCandidate = input.visualFallback?.selectedCandidate || null;
  const platformDetectionResult = detectSourcePlatform(input.metadata.canonicalUrl);
  const instagramUrlDetectionResult = input.metadata.canonicalUrl.toLowerCase().includes("instagram.com");
  return {
    orchestration: input.orchestration || null,
    mediaIngestion: {
      platform: input.metadata.platform,
      canonicalUrl: input.metadata.canonicalUrl,
      metadataProvider: input.metadata.provider,
      platformDetectionResult,
      instagramUrlDetectionResult,
      mediaUrlAvailable: Boolean((input.screenshotsDebug?.mediaIngestion as any)?.mediaUrlAvailable),
      thumbnailImageUrlAvailable: Boolean(input.metadata.imageUrl),
      metadataFailureReason: input.metadataFailureReason,
    },
    comments: {
      attempted: Boolean(input.metadata.commentEvidence?.attempted),
      timedOut: Boolean(input.metadata.commentEvidence?.timedOut),
      provider: input.metadata.commentEvidence?.provider || null,
      reason: input.metadata.commentEvidence?.reason || null,
      pinnedCommentIncluded: Boolean(input.metadata.commentEvidence?.pinnedComment),
      topCommentCount: Array.isArray(input.metadata.commentEvidence?.topComments)
        ? input.metadata.commentEvidence?.topComments.length
        : 0,
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
    priorAttemptHypotheses: input.priorAttemptHypotheses || [],
    evidenceUsage: {
      transcriptReused: Boolean(input.orchestration?.transcriptReused),
      inheritedTranscriptAttempts: input.orchestration?.inheritedEvidence?.transcriptAttempts || [],
      inheritedOcrAttempts: input.orchestration?.inheritedEvidence?.ocrAttempts || [],
      inheritedHypothesisAttempts: input.orchestration?.inheritedEvidence?.hypothesisAttempts || [],
      ocrFrameCount: input.orchestration?.ocrFrameCount ?? 0,
      visualFrameCount: input.orchestration?.visualFrameCount ?? 0,
      route: input.orchestration?.route || null,
    },
    timings: input.timings || null,
    fastPathIntelligence: input.fastPath || null,
    tinyFastExtractorUsed: Boolean(input.fastPath?.tinyFastExtractorUsed),
    tinyFastExtractorMs: input.fastPath?.tinyFastExtractorMs ?? 0,
    tinyFastExtractorAccepted: Boolean(input.fastPath?.tinyFastExtractorAccepted),
    tinyFastExtractorRejectedReason: input.fastPath?.tinyFastExtractorRejectedReason ?? null,
    modelUsedForTinyExtractor: input.fastPath?.modelUsedForTinyExtractor ?? null,
    fullPromptSkipped: Boolean(input.fastPath?.fullPromptSkipped),
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

async function readMetadata(inputUrl: string, options?: { mode?: ExtractionMode; attemptNumber?: number }) {
  let metadataFailureReason: string | null = null;
  const metadataStartedAt = nowMs();
  const canonicalUrl = canonicalizeUrl(inputUrl);
  const detectedPlatform = detectSourcePlatform(canonicalUrl);
  const metadataFetchStartedAt = nowMs();
  const commentsStartedAt = nowMs();
  let commentsMs = 0;
  const commentsPromise =
    detectedPlatform === "instagram" &&
    options?.mode === "deep" &&
    Number(options?.attemptNumber || 1) === 1
      ? withBudget(
          extractInstagramCommentEvidence(inputUrl),
          getNumberEnv("EXTRACTION_COMMENT_BUDGET_MS", DEFAULT_COMMENT_BUDGET_MS),
          () => buildCommentTimeoutEvidence(),
        ).catch(() => ({
          attempted: true,
          timedOut: false,
          pinnedComment: null,
          topComments: [],
          provider: "instagram_script" as const,
          reason: "comments_unavailable",
        })).then((result) => {
          commentsMs = nowMs() - commentsStartedAt;
          return result;
        })
      : Promise.resolve<MetadataCommentEvidence | null>(null);
  const fallbackMetadata = {
    sourceUrl: inputUrl,
    canonicalUrl,
    platform: detectedPlatform,
    title: "Untitled",
    description: "",
    siteName: null,
    imageUrl: null,
    fetchedAtIso: new Date().toISOString(),
    provider: "fallback" as const,
    commentEvidence: {
      attempted: false,
      timedOut: false,
      pinnedComment: null,
      topComments: [],
      provider: "fallback" as const,
      reason: null,
    },
  };
  const metadata = await withBudget(
    extractMetadata(inputUrl),
    getNumberEnv("EXTRACTION_METADATA_BUDGET_MS", DEFAULT_METADATA_BUDGET_MS),
    () => fallbackMetadata,
  ).catch((error: unknown) => {
    metadataFailureReason = error instanceof Error ? error.message : "metadata_failed";
    return fallbackMetadata;
  });
  const metadataFetchMs = nowMs() - metadataFetchStartedAt;
  const commentEvidence = await commentsPromise;
  if (commentEvidence) {
    metadata.commentEvidence = commentEvidence;
  } else if (!metadata.commentEvidence) {
    metadata.commentEvidence = {
      attempted: false,
      timedOut: false,
      pinnedComment: null,
      topComments: [],
      provider: null,
      reason: null,
    };
  }
  return {
    metadata,
    metadataFailureReason,
    metadataMs: nowMs() - metadataStartedAt,
    metadataFetchMs,
    commentsMs,
  };
}

async function readTranscript(metadata: ExtractionResult["metadata"]): Promise<{ transcript: TranscriptResult; transcriptMs: number }> {
  const transcriptStartedAt = nowMs();
  const transcript = await withBudget(
    enrichWithTranscript(metadata),
    getNumberEnv("EXTRACTION_TRANSCRIPT_BUDGET_MS", DEFAULT_TRANSCRIPT_BUDGET_MS),
    () => ({ attempted: true, used: false, source: null, text: "", reason: "timeout" }),
  );
  return { transcript, transcriptMs: nowMs() - transcriptStartedAt };
}

function mergeOcrTexts(parts: string[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const part of parts) {
    for (const line of String(part || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      if (/^no readable text/i.test(line)) continue;
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
  }
  return lines.join("\n").trim();
}

function mergeTextBlocks(parts: Array<string | null | undefined>): string {
  return mergeOcrTexts(parts.map((part) => String(part || "")));
}

function candidateConfidenceWeight(label: string | null | undefined): number {
  if (label === "high") return 3;
  if (label === "medium") return 2;
  return 1;
}

function mergeTranscriptResults(base: TranscriptResult | null, extra: TranscriptResult | null): TranscriptResult | null {
  if (!base && !extra) return null;
  const text = mergeTextBlocks([base?.text, extra?.text]);
  return {
    attempted: Boolean(base?.attempted || extra?.attempted),
    used: Boolean(base?.used || extra?.used || text),
    source: extra?.source || base?.source || null,
    text,
    reason: text ? null : extra?.reason || base?.reason || null,
  };
}

function mergeOcrResults(base: OcrResult | null, extra: OcrResult | null): OcrResult | null {
  if (!base && !extra) return null;
  const text = mergeTextBlocks([base?.text, extra?.text]);
  return {
    attempted: Boolean(base?.attempted || extra?.attempted),
    used: Boolean(base?.used || extra?.used || text),
    text,
    reason: text ? null : extra?.reason || base?.reason || null,
  };
}

function chooseBetterVisualResult(left: VisualFallbackResult | null, right: VisualFallbackResult | null): VisualFallbackResult | null {
  if (!left) return right;
  if (!right) return left;
  const leftScore =
    (left.selectedCandidate ? 100 : 0) +
    candidateConfidenceWeight(left.confidence) * 10 +
    Number(left.selectedCandidate?.rankingScore || left.candidates?.[0]?.rankingScore || 0);
  const rightScore =
    (right.selectedCandidate ? 100 : 0) +
    candidateConfidenceWeight(right.confidence) * 10 +
    Number(right.selectedCandidate?.rankingScore || right.candidates?.[0]?.rankingScore || 0);
  return rightScore > leftScore ? right : left;
}

async function cleanupFrameManifest(tempDir: string | null, frames: FrameManifestItem[]) {
  for (const frame of frames) {
    if (!frame.sourcePath) continue;
    try {
      await fs.unlink(frame.sourcePath);
    } catch {}
  }
  if (tempDir) {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

async function processRetryFramesSequentially(input: {
  metadata: ExtractionResult["metadata"];
  transcript: TranscriptResult | null;
  selectionMode: ScreenshotSelectionMode;
  includeVisual: boolean;
  visualForceReason?: string | null;
}): Promise<{
  screenshots: ScreenshotAsset[];
  screenshotsDebug: Record<string, unknown>;
  ocr: OcrResult;
  ocrMs: number;
  frameExtractionMs: number;
  ocrOnlyMs: number;
  visualFallback: VisualFallbackResult;
  visualFallbackMs: number;
  visualFallbackOnlyMs: number;
}> {
  const startedAt = nowMs();
  const manifestStartedAt = nowMs();
  const manifest = await createFrameManifest(input.metadata, input.selectionMode);
  const frameExtractionMs = nowMs() - manifestStartedAt;
  const screenshots: ScreenshotAsset[] = [];
  const ocrParts: string[] = [];
  let ocrReason: string | null = null;
  let bestVisual: VisualFallbackResult | null = null;
  const perFrameVisualDebug: unknown[] = [];
  const perFrameOcrDebug: Array<Record<string, unknown>> = [];
  let ocrOnlyMs = 0;
  let visualFallbackOnlyMs = 0;

  try {
    for (const frame of manifest.frames) {
      const screenshot = await loadScreenshotAssetFromManifest(frame);
      if (!screenshot) continue;
      screenshots.push({
        ...screenshot,
        url: `processed://${frame.label}`,
      });

      const ocrStartedAt = nowMs();
      const ocrResult = await extractVisionOcrFromScreenshots([screenshot]);
      const ocrDurationMs = nowMs() - ocrStartedAt;
      ocrOnlyMs += ocrDurationMs;
      if (ocrResult.text.trim()) {
        ocrParts.push(ocrResult.text.trim());
      } else if (ocrResult.reason) {
        ocrReason = ocrReason ? `${ocrReason};${ocrResult.reason}` : ocrResult.reason;
      }
      perFrameOcrDebug.push({
        frame: frame.label,
        timestampSec: frame.timestampSec ?? null,
        originalWidth: frame.originalWidth ?? null,
        originalHeight: frame.originalHeight ?? null,
        resizedWidth: frame.resizedWidth ?? null,
        resizedHeight: frame.resizedHeight ?? null,
        compressedSizeBytes: frame.sizeBytes ?? screenshot.sizeBytes ?? null,
        ocrDurationMs,
        ocrTextChars: ocrResult.text.trim().length,
        ocrUsed: Boolean(ocrResult.text.trim()),
        ocrReason: ocrResult.reason ?? null,
      });

      if (input.includeVisual) {
        const aggregateOcr: OcrResult = {
          attempted: true,
          used: ocrParts.length > 0,
          text: mergeOcrTexts(ocrParts),
          reason: ocrParts.length > 0 ? null : ocrReason || "vision_ocr_empty",
        };
        const visualStartedAt = nowMs();
        const visualResult = await runVisualFallback({
          metadata: input.metadata,
          transcript: input.transcript,
          ocr: aggregateOcr,
          screenshots: [screenshot],
          forceTrigger: Boolean(input.visualForceReason),
          forceTriggerReason: input.visualForceReason ?? null,
        });
        visualFallbackOnlyMs += nowMs() - visualStartedAt;
        perFrameVisualDebug.push({
          frame: frame.label,
          timestampSec: frame.timestampSec ?? null,
          summaryText: visualResult.summaryText,
          confidence: visualResult.confidence,
          selectedCandidate: visualResult.selectedCandidate?.candidateName || null,
          reason: visualResult.reason,
        });
        bestVisual = chooseBetterVisualResult(bestVisual, visualResult);
      }

      if (frame.sourcePath) {
        try {
          await fs.unlink(frame.sourcePath);
        } catch {}
      }
    }
  } finally {
    await cleanupFrameManifest(manifest.tempDir, manifest.frames);
  }

  const mergedOcrText = mergeOcrTexts(ocrParts);
  const ocr: OcrResult = {
    attempted: true,
    used: Boolean(mergedOcrText),
    text: mergedOcrText,
    reason: mergedOcrText ? null : ocrReason || "vision_ocr_empty",
  };

  const visualFallback =
    bestVisual ||
    {
      attempted: input.includeVisual,
      triggered: input.includeVisual,
      reason: input.includeVisual ? "no_verified_candidates" : "not_attempted",
      provider: "shared_visual_fallback" as const,
      confidence: "low" as const,
      needsReview: true,
      screenshots,
      textQueries: [],
      visualQueries: [],
      candidates: [],
      selectedCandidate: null,
      summaryText: input.includeVisual ? "Visual fallback did not find a verified place candidate." : "",
      debug: input.includeVisual ? { perFrame: perFrameVisualDebug } : undefined,
    };

  if (visualFallback && !visualFallback.screenshots.length) {
    visualFallback.screenshots = screenshots;
  }
  if (visualFallback?.debug && typeof visualFallback.debug === "object") {
    visualFallback.debug = {
      ...(visualFallback.debug as Record<string, unknown>),
      perFrame: perFrameVisualDebug,
    };
  }

  const totalMs = nowMs() - startedAt;
  return {
    screenshots,
    screenshotsDebug: {
      mediaIngestion: {
        platform: input.metadata.platform,
        canonicalUrl: input.metadata.canonicalUrl,
        metadataProvider: input.metadata.provider,
        mediaUrlAvailable: Boolean((manifest.debug as any)?.mediaUrlAvailable),
        thumbnailImageUrlAvailable: Boolean(input.metadata.imageUrl),
      },
      frameExtraction: {
        ...manifest.debug,
        processingMode: "sequential_per_frame",
        perFrameOcr: perFrameOcrDebug,
      },
      screenshots: {
        count: screenshots.length,
        videoFrameCount: screenshots.length,
        metadataImageCount: 0,
        sentCandidates: screenshots.map(summarizeScreenshot),
      },
    },
    ocr,
    ocrMs: totalMs,
    frameExtractionMs,
    ocrOnlyMs,
    visualFallback,
    visualFallbackMs: input.includeVisual ? totalMs : 0,
    visualFallbackOnlyMs,
  };
}

function getCachedAttemptTranscript(input: {
  url: string;
  mode: ExtractionMode;
  attemptNumber: number;
}): TranscriptResult | null {
  const cacheKey = buildAttemptCacheKey(input.mode, input.url, input.attemptNumber);
  const cached = extractionCache.get(cacheKey);
  if (!cached || cached.expiresAt <= nowMs()) return null;
  return cached.result.transcript ? cloneResult(cached.result).transcript : null;
}

function getCachedAttemptResult(input: {
  url: string;
  mode: ExtractionMode;
  attemptNumber: number;
}): ExtractionResult | null {
  const cacheKey = buildAttemptCacheKey(input.mode, input.url, input.attemptNumber);
  const cached = extractionCache.get(cacheKey);
  if (!cached || cached.expiresAt <= nowMs()) return null;
  return cloneResult(cached.result);
}

function createTrace(input: Omit<OrchestrationTrace, "decisions" | "acceptedAfter">): OrchestrationTrace {
  return {
    ...input,
    transcriptReused: false,
    ocrFrameCount: 0,
    visualFrameCount: 0,
    decisions: [],
    acceptedAfter: "manual_review",
    inheritedEvidence: {
      transcriptAttempts: [],
      ocrAttempts: [],
    },
  };
}

function pushDecision(trace: OrchestrationTrace, stage: StageDecision["stage"], ran: boolean, reason: string) {
  trace.decisions.push({ stage, ran, reason });
}

function finalizeTrace(trace: OrchestrationTrace, acceptedAfter: OrchestrationTrace["acceptedAfter"]) {
  trace.acceptedAfter = acceptedAfter;
}

function logTrace(trace: OrchestrationTrace) {
  console.info("[extraction-stage-routing]", trace);
}

function buildResult(input: {
  mode: ExtractionMode;
  metadata: ExtractionResult["metadata"];
  metadataFailureReason: string | null;
  metadataMs: number;
  metadataFetchMs?: number;
  commentsMs?: number;
  llmCallsBeforeResponse?: number;
  transcript: TranscriptResult | null;
  transcriptMs: number;
  descriptionProbeMs?: number;
  transcriptProbeMs?: number;
  ocr: OcrResult | null;
  ocrMs: number;
  frameExtractionMs?: number;
  ocrOnlyMs?: number;
  visualFallback: VisualFallbackResult | null;
  visualFallbackMs: number;
  visualFallbackOnlyMs?: number;
  screenshotsDebug: Record<string, unknown> | null;
  screenshots: ScreenshotAsset[];
  cacheKey: string;
  totalStartedAt: number;
  attemptNumber: number;
  triggerType: ExtractionTriggerType;
  orchestration: OrchestrationTrace;
  priorAttemptHypotheses?: unknown[] | null;
  fastPathIntelligence?: {
    attempted: boolean;
    accepted: boolean;
    duplicateDescriptionLlmSkipped: boolean;
    result?: unknown;
    tinyFastExtractorUsed?: boolean;
    tinyFastExtractorMs?: number;
    tinyFastExtractorAccepted?: boolean;
    tinyFastExtractorRejectedReason?: string | null;
    modelUsedForTinyExtractor?: string | null;
    fullPromptSkipped?: boolean;
  };
}): ExtractionResult {
  const captionText = String(input.metadata.description || "").trim();
  const combined = buildCombinedText({
    metadata: input.metadata,
    transcript: input.transcript,
    ocr: input.ocr,
  });
  return {
    mode: input.mode,
    metadata: input.metadata,
    transcript: input.transcript,
    ocr: input.ocr,
    visualFallback: input.visualFallback,
    attemptInfo: {
      attemptNumber: input.attemptNumber,
      triggerType: input.triggerType,
    },
    source: input.metadata.sourceUrl,
    platform: input.metadata.platform,
    canonicalUrl: input.metadata.canonicalUrl,
    stageStatus: {
      basicMetadata: input.metadataFailureReason ? "partial" : "success",
      caption: captionText ? "success" : "partial",
      transcript: input.transcript?.used ? "success" : input.transcript?.attempted ? "partial" : "partial",
      ocr: input.ocr?.used ? "success" : input.ocr?.attempted ? "partial" : "partial",
      visualFallback: !input.visualFallback?.triggered
        ? "partial"
        : input.visualFallback.selectedCandidate
          ? "success"
          : input.visualFallback.attempted
            ? "partial"
            : "failed",
    },
    stages: {
      basicMetadata: {
        status: input.metadataFailureReason ? "partial" : "success",
        provider: input.metadata.provider,
        reason: input.metadataFailureReason,
        chars: [input.metadata.title, input.metadata.description].join(" ").trim().length,
      },
      caption: {
        status: captionText ? "success" : "partial",
        provider: input.metadata.provider,
        reason: captionText ? null : "caption_not_available",
        chars: captionText.length,
      },
      transcript: {
        status: input.transcript?.used ? "success" : input.transcript?.attempted ? "partial" : "partial",
        provider: input.transcript?.source || "none",
        reason: input.transcript?.reason || "not_attempted",
        chars: String(input.transcript?.text || "").trim().length,
      },
      ocr: {
        status: input.ocr?.used ? "success" : input.ocr?.attempted ? "partial" : "partial",
        provider: "frame_ocr",
        reason: input.ocr?.reason || "not_attempted",
        chars: String(input.ocr?.text || "").trim().length,
      },
      visualFallback: {
        status: !input.visualFallback?.triggered
          ? "partial"
          : input.visualFallback.selectedCandidate
            ? "success"
            : input.visualFallback.attempted
              ? "partial"
              : "failed",
        provider: input.visualFallback?.provider || "shared_visual_fallback",
        reason: input.visualFallback?.reason || "not_attempted",
        chars: String(input.visualFallback?.summaryText || "").trim().length,
      },
    },
    stageTimingsMs: {
      basicMetadata: input.metadataMs,
      caption: 0,
      transcript: input.transcriptMs,
      ocr: input.ocrMs,
      visualFallback: input.visualFallbackMs,
    },
    stageFailures: {
      ...(input.metadataFailureReason ? { basicMetadata: input.metadataFailureReason } : {}),
      ...(input.transcript?.reason && !input.transcript.used ? { transcript: input.transcript.reason } : {}),
      ...(input.ocr?.reason && !input.ocr.used ? { ocr: input.ocr.reason } : {}),
      ...(input.visualFallback?.reason && !input.visualFallback.selectedCandidate ? { visualFallback: input.visualFallback.reason } : {}),
    },
    ...combined,
    perf: {
      totalMs: nowMs() - input.totalStartedAt,
      metadataMs: input.metadataMs,
      transcriptMs: input.transcriptMs,
      ocrMs: input.ocrMs,
      visualFallbackMs: input.visualFallbackMs,
    },
    sla: {
      totalMs: nowMs() - input.totalStartedAt,
      metadataMs: input.metadataMs,
      transcriptMs: input.transcriptMs,
      ocrMs: input.ocrMs,
      visualFallbackMs: input.visualFallbackMs,
    },
    cache: { hit: false, key: input.cacheKey },
    debug: buildExtractionDebug({
      metadata: input.metadata,
      metadataFailureReason: input.metadataFailureReason,
      screenshotsDebug: input.screenshotsDebug,
      screenshots: input.screenshots,
      ocr: input.ocr,
      visualFallback: input.visualFallback,
      orchestration: input.orchestration,
      priorAttemptHypotheses: input.priorAttemptHypotheses,
      timings: {
        metadataFetchMs: input.metadataFetchMs ?? input.metadataMs,
        metadataMs: input.metadataMs,
        commentsMs: input.commentsMs ?? 0,
        descriptionFastExtractorMs: input.descriptionProbeMs ?? 0,
        descriptionProbeMs: input.descriptionProbeMs ?? 0,
        transcriptProbeMs: input.transcriptProbeMs ?? 0,
        transcriptMs: input.transcriptMs,
        frameExtractionMs: input.frameExtractionMs ?? 0,
        ocrOnlyMs: input.ocrOnlyMs ?? 0,
        ocrMs: input.ocrMs,
        visualFallbackOnlyMs: input.visualFallbackOnlyMs ?? 0,
        visualFallbackMs: input.visualFallbackMs,
        extractionTotalMs: nowMs() - input.totalStartedAt,
        llmCallsBeforeResponse: input.llmCallsBeforeResponse ?? 0,
      },
      fastPath: input.fastPathIntelligence,
    }),
  };
}

export async function runExtractionPipeline(input: {
  url: string;
  mode: ExtractionMode;
  debug?: boolean;
  attemptNumber?: number;
  triggerType?: ExtractionTriggerType;
}): Promise<ExtractionResult> {
  const debugEnabled = Boolean(input.debug);
  const traceEnabled = isTraceEnabled(debugEnabled);
  const attemptNumber = normalizeAttemptNumber(input.attemptNumber);
  const triggerType = normalizeTriggerType(input.triggerType);
  const cacheTtlMs = getNumberEnv("EXTRACTION_CACHE_TTL_MS", DEFAULT_CACHE_TTL_MS);
  const cacheKey = buildAttemptCacheKey(input.mode, input.url, attemptNumber);
  const sharedCacheKey = buildSharedCacheKey(input.mode, input.url);
  const cached = extractionCache.get(cacheKey) || extractionCache.get(sharedCacheKey);
  if (!debugEnabled && cached && cached.expiresAt > nowMs()) {
    const cachedResult = cloneResult(cached.result);
    const priorAttemptHypotheses = attemptNumber >= 2
      ? Array.from({ length: attemptNumber - 1 }, (_, index) => index + 1)
          .map((value) => getAttemptHypothesisSummary({
            url: input.url,
            mode: input.mode,
            attemptNumber: value,
          }))
          .filter(Boolean)
      : [];
    cachedResult.attemptInfo = {
      attemptNumber,
      triggerType,
    };
    if (!cachedResult.debug || typeof cachedResult.debug !== "object") {
      cachedResult.debug = {};
    }
    cachedResult.debug = {
      ...cachedResult.debug,
      priorAttemptHypotheses,
    };
    const orchestration = cachedResult.debug.orchestration;
    if (orchestration && typeof orchestration === "object") {
      cachedResult.debug.orchestration = {
        ...(orchestration as Record<string, unknown>),
        inheritedEvidence: {
          ...((orchestration as Record<string, any>).inheritedEvidence || {}),
          hypothesisAttempts: priorAttemptHypotheses
            .map((item: any) => Number(item?.attemptNumber))
            .filter((value) => Number.isFinite(value)),
        },
      };
    }
    cachedResult.cache = { hit: true, key: extractionCache.get(cacheKey) ? cacheKey : sharedCacheKey };
    extractionCache.set(cacheKey, { expiresAt: cached.expiresAt, result: cloneResult(cachedResult) });
    extractionCache.set(sharedCacheKey, { expiresAt: cached.expiresAt, result: cloneResult(cachedResult) });
    return cachedResult;
  }

  const totalStartedAt = nowMs();
  const { metadata, metadataFailureReason, metadataMs, metadataFetchMs, commentsMs } = await readMetadata(input.url, {
    mode: input.mode,
    attemptNumber,
  });

  if (input.mode === "quick") {
    const orchestration = createTrace({
      attemptNumber,
      triggerType,
      sourcePlatform: metadata.platform,
      route: "quick",
    });
    pushDecision(orchestration, "description", true, "quick_mode_metadata_only");
    pushDecision(orchestration, "transcript", false, "quick_mode_skipped");
    pushDecision(orchestration, "ocr", false, "quick_mode_skipped");
    pushDecision(orchestration, "visualFallback", false, "quick_mode_skipped");
    finalizeTrace(orchestration, "description");
    logTrace(orchestration);

    const quickResult = buildResult({
      mode: input.mode,
      metadata,
      metadataFailureReason,
      metadataMs,
      metadataFetchMs,
      commentsMs,
      llmCallsBeforeResponse: 0,
      transcript: { attempted: false, used: false, source: null, text: "", reason: "quick_mode" },
      transcriptMs: 0,
      descriptionProbeMs: 0,
      transcriptProbeMs: 0,
      ocr: { attempted: false, used: false, text: "", reason: "quick_mode" },
      ocrMs: 0,
      frameExtractionMs: 0,
      ocrOnlyMs: 0,
      visualFallback: {
        attempted: false,
        triggered: false,
        reason: "quick_mode",
        provider: "shared_visual_fallback",
        confidence: "low",
        needsReview: true,
        screenshots: [],
        textQueries: [],
        visualQueries: [],
        candidates: [],
        selectedCandidate: null,
        summaryText: "",
      },
      visualFallbackMs: 0,
      visualFallbackOnlyMs: 0,
      screenshotsDebug: null,
      screenshots: [],
      cacheKey,
      totalStartedAt,
      attemptNumber,
      triggerType,
      orchestration,
      fastPathIntelligence: {
        attempted: false,
        accepted: false,
        duplicateDescriptionLlmSkipped: false,
        tinyFastExtractorUsed: false,
        tinyFastExtractorMs: 0,
        tinyFastExtractorAccepted: false,
        tinyFastExtractorRejectedReason: null,
        modelUsedForTinyExtractor: null,
        fullPromptSkipped: false,
      },
    });
    if (traceEnabled) {
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

  const route = attemptNumber >= 3 ? "retry_2" : attemptNumber === 2 ? "retry_1" : "attempt_1";
  const visualFallbackPolicy = getAttemptVisualFallbackPolicy(attemptNumber);
  const orchestration = createTrace({
    attemptNumber,
    triggerType,
    sourcePlatform: metadata.platform,
    route,
  });

  const descriptionWeak = isWeakDescription(metadata);
  let descriptionProbe: LlmConfidenceProbe | null = null;
  let descriptionProbeFailureReason: string | null = null;
  let descriptionFastResult: import("../intelligence/types").IntelligencePipelineResult | null = null;
  let descriptionFastModel: string | null = null;
  let descriptionProbeMs = 0;
  let tinyFastExtractorAccepted = false;
  let tinyFastExtractorRejectedReason: string | null = descriptionWeak ? "missing_or_weak_description" : null;
  let transcriptProbeMs = 0;
  let llmCallsBeforeResponse = 0;
  if (attemptNumber === 1 && !descriptionWeak) {
    const descriptionProbeResult = await safeRunTinyFastExtractor(
      {
        metadata,
        mode: input.mode,
        attemptNumber,
        triggerType,
      },
      {
        stage: "description",
        metadata,
        mode: input.mode,
        attemptNumber,
        triggerType,
      },
    );
    descriptionProbe = descriptionProbeResult.probe;
    descriptionProbeFailureReason = descriptionProbeResult.failureReason;
    descriptionProbeMs = descriptionProbeResult.probeMs;
    descriptionFastResult =
      descriptionProbe && "result" in descriptionProbe
        ? (descriptionProbe as StructuredFastPathDecision).result
        : null;
    descriptionFastModel =
      descriptionProbe && "model" in descriptionProbe
        ? (descriptionProbe as StructuredFastPathDecision).model
        : null;
    llmCallsBeforeResponse += descriptionProbeFailureReason ? 0 : 1;
    tinyFastExtractorAccepted = Boolean(descriptionProbe?.accepted);
    tinyFastExtractorRejectedReason =
      descriptionProbeFailureReason ||
      (descriptionProbe?.accepted
        ? null
        : descriptionProbe?.status === "no_supported_entity_found"
          ? "tiny_extractor_no_supported_entity_found"
          : descriptionProbe?.entityCount === 0
            ? "tiny_extractor_no_entities"
            : `tiny_extractor_${descriptionProbe?.confidence || "low"}`);
  }
  const shouldRunTranscript = attemptNumber >= 2 || descriptionWeak;
  let transcript: TranscriptResult = {
    attempted: false,
    used: false,
    source: null,
    text: "",
    reason: shouldRunTranscript ? "pending" : "skipped_description_accepted",
  };
  let transcriptMs = 0;

  if (attemptNumber === 1 && !descriptionWeak && descriptionProbe?.accepted) {
    pushDecision(
      orchestration,
      "description",
      true,
      `accepted_description_tiny_${descriptionProbe.confidence}`,
    );
    pushDecision(orchestration, "transcript", false, "description_confidence_sufficient");
    pushDecision(orchestration, "ocr", false, "description_confidence_sufficient");
    pushDecision(orchestration, "visualFallback", false, "initial_attempt_only");
    finalizeTrace(orchestration, "description");
    logTrace(orchestration);

    const result = buildResult({
      mode: input.mode,
      metadata,
      metadataFailureReason,
      metadataMs,
      metadataFetchMs,
      commentsMs,
      llmCallsBeforeResponse,
      transcript,
      transcriptMs,
      descriptionProbeMs,
      transcriptProbeMs,
      ocr: { attempted: false, used: false, text: "", reason: "skipped_description_accepted" },
      ocrMs: 0,
      frameExtractionMs: 0,
      ocrOnlyMs: 0,
      visualFallback: {
        attempted: false,
        triggered: false,
        reason: "skipped_description_accepted",
        provider: "shared_visual_fallback",
        confidence: "low",
        needsReview: true,
        screenshots: [],
        textQueries: [],
        visualQueries: [],
        candidates: [],
        selectedCandidate: null,
        summaryText: "",
      },
      visualFallbackMs: 0,
      visualFallbackOnlyMs: 0,
      screenshotsDebug: null,
      screenshots: [],
      cacheKey,
      totalStartedAt,
      attemptNumber,
      triggerType,
      orchestration,
      fastPathIntelligence: {
        attempted: true,
        accepted: true,
        duplicateDescriptionLlmSkipped: true,
        result: descriptionFastResult,
        tinyFastExtractorUsed: true,
        tinyFastExtractorMs: descriptionProbeMs,
        tinyFastExtractorAccepted: true,
        tinyFastExtractorRejectedReason: null,
        modelUsedForTinyExtractor: descriptionFastModel,
        fullPromptSkipped: true,
      },
    });
    if (traceEnabled) {
      console.info("[extraction-debug]", result.debug);
    }
    console.info(
      `[attempt-1-sla] acceptedAfter=description fastExtractorMs=${descriptionProbeMs} duplicateLlmSkipped=true llmCalls=${llmCallsBeforeResponse} metadataMs=${metadataMs} commentsMs=${commentsMs} totalMs=${result.sla?.totalMs ?? result.perf?.totalMs ?? 0}`,
    );
    if (!debugEnabled && !isLowSignalInstagramResult(result)) {
      extractionCache.set(cacheKey, { expiresAt: nowMs() + cacheTtlMs, result: cloneResult(result) });
      extractionCache.set(sharedCacheKey, { expiresAt: nowMs() + cacheTtlMs, result: cloneResult(result) });
    }
    const agg = recordSla("extraction.total", result.sla?.totalMs ?? result.perf?.totalMs ?? 0);
    if (Number(process.env.EXTRACTION_SLA_LOG_EVERY || 0) > 0 && agg.sampleSize % Number(process.env.EXTRACTION_SLA_LOG_EVERY) === 0) {
      console.info("[sla][extraction.total]", { p50: agg.p50, p95: agg.p95, sampleSize: agg.sampleSize });
    }
    return result;
  }

  pushDecision(
    orchestration,
    "description",
    !descriptionProbeFailureReason,
    attemptNumber === 1
      ? descriptionProbeFailureReason ||
        (descriptionWeak
        ? "missing_or_weak_description"
        : `tiny_caption_${descriptionProbe?.confidence || "low"}`)
      : "retry_forced_reanalysis",
  );

  let screenshots: ScreenshotAsset[] = [];
  let screenshotsDebug: Record<string, unknown> | null = null;
  let ocr: OcrResult = { attempted: false, used: false, text: "", reason: "not_attempted" };
  let ocrMs = 0;
  let frameExtractionMs = 0;
  let ocrOnlyMs = 0;
  let visualFallback: VisualFallbackResult = {
    attempted: false,
    triggered: false,
    reason: "not_attempted",
    provider: "shared_visual_fallback",
    confidence: "low",
    needsReview: true,
    screenshots: [],
    textQueries: [],
    visualQueries: [],
    candidates: [],
    selectedCandidate: null,
    summaryText: "",
  };
  let visualFallbackMs = 0;
  let visualFallbackOnlyMs = 0;
  const priorAttempt1 = attemptNumber >= 2
    ? getCachedAttemptResult({
        url: input.url,
        mode: input.mode,
        attemptNumber: 1,
      })
    : null;
  const priorAttempt2 = attemptNumber >= 3
    ? getCachedAttemptResult({
        url: input.url,
        mode: input.mode,
        attemptNumber: 2,
      })
    : null;
  const priorAttemptHypotheses = attemptNumber >= 2
    ? Array.from({ length: attemptNumber - 1 }, (_, index) => index + 1)
        .map((value) => getAttemptHypothesisSummary({
          url: input.url,
          mode: input.mode,
          attemptNumber: value,
        }))
        .filter(Boolean)
    : [];

  if (attemptNumber >= 3) {
    const inheritedTranscript = mergeTranscriptResults(priorAttempt1?.transcript ?? null, priorAttempt2?.transcript ?? null);
    orchestration.inheritedEvidence = {
      transcriptAttempts: [1, 2].filter((value) => Boolean((value === 1 ? priorAttempt1 : priorAttempt2)?.transcript?.text)),
      ocrAttempts: [1, 2].filter((value) => Boolean((value === 1 ? priorAttempt1 : priorAttempt2)?.ocr?.text)),
      hypothesisAttempts: priorAttemptHypotheses.map((item: any) => Number(item?.attemptNumber)).filter((value) => Number.isFinite(value)),
    };
    if (inheritedTranscript && hasMeaningfulTranscript(inheritedTranscript)) {
      transcript = inheritedTranscript;
      transcriptMs = 0;
      orchestration.transcriptReused = true;
      pushDecision(orchestration, "transcript", false, "retry_2_transcript_reused");
    } else {
      const transcriptRead = await readTranscript(metadata);
      transcript = mergeTranscriptResults(inheritedTranscript, transcriptRead.transcript) ?? {
        attempted: true,
        used: false,
        source: transcriptRead.transcript.source || null,
        text: "",
        reason: transcriptRead.transcript.reason || "retry_2_transcript_missing_rerun",
      };
      transcriptMs = transcriptRead.transcriptMs;
      orchestration.transcriptReused = false;
      pushDecision(orchestration, "transcript", true, "retry_2_transcript_missing_rerun");
    }
    pushDecision(orchestration, "ocr", true, "retry_2_frame_ocr");
    const sequential = await processRetryFramesSequentially({
      metadata,
      transcript,
      selectionMode: "scene_edges",
      includeVisual: visualFallbackPolicy.includeVisual,
      visualForceReason: visualFallbackPolicy.includeVisual ? visualFallbackPolicy.decisionReason : null,
    });
    screenshots = sequential.screenshots;
    screenshotsDebug = sequential.screenshotsDebug;
    ocr = mergeOcrResults(
      mergeOcrResults(priorAttempt1?.ocr ?? null, priorAttempt2?.ocr ?? null),
      sequential.ocr,
    ) ?? sequential.ocr;
    ocrMs = sequential.ocrMs;
    frameExtractionMs = sequential.frameExtractionMs;
    ocrOnlyMs = sequential.ocrOnlyMs;
    visualFallback = sequential.visualFallback;
    visualFallbackMs = sequential.visualFallbackMs;
    visualFallbackOnlyMs = sequential.visualFallbackOnlyMs;
    orchestration.ocrFrameCount = sequential.screenshots.length;
    orchestration.visualFrameCount = sequential.screenshots.length;
  } else if (attemptNumber === 2) {
    orchestration.inheritedEvidence = {
      transcriptAttempts: priorAttempt1?.transcript?.text ? [1] : [],
      ocrAttempts: priorAttempt1?.ocr?.text ? [1] : [],
    };
    const reusedTranscript = priorAttempt1?.transcript ?? getCachedAttemptTranscript({
      url: input.url,
      mode: input.mode,
      attemptNumber: 1,
    });
    if (reusedTranscript && hasMeaningfulTranscript(reusedTranscript)) {
      transcript = reusedTranscript;
      transcriptMs = 0;
      orchestration.transcriptReused = true;
      pushDecision(orchestration, "transcript", false, "retry_1_transcript_reused");
    } else {
      const transcriptRead = await readTranscript(metadata);
      transcript = mergeTranscriptResults(reusedTranscript ?? null, transcriptRead.transcript) ?? {
        attempted: true,
        used: false,
        source: transcriptRead.transcript.source || null,
        text: "",
        reason: transcriptRead.transcript.reason || "retry_1_transcript_missing_rerun",
      };
      transcriptMs = transcriptRead.transcriptMs;
      orchestration.transcriptReused = false;
      pushDecision(orchestration, "transcript", true, "retry_1_transcript_missing_rerun");
    }
    pushDecision(orchestration, "ocr", true, "retry_1_frame_ocr");
    const sequential = await processRetryFramesSequentially({
      metadata,
      transcript,
      selectionMode: "anchors",
      includeVisual: false,
    });
    screenshots = sequential.screenshots;
    screenshotsDebug = sequential.screenshotsDebug;
    ocr = mergeOcrResults(priorAttempt1?.ocr ?? null, sequential.ocr) ?? sequential.ocr;
    ocrMs = sequential.ocrMs;
    frameExtractionMs = sequential.frameExtractionMs;
    ocrOnlyMs = sequential.ocrOnlyMs;
    orchestration.ocrFrameCount = sequential.screenshots.length;
    orchestration.visualFrameCount = 0;
  } else {
    const transcriptRead = await readTranscript(metadata);
    transcript = transcriptRead.transcript;
    transcriptMs = transcriptRead.transcriptMs;
    const transcriptProbeResult = await safeProbeLlmConfidence(
      {
        metadata,
        mode: input.mode,
        attemptNumber,
        triggerType,
        transcript,
      },
      {
        stage: "transcript",
        metadata,
        mode: input.mode,
        attemptNumber,
        triggerType,
      },
    );
    const transcriptProbe = transcriptProbeResult.probe;
    const transcriptProbeFailureReason = transcriptProbeResult.failureReason;
    transcriptProbeMs = transcriptProbeResult.probeMs;
    llmCallsBeforeResponse += 1;
    pushDecision(
      orchestration,
      "transcript",
      !transcriptProbeFailureReason,
      transcriptProbeFailureReason || `transcript_probe_${transcriptProbe?.confidence || "low"}`,
    );

    if (transcriptProbe?.accepted) {
      pushDecision(orchestration, "ocr", false, "transcript_confidence_sufficient");
      pushDecision(orchestration, "visualFallback", false, "initial_attempt_only");
      finalizeTrace(orchestration, "transcript");
      logTrace(orchestration);

      const result = buildResult({
      mode: input.mode,
      metadata,
      metadataFailureReason,
      metadataMs,
      metadataFetchMs,
      commentsMs,
      llmCallsBeforeResponse,
      transcript,
      transcriptMs,
      descriptionProbeMs,
      transcriptProbeMs,
      ocr: { attempted: false, used: false, text: "", reason: "skipped_after_transcript" },
      ocrMs: 0,
      frameExtractionMs: 0,
      ocrOnlyMs: 0,
      visualFallback,
      visualFallbackMs: 0,
      visualFallbackOnlyMs: 0,
      screenshotsDebug: null,
        screenshots: [],
        cacheKey,
        totalStartedAt,
        attemptNumber,
        triggerType,
        orchestration,
        priorAttemptHypotheses,
        fastPathIntelligence: {
          attempted: descriptionProbeMs > 0,
          accepted: false,
          duplicateDescriptionLlmSkipped: false,
          result: descriptionFastResult,
          tinyFastExtractorUsed: descriptionProbeMs > 0,
          tinyFastExtractorMs: descriptionProbeMs,
          tinyFastExtractorAccepted,
          tinyFastExtractorRejectedReason,
          modelUsedForTinyExtractor: descriptionFastModel,
          fullPromptSkipped: false,
        },
      });
      if (traceEnabled) {
        console.info("[extraction-debug]", result.debug);
      }
      if (!debugEnabled && !isLowSignalInstagramResult(result)) {
        extractionCache.set(cacheKey, { expiresAt: nowMs() + cacheTtlMs, result: cloneResult(result) });
        extractionCache.set(sharedCacheKey, { expiresAt: nowMs() + cacheTtlMs, result: cloneResult(result) });
      }
      const agg = recordSla("extraction.total", result.sla?.totalMs ?? result.perf?.totalMs ?? 0);
      if (Number(process.env.EXTRACTION_SLA_LOG_EVERY || 0) > 0 && agg.sampleSize % Number(process.env.EXTRACTION_SLA_LOG_EVERY) === 0) {
        console.info("[sla][extraction.total]", { p50: agg.p50, p95: agg.p95, sampleSize: agg.sampleSize });
      }
      return result;
    }

    const sequential = await processRetryFramesSequentially({
      metadata,
      transcript,
      selectionMode: "anchors",
      includeVisual: false,
    });
    screenshots = sequential.screenshots;
    screenshotsDebug = sequential.screenshotsDebug;
    pushDecision(orchestration, "ocr", true, "attempt_1_frame_ocr_after_transcript_probe");
    ocr = sequential.ocr;
    ocrMs = sequential.ocrMs;
    frameExtractionMs = sequential.frameExtractionMs;
    ocrOnlyMs = sequential.ocrOnlyMs;
    orchestration.ocrFrameCount = sequential.screenshots.length;
    orchestration.visualFrameCount = 0;
  }

  if (attemptNumber >= 3) {
    pushDecision(orchestration, "visualFallback", true, visualFallbackPolicy.decisionReason);
    finalizeTrace(orchestration, visualFallback.selectedCandidate ? "visualFallback" : "manual_review");
  } else {
    pushDecision(orchestration, "visualFallback", false, visualFallbackPolicy.decisionReason);
    finalizeTrace(orchestration, hasMeaningfulOcr(ocr) ? "ocr" : "manual_review");
  }

  logTrace(orchestration);

  const result = buildResult({
    mode: input.mode,
    metadata,
    metadataFailureReason,
    metadataMs,
    metadataFetchMs,
    commentsMs,
    llmCallsBeforeResponse,
    transcript,
    transcriptMs,
    descriptionProbeMs,
    transcriptProbeMs,
    ocr,
    ocrMs,
    frameExtractionMs,
    ocrOnlyMs,
    visualFallback,
    visualFallbackMs,
    visualFallbackOnlyMs,
    screenshotsDebug,
    screenshots,
    cacheKey,
    totalStartedAt,
    attemptNumber,
    triggerType,
    orchestration,
    priorAttemptHypotheses,
    fastPathIntelligence: {
      attempted: descriptionProbeMs > 0,
      accepted: false,
      duplicateDescriptionLlmSkipped: false,
      result: descriptionFastResult,
      tinyFastExtractorUsed: descriptionProbeMs > 0,
      tinyFastExtractorMs: descriptionProbeMs,
      tinyFastExtractorAccepted,
      tinyFastExtractorRejectedReason,
      modelUsedForTinyExtractor: descriptionFastModel,
      fullPromptSkipped: false,
    },
  });

  if (traceEnabled) {
    console.info("[extraction-debug]", result.debug);
  }
  if (!debugEnabled && !isLowSignalInstagramResult(result)) {
    extractionCache.set(cacheKey, { expiresAt: nowMs() + cacheTtlMs, result: cloneResult(result) });
    extractionCache.set(sharedCacheKey, { expiresAt: nowMs() + cacheTtlMs, result: cloneResult(result) });
  }
  const agg = recordSla("extraction.total", result.sla?.totalMs ?? result.perf?.totalMs ?? 0);
  if (Number(process.env.EXTRACTION_SLA_LOG_EVERY || 0) > 0 && agg.sampleSize % Number(process.env.EXTRACTION_SLA_LOG_EVERY) === 0) {
    console.info("[sla][extraction.total]", { p50: agg.p50, p95: agg.p95, sampleSize: agg.sampleSize });
  }
  return result;
}
