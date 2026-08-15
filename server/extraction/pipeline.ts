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
import { extractCaptionListEntities } from "../intelligence/captionListAugment";
import { runIntelligencePipeline, runTinyCaptionIntelligence } from "../intelligence";
import { buildTinyCaptionPromptPayload } from "../intelligence/prompts";
import { extractVisionOcrFromScreenshots } from "./visionOcr";
import { extractImagePathOcr } from "./ocr";
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
import { createMemoryTracker } from "../diagnostics/memoryDiagnostics";
import fs from "node:fs/promises";

export type ExtractionProgressStage =
  | "started"
  | "metadata_started"
  | "metadata_done"
  | "tiny_extractor_started"
  | "tiny_extractor_done"
  | "accepted_description"
  | "transcript_started"
  | "transcript_done"
  | "frame_extraction_started"
  | "frame_extraction_done"
  | "ocr_started"
  | "ocr_done"
  | "visual_started"
  | "visual_done"
  | "completed"
  | "failed";

export type ExtractionProgressEvent = {
  stage: ExtractionProgressStage;
  message: string;
  elapsedMs: number;
  attemptNumber: number;
};

type ExtractionProgressReporter = (event: ExtractionProgressEvent) => void | Promise<void>;

type CacheEntry = {
  expiresAt: number;
  result: ExtractionResult;
};

type AttemptExecutionProfile = {
  usedLongLane: boolean;
  acceptedAfter: OrchestrationTrace["acceptedAfter"] | null;
  route: OrchestrationTrace["route"] | null;
  transcriptAttempted: boolean;
  ocrAttempted: boolean;
};

type RetryCacheDecision = {
  bypass: boolean;
  reason: string | null;
  cachedStatus: string | null;
  cachedAcceptedAfter: OrchestrationTrace["acceptedAfter"] | null;
};

type AttemptExecutionProfileEntry = {
  expiresAt: number;
  profile: AttemptExecutionProfile;
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
  route: "quick" | "attempt_1" | "retry_1_long" | "retry_1_refinement" | "retry_2";
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
  transcriptTimeoutMs: number;
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
const attemptExecutionProfileCache = new Map<string, AttemptExecutionProfileEntry>();
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_METADATA_BUDGET_MS = 12000;
const DEFAULT_TRANSCRIPT_BUDGET_MS = 60000;
const ATTEMPT1_TRANSCRIPT_BUDGET_MS = 20000;
const ATTEMPT2_TRANSCRIPT_BUDGET_MS = 30000;
const ATTEMPT3_TRANSCRIPT_BUDGET_MS = 60000;
const DEFAULT_COMMENT_BUDGET_MS = 1500;

function getNumberEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function nowMs(): number {
  return Date.now();
}

async function emitProgress(
  reporter: ExtractionProgressReporter | undefined,
  totalStartedAt: number,
  attemptNumber: number,
  stage: ExtractionProgressStage,
  message: string,
) {
  if (!reporter) return;
  console.info(`[pipeline-progress] ${stage}`, { attemptNumber });
  try {
    await reporter({
      stage,
      message,
      elapsedMs: nowMs() - totalStartedAt,
      attemptNumber,
    });
  } catch (error) {
    console.error("[pipeline-progress-callback-error]", {
      stage,
      attemptNumber,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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

function getCachedResultStatus(result: ExtractionResult | null): string | null {
  if (!result) return null;
  const debug = result.debug && typeof result.debug === "object"
    ? (result.debug as Record<string, any>)
    : null;
  const explicitStatusRaw =
    debug?.fastPathIntelligence?.result?.output?.status ??
    debug?.fastPath?.result?.output?.status ??
    null;
  if (typeof explicitStatusRaw === "string" && explicitStatusRaw.trim()) {
    return explicitStatusRaw;
  }
  const acceptedAfterRaw = debug
    ? debug?.orchestration?.acceptedAfter
    : null;
  return typeof acceptedAfterRaw === "string" ? acceptedAfterRaw : null;
}

function cachedResultLooksGenericPlaceholder(result: ExtractionResult | null): boolean {
  if (!result) return false;
  const transcriptText = String(result.transcript?.text || "").trim();
  const ocrText = String(result.ocr?.text || "").trim();
  const hasVisualCandidate = Boolean(result.visualFallback?.selectedCandidate);
  if (transcriptText.length >= 12 || ocrText.length >= 12 || hasVisualCandidate) {
    return false;
  }

  const metadataText = `${String(result.metadata?.title || "")}\n${String(result.metadata?.description || "")}`.toLowerCase();
  if (!metadataText.trim()) return false;

  const looksLikeBoilerplate =
    /\blikes?\b/.test(metadataText) ||
    /\bcomments?\b/.test(metadataText) ||
    /\bon instagram:/.test(metadataText) ||
    /@\w+/.test(metadataText) ||
    /\bon (january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(metadataText);
  const looksLikeGenericCaption =
    /\bpinteresty\s+caf[eé]\b/.test(metadataText) ||
    /\bcute\s+caf[eé]\b/.test(metadataText) ||
    /\bcute\s+aesthetic\b/.test(metadataText) ||
    /\baesthetic\s+caf[eé]\b/.test(metadataText) ||
    /\bhidden\s+gem\s+caf[eé]\b/.test(metadataText) ||
    /\bcutest\s+caf[eé]\b/.test(metadataText) ||
    /\bmust\s+visit\s+place\b/.test(metadataText);

  return looksLikeBoilerplate || looksLikeGenericCaption;
}

export function getRetryCacheDecision(input: {
  attemptNumber: number;
  triggerType: ExtractionTriggerType;
  cachedResult: ExtractionResult | null;
}): RetryCacheDecision {
  const cachedAcceptedAfterRaw = input.cachedResult?.debug && typeof input.cachedResult.debug === "object"
    ? (input.cachedResult.debug as Record<string, any>)?.orchestration?.acceptedAfter
    : null;
  const cachedAcceptedAfter =
    cachedAcceptedAfterRaw === "description" ||
    cachedAcceptedAfterRaw === "transcript" ||
    cachedAcceptedAfterRaw === "ocr" ||
    cachedAcceptedAfterRaw === "visualFallback" ||
    cachedAcceptedAfterRaw === "manual_review"
      ? cachedAcceptedAfterRaw
      : null;
  const cachedStatus = getCachedResultStatus(input.cachedResult);
  const cachedLooksGenericPlaceholder = cachedResultLooksGenericPlaceholder(input.cachedResult);
  const shouldBypass =
    input.attemptNumber >= 2 &&
    input.triggerType === "retry" &&
    (
      cachedAcceptedAfter === "manual_review" ||
      cachedStatus === "needs_review" ||
      cachedLooksGenericPlaceholder
    );
  return {
    bypass: shouldBypass,
    reason: shouldBypass ? "manual_review_retry_requires_deeper_evidence" : null,
    cachedStatus,
    cachedAcceptedAfter,
  };
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
    frameIndex: shot.frameIndex ?? null,
    timestampSec: shot.timestampSec ?? null,
    sizeBytes: shot.sizeBytes ?? (shot.url.startsWith("data:") ? Math.round(shot.url.length * 0.75) : null),
    sourcePath: shot.sourcePath ?? null,
    originalWidth: shot.originalWidth ?? null,
    originalHeight: shot.originalHeight ?? null,
    resizedWidth: shot.resizedWidth ?? null,
    resizedHeight: shot.resizedHeight ?? null,
    urlKind: shot.url.startsWith("data:") ? "data_url" : "remote_url",
  };
}

const CAPTION_VENUE_NAME_PATTERN = /\b([A-Z][A-Za-z0-9&'`.-]+(?:\s+[A-Z][A-Za-z0-9&'`.-]+){0,4})\s+(Cafe|Caf[eé]|Restaurant|Bakery|Bistro|Kitchen|Eatery|Dhaba|Bar|Diner|Hotel|Resort|Hostel|Homestay|Villa)\b/;
const CAPTION_SCENIC_NAME_PATTERN = /\b([A-Z][A-Za-z0-9&'`.-]+(?:\s+[A-Z][A-Za-z0-9&'`.-]+){0,4})\s+(Falls|Waterfall|Lake|Beach|Temple|Fort|Park|Museum|Palace|Garden|Gardens|Canyon|Bridge|Peak|Hill|Hills|Viewpoint|Village|Cave|Island|Creek)\b/;
const CAPTION_GENERIC_REGION_ONLY_PATTERN = /\b(itinerary|trip|tourism|travel|spots?|places?|rating|guide|hidden gems?)\b/;

function getMeaningfulCaptionLines(description: string): string[] {
  return description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !/^#/.test(line) && !/^[@.]+$/.test(line));
}

function hasConcreteCaptionEntitySignal(metadata: ExtractionResult["metadata"]): boolean {
  const title = String(metadata.title || "").trim();
  const description = String(metadata.description || "").trim();
  const captionSignals = extractCaptionListEntities({
    metadata,
    transcript: null,
    ocr: null,
    visualFallback: null,
    screenshots: [],
    warnings: [],
    debug: null,
  } as any);
  if (captionSignals.length > 0) return true;

  const lines = getMeaningfulCaptionLines(description);
  const candidates = [title, ...lines.slice(0, 5)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (/^location\s*:/i.test(candidate) && /[A-Za-z]{3,}/.test(candidate.replace(/^location\s*:/i, "").trim())) {
      return true;
    }
    if (CAPTION_VENUE_NAME_PATTERN.test(candidate) || CAPTION_SCENIC_NAME_PATTERN.test(candidate)) {
      return true;
    }
    if (/^([A-Z][A-Za-z0-9&'`.-]+(?:\s+[A-Z][A-Za-z0-9&'`.-]+){0,4})\s*[-,:]\s*[A-Z][A-Za-z]/.test(candidate)) {
      return true;
    }
  }

  return false;
}

export function isWeakDescription(metadata: ExtractionResult["metadata"]): boolean {
  const title = String(metadata.title || "").trim();
  const description = String(metadata.description || "").trim();
  const combined = `${title}\n${description}`.replace(/\s+/g, " ").trim().toLowerCase();
  if (!combined) return true;
  if (description.length < 24) return true;
  if (combined === "instagram") return true;
  if (combined.includes("create an account or log in to instagram")) return true;
  if (/^\s*(dm|comment|follow|save|share)\b/i.test(description)) return true;
  if (metadata.platform === "instagram") {
    const hasConcreteEntitySignal = hasConcreteCaptionEntitySignal(metadata);
    if (hasConcreteEntitySignal) return false;
    const hashtagCount = (description.match(/#[\p{L}\p{N}_]+/gu) || []).length;
    const hasBoilerplateEngagementShell =
      /\blikes?\b/.test(combined) ||
      /\bcomments?\b/.test(combined) ||
      /\bon instagram:/.test(combined);
    const hasTravelCta =
      /\bsave this before\b/.test(combined) ||
      /\bplanning\s+[a-z]/.test(combined) ||
      /\bperfect\s+[a-z]+\s+itinerary\b/.test(combined) ||
      /\bwhich place deserves a higher rating\b/.test(combined) ||
      /\brating\s+[a-z\s]+spots\b/.test(combined) ||
      /\bdm\s+[“"'`]?[a-z]+/.test(combined);
    const hasGenericRegionOnlyTravelCopy = CAPTION_GENERIC_REGION_ONLY_PATTERN.test(combined);
    if (hasTravelCta) return true;
    if (hasGenericRegionOnlyTravelCopy && hashtagCount >= 2) return true;
    if (hasBoilerplateEngagementShell && hashtagCount >= 3) return true;
  }
  return false;
}

function hasMeaningfulOcr(ocr: OcrResult | null): boolean {
  return Boolean(String(ocr?.text || "").trim().length >= 12);
}

function hasMeaningfulTranscript(transcript: TranscriptResult | null): boolean {
  return Boolean(String(transcript?.text || "").trim().length >= 12);
}

export function shouldAcceptTranscriptProbe(transcript: TranscriptResult | null, probe: LlmConfidenceProbe | null): boolean {
  if (!probe?.accepted) return false;
  if (!transcript?.attempted) return false;
  if (!hasMeaningfulTranscript(transcript)) return false;
  if (String(transcript.reason || "").trim().toLowerCase() === "timeout") return false;
  return true;
}

export function shouldSkipOcrAfterTranscriptProbe(transcript: TranscriptResult | null, probe: LlmConfidenceProbe | null): boolean {
  return shouldAcceptTranscriptProbe(transcript, probe);
}

export function shouldForceBackgroundLongLane(input: {
  attemptNumber: number;
  forceBackgroundEnrichment?: boolean;
  descriptionWeak: boolean;
  descriptionAccepted: boolean;
}): boolean {
  return Boolean(
    input.forceBackgroundEnrichment &&
    input.attemptNumber === 1 &&
    !input.descriptionWeak &&
    input.descriptionAccepted,
  );
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
  clientRunId?: string | null;
  requestId?: string | null;
  probeStage?: "description" | "transcript";
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
      clientRunId: input.clientRunId ?? null,
      requestId: input.requestId ?? null,
      attemptNumber: input.attemptNumber,
      triggerType: input.triggerType,
      probeStage: input.probeStage ?? null,
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
  clientRunId?: string | null;
  requestId?: string | null;
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
      clientRunId: input.clientRunId ?? null,
      requestId: input.requestId ?? null,
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
    clientRunId?: string | null;
    requestId?: string | null;
    probeStage?: "description" | "transcript" | null;
    transcript?: TranscriptResult | null;
    ocr?: OcrResult | null;
  },
  context: ProbeFailureContext,
): Promise<{ probe: LlmConfidenceProbe | null; failureReason: string | null; probeMs: number }> {
  const startedAt = nowMs();
  try {
    const probe = await runStructuredFastPathDecision({
      ...input,
      probeStage: input.probeStage ?? undefined,
    });
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
    clientRunId?: string | null;
    requestId?: string | null;
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
    tinyCaptionPromptInput?: Record<string, unknown> | null;
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
      commentsFetchedCount: input.metadata.commentEvidence?.commentsFetchedCount ?? 0,
      commentRepliesFetchedCount: input.metadata.commentEvidence?.commentRepliesFetchedCount ?? 0,
      creatorReplyCount: input.metadata.commentEvidence?.creatorReplyCount ?? 0,
      pinnedCommentIncluded: Boolean(input.metadata.commentEvidence?.pinnedComment),
      topCommentCount: Array.isArray(input.metadata.commentEvidence?.topComments)
        ? input.metadata.commentEvidence?.topComments.length
        : 0,
      commentsUsedInPrompt:
        (input.metadata.commentEvidence?.pinnedComment ? 1 : 0) +
        (Array.isArray(input.metadata.commentEvidence?.topComments) ? input.metadata.commentEvidence.topComments.length : 0),
      commentEvidenceSnippet:
        input.metadata.commentEvidence?.pinnedComment ||
        input.metadata.commentEvidence?.creatorReplies?.[0] ||
        input.metadata.commentEvidence?.topComments?.[0] ||
        null,
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
    tinyCaptionPromptInput: input.fastPath?.tinyCaptionPromptInput ?? null,
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

async function readMetadata(
  inputUrl: string,
  options?: {
    mode?: ExtractionMode;
    attemptNumber?: number;
    includeComments?: boolean;
    triggerType?: ExtractionTriggerType;
    memoryTracker?: ReturnType<typeof createMemoryTracker>;
  },
) {
  let metadataFailureReason: string | null = null;
  const metadataStartedAt = nowMs();
  const canonicalUrl = canonicalizeUrl(inputUrl);
  const detectedPlatform = detectSourcePlatform(canonicalUrl);
  options?.memoryTracker?.checkpoint("before_metadata_fetch", {
    extra: {
      detectedPlatform,
      includeComments: Boolean(options?.includeComments),
      mode: options?.mode ?? "quick",
    },
  });
  const metadataFetchStartedAt = nowMs();
  const commentsStartedAt = nowMs();
  let commentsMs = 0;
  const commentsPromise =
    detectedPlatform === "instagram" &&
    options?.mode === "deep" &&
    (Number(options?.attemptNumber || 1) === 1 || options?.includeComments === true)
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
  options?.memoryTracker?.checkpoint("after_metadata_fetch", {
    extra: {
      metadataProvider: metadata.provider,
      metadataFailureReason,
      metadataFetchMs,
      metadataMs: nowMs() - metadataStartedAt,
      commentsMs,
      commentEvidenceAttempted: Boolean(metadata.commentEvidence?.attempted),
      commentTopCount: Array.isArray(metadata.commentEvidence?.topComments) ? metadata.commentEvidence.topComments.length : 0,
    },
  });
  return {
    metadata,
    metadataFailureReason,
    metadataMs: nowMs() - metadataStartedAt,
    metadataFetchMs,
    commentsMs,
  };
}

async function readTranscript(
  metadata: ExtractionResult["metadata"],
  options?: { memoryTracker?: ReturnType<typeof createMemoryTracker>; transcriptTimeoutMs?: number },
): Promise<{ transcript: TranscriptResult; transcriptMs: number; transcriptTimeoutMs: number }> {
  const transcriptStartedAt = nowMs();
  const transcriptTimeoutMs = options?.transcriptTimeoutMs ?? getNumberEnv("EXTRACTION_TRANSCRIPT_BUDGET_MS", DEFAULT_TRANSCRIPT_BUDGET_MS);
  options?.memoryTracker?.checkpoint("before_transcript_whisper", {
    extra: {
      platform: metadata.platform,
      metadataProvider: metadata.provider,
      transcriptTimeoutMs,
    },
  });
  const transcript = await withBudget(
    enrichWithTranscript(metadata),
    transcriptTimeoutMs,
    () => ({ attempted: true, used: false, source: null, text: "", reason: "timeout" }),
  );
  const transcriptMs = nowMs() - transcriptStartedAt;
  options?.memoryTracker?.checkpoint("after_transcript_whisper", {
    extra: {
      transcriptMs,
      transcriptUsed: Boolean(transcript.used),
      transcriptSource: transcript.source ?? null,
      transcriptChars: String(transcript.text || "").trim().length,
      transcriptReason: transcript.reason ?? null,
      transcriptTimeoutMs,
    },
  });
  return { transcript, transcriptMs, transcriptTimeoutMs };
}

export function getTranscriptTimeoutMsForAttempt(
  attemptNumber: number,
  platform: ExtractionResult["metadata"]["platform"] = "web",
): number {
  const configuredMs = getNumberEnv("EXTRACTION_TRANSCRIPT_BUDGET_MS", DEFAULT_TRANSCRIPT_BUDGET_MS);
  if (platform === "instagram") {
    if (attemptNumber <= 1) return Math.min(configuredMs, 45000);
    if (attemptNumber === 2) return Math.min(configuredMs, 60000);
    return Math.min(configuredMs, 90000);
  }
  if (attemptNumber <= 1) return Math.min(configuredMs, ATTEMPT1_TRANSCRIPT_BUDGET_MS);
  if (attemptNumber === 2) return Math.min(configuredMs, ATTEMPT2_TRANSCRIPT_BUDGET_MS);
  return Math.min(configuredMs, ATTEMPT3_TRANSCRIPT_BUDGET_MS);
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
    segments: [...(base?.segments || []), ...(extra?.segments || [])],
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
    provider: extra?.provider || base?.provider || null,
    regions: [...(base?.regions || []), ...(extra?.regions || [])],
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

function logFrameExtractionEvent(event: string, details: Record<string, unknown>) {
  console.info("[frame-extraction]", {
    event,
    ...details,
  });
}

async function processRetryFramesSequentially(input: {
  metadata: ExtractionResult["metadata"];
  transcript: TranscriptResult | null;
  selectionMode: ScreenshotSelectionMode;
  includeVisual: boolean;
  visualForceReason?: string | null;
  memoryTracker?: ReturnType<typeof createMemoryTracker>;
  priorAttemptHypotheses?: unknown[] | null;
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
  logFrameExtractionEvent("before_video_download", {
    canonicalUrl: input.metadata.canonicalUrl,
    selectionMode: input.selectionMode,
    includeVisual: input.includeVisual,
  });
  input.memoryTracker?.checkpoint("before_video_frame_download", {
    extra: {
      selectionMode: input.selectionMode,
      includeVisual: input.includeVisual,
      visualForceReason: input.visualForceReason ?? null,
    },
  });
  const manifest = await createFrameManifest(input.metadata, input.selectionMode);
  const frameExtractionMs = nowMs() - manifestStartedAt;
  logFrameExtractionEvent("after_video_download", {
    canonicalUrl: input.metadata.canonicalUrl,
    selectionMode: input.selectionMode,
    includeVisual: input.includeVisual,
    frameCount: manifest.frames.length,
    tempDir: manifest.tempDir,
    reason: (manifest.debug as Record<string, unknown>)?.reason ?? null,
  });
  input.memoryTracker?.checkpoint("after_video_frame_download", {
    frames: manifest.frames,
    extra: {
      selectionMode: input.selectionMode,
      includeVisual: input.includeVisual,
      frameExtractionMs,
      tempDir: manifest.tempDir,
      manifestDebugReason: (manifest.debug as Record<string, unknown>)?.reason ?? null,
    },
  });
  const screenshots: ScreenshotAsset[] = [];
  const ocrParts: string[] = [];
  const ocrRegions: NonNullable<OcrResult["regions"]> = [];
  let ocrReason: string | null = null;
  let bestVisual: VisualFallbackResult | null = null;
  const perFrameVisualDebug: unknown[] = [];
  const perFrameOcrDebug: Array<Record<string, unknown>> = [];
  let ocrOnlyMs = 0;
  let visualFallbackOnlyMs = 0;

  try {
    for (const [frameIndex, frame] of manifest.frames.entries()) {
      let screenshot: ScreenshotAsset | null = null;
      if (input.includeVisual) {
        logFrameExtractionEvent("before_load_frame_as_data_url", {
          frameLabel: frame.label,
          sourcePath: frame.sourcePath ?? null,
          sizeBytes: frame.sizeBytes ?? null,
        });
        input.memoryTracker?.checkpoint("before_screenshot_extraction", {
          frames: [frame],
          screenshots,
          extra: {
            frameLabel: frame.label,
            tempDir: manifest.tempDir,
          },
        });
        screenshot = await loadScreenshotAssetFromManifest(frame);
        if (!screenshot) continue;
        logFrameExtractionEvent("after_load_frame_as_data_url", {
          frameLabel: frame.label,
          sourcePath: frame.sourcePath ?? null,
          sizeBytes: frame.sizeBytes ?? screenshot.sizeBytes ?? null,
        });
        input.memoryTracker?.checkpoint("after_screenshot_extraction", {
          frames: [frame],
          screenshots: [screenshot],
          extra: {
            frameLabel: frame.label,
            originalWidth: frame.originalWidth ?? null,
            originalHeight: frame.originalHeight ?? null,
            resizedWidth: frame.resizedWidth ?? null,
            resizedHeight: frame.resizedHeight ?? null,
          },
        });
      }
      screenshots.push({
        url: `processed://${frame.label}`,
        origin: "video_frame",
        label: frame.label || "video_frame",
        frameIndex,
        timestampSec: frame.timestampSec ?? null,
        sizeBytes: frame.sizeBytes ?? null,
        sourcePath: frame.sourcePath ?? null,
        originalWidth: frame.originalWidth ?? null,
        originalHeight: frame.originalHeight ?? null,
        resizedWidth: frame.resizedWidth ?? null,
        resizedHeight: frame.resizedHeight ?? null,
      });

      const ocrStartedAt = nowMs();
      logFrameExtractionEvent("before_ocr_call", {
        frameLabel: frame.label,
        sourcePath: frame.sourcePath ?? null,
        sizeBytes: frame.sizeBytes ?? null,
        includeVisual: input.includeVisual,
      });
      input.memoryTracker?.checkpoint("before_ocr_per_frame", {
        frames: [frame],
        screenshots: screenshot ? [screenshot] : [],
        extra: {
          frameLabel: frame.label,
          priorHeldScreenshotCount: screenshots.length,
        },
      });
      const ocrResult = input.includeVisual
        ? await extractVisionOcrFromScreenshots(screenshot ? [screenshot] : [])
        : await extractImagePathOcr(frame.sourcePath || "");
      const ocrProvider = input.includeVisual ? "openai_vision" : ("provider" in ocrResult ? ocrResult.provider : null);
      const ocrDurationMs = nowMs() - ocrStartedAt;
      logFrameExtractionEvent("after_ocr_call", {
        frameLabel: frame.label,
        sourcePath: frame.sourcePath ?? null,
        ocrDurationMs,
        ocrTextChars: ocrResult.text.trim().length,
        ocrSnippet: ocrResult.text.trim().slice(0, 160) || null,
        ocrReason: ocrResult.reason ?? null,
        ocrProvider,
        includeVisual: input.includeVisual,
      });
      ocrOnlyMs += ocrDurationMs;
      if (ocrResult.text.trim()) {
        ocrParts.push(ocrResult.text.trim());
        ocrRegions.push({
          text: ocrResult.text.trim(),
          frameLabel: frame.label,
          frameIndex,
          timestampSec: frame.timestampSec ?? null,
          boundingBox: null,
        });
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
        compressedSizeBytes: frame.sizeBytes ?? screenshot?.sizeBytes ?? null,
        ocrDurationMs,
        ocrTextChars: ocrResult.text.trim().length,
        ocrSnippet: ocrResult.text.trim().slice(0, 160) || null,
        ocrUsed: Boolean(ocrResult.text.trim()),
        ocrReason: ocrResult.reason ?? null,
        ocrProvider,
      });
      input.memoryTracker?.checkpoint("after_ocr_per_frame", {
        frames: [frame],
        screenshots,
        extra: {
          frameLabel: frame.label,
          ocrDurationMs,
          ocrTextChars: ocrResult.text.trim().length,
          ocrReason: ocrResult.reason ?? null,
          ocrProvider,
        },
      });

      if (input.includeVisual) {
        const aggregateOcr: OcrResult = {
          attempted: true,
          used: ocrParts.length > 0,
          text: mergeOcrTexts(ocrParts),
          reason: ocrParts.length > 0 ? null : ocrReason || "vision_ocr_empty",
          regions: [...ocrRegions],
        };
        const visualStartedAt = nowMs();
        input.memoryTracker?.checkpoint("before_visual_fallback", {
          frames: [frame],
          screenshots: screenshot ? [screenshot] : [],
          extra: {
            frameLabel: frame.label,
            aggregateOcrChars: aggregateOcr.text.trim().length,
          },
        });
        const visualResult = await runVisualFallback({
          metadata: input.metadata,
          transcript: input.transcript,
          ocr: aggregateOcr,
          screenshots: screenshot ? [screenshot] : [],
          forceTrigger: Boolean(input.visualForceReason),
          forceTriggerReason: input.visualForceReason ?? null,
          priorAttemptHypotheses: input.priorAttemptHypotheses ?? null,
        });
        visualFallbackOnlyMs += nowMs() - visualStartedAt;
        input.memoryTracker?.checkpoint("after_visual_fallback", {
          frames: [frame],
          screenshots,
          extra: {
            frameLabel: frame.label,
            selectedCandidate: visualResult.selectedCandidate?.candidateName || null,
            confidence: visualResult.confidence,
            visualReason: visualResult.reason,
            candidateCount: Array.isArray(visualResult.candidates) ? visualResult.candidates.length : 0,
          },
        });
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

      // Ensure no data URL survives beyond the current frame iteration.
      if (screenshot) {
        screenshot.url = "";
      }

      if (frame.sourcePath) {
        try {
          await fs.unlink(frame.sourcePath);
        } catch {}
      }
      input.memoryTracker?.checkpoint("after_frame_cleanup", {
        frames: manifest.frames,
        screenshots,
        extra: {
          frameLabel: frame.label,
          tempDir: manifest.tempDir,
        },
      });
    }
  } finally {
    await cleanupFrameManifest(manifest.tempDir, manifest.frames);
    input.memoryTracker?.checkpoint("after_manifest_cleanup", {
      screenshots,
      extra: {
        tempDir: manifest.tempDir,
        frameCount: manifest.frames.length,
      },
    });
  }

  const mergedOcrText = mergeOcrTexts(ocrParts);
  console.info("[ocr-summary]", {
    frameCount: perFrameOcrDebug.length,
    combinedOcrChars: mergedOcrText.trim().length,
    combinedOcrSnippet: mergedOcrText.trim().slice(0, 220) || null,
  });
  const ocr: OcrResult = {
    attempted: true,
    used: Boolean(mergedOcrText),
    text: mergedOcrText,
    reason: mergedOcrText ? null : ocrReason || "vision_ocr_empty",
    provider: "frame_ocr",
    regions: ocrRegions,
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

function getAttemptExecutionProfileFromResult(result: ExtractionResult | null): AttemptExecutionProfile {
  const acceptedAfterRaw = result?.debug && typeof result.debug === "object"
    ? (result.debug as Record<string, any>)?.orchestration?.acceptedAfter
    : null;
  const routeRaw = result?.debug && typeof result.debug === "object"
    ? (result.debug as Record<string, any>)?.orchestration?.route
    : null;
  const acceptedAfter =
    acceptedAfterRaw === "description" ||
    acceptedAfterRaw === "transcript" ||
    acceptedAfterRaw === "ocr" ||
    acceptedAfterRaw === "visualFallback" ||
    acceptedAfterRaw === "manual_review"
      ? acceptedAfterRaw
      : null;
  const route =
    routeRaw === "quick" ||
    routeRaw === "attempt_1" ||
    routeRaw === "retry_1_long" ||
    routeRaw === "retry_1_refinement" ||
    routeRaw === "retry_2"
      ? routeRaw
      : null;
  const transcriptAttempted = Boolean(result?.transcript?.attempted);
  const ocrAttempted = Boolean(result?.ocr?.attempted);
  const usedLongLane =
    transcriptAttempted ||
    ocrAttempted ||
    acceptedAfter === "transcript" ||
    acceptedAfter === "ocr" ||
    acceptedAfter === "manual_review" ||
    acceptedAfter === "visualFallback";
  return {
    usedLongLane,
    acceptedAfter,
    route,
    transcriptAttempted,
    ocrAttempted,
  };
}

function getCachedAttemptExecutionProfile(input: {
  url: string;
  mode: ExtractionMode;
  attemptNumber: number;
}): AttemptExecutionProfile | null {
  const cacheKey = buildAttemptCacheKey(input.mode, input.url, input.attemptNumber);
  const cachedResult = getCachedAttemptResult(input);
  if (cachedResult) {
    const derived = getAttemptExecutionProfileFromResult(cachedResult);
    attemptExecutionProfileCache.set(cacheKey, {
      expiresAt: nowMs() + DEFAULT_CACHE_TTL_MS,
      profile: JSON.parse(JSON.stringify(derived)) as AttemptExecutionProfile,
    });
    return derived;
  }
  const cachedProfile = attemptExecutionProfileCache.get(cacheKey);
  if (!cachedProfile) return null;
  if (cachedProfile.expiresAt <= nowMs()) {
    attemptExecutionProfileCache.delete(cacheKey);
    return null;
  }
  return JSON.parse(JSON.stringify(cachedProfile.profile)) as AttemptExecutionProfile;
}

function saveAttemptExecutionProfile(input: {
  url: string;
  mode: ExtractionMode;
  attemptNumber: number;
  profile: AttemptExecutionProfile;
  ttlMs: number;
}) {
  const cacheKey = buildAttemptCacheKey(input.mode, input.url, input.attemptNumber);
  attemptExecutionProfileCache.set(cacheKey, {
    expiresAt: nowMs() + input.ttlMs,
    profile: JSON.parse(JSON.stringify(input.profile)) as AttemptExecutionProfile,
  });
}

export function resolveAttemptRoute(input: {
  attemptNumber: number;
  priorAttempt1Profile: AttemptExecutionProfile | null;
}): OrchestrationTrace["route"] {
  if (input.attemptNumber >= 3) return "retry_2";
  if (input.attemptNumber <= 1) return "attempt_1";
  const profile = input.priorAttempt1Profile;
  if (!profile) return "retry_1_long";
  return profile.usedLongLane ? "retry_1_refinement" : "retry_1_long";
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

function persistAttemptExecutionProfileFromResult(result: ExtractionResult, ttlMs: number) {
  const attemptNumber = Number(result.attemptInfo?.attemptNumber || 1);
  const mode = result.mode;
  const url = result.source || result.metadata.sourceUrl;
  const profile = getAttemptExecutionProfileFromResult(result);
  saveAttemptExecutionProfile({
    url,
    mode,
    attemptNumber,
    profile,
    ttlMs,
  });
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
  transcriptTimeoutMs?: number;
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
    tinyCaptionPromptInput?: Record<string, unknown> | null;
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
        transcriptTimeoutMs: input.transcriptTimeoutMs ?? getTranscriptTimeoutMsForAttempt(input.attemptNumber, input.metadata.platform),
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
  forceBackgroundEnrichment?: boolean;
  metadataOnlyEnrichment?: boolean;
  clientRunId?: string | null;
  onProgress?: ExtractionProgressReporter;
}): Promise<ExtractionResult> {
  const debugEnabled = Boolean(input.debug);
  const traceEnabled = isTraceEnabled(debugEnabled);
  const attemptNumber = normalizeAttemptNumber(input.attemptNumber);
  const triggerType = normalizeTriggerType(input.triggerType);
  const memoryTracker = createMemoryTracker({
    attemptNumber,
    triggerType,
    url: input.url,
    requestId: input.clientRunId || `${attemptNumber}:${triggerType}:${Date.now()}:${canonicalizeUrl(input.url)}`,
  });
  const cacheTtlMs = getNumberEnv("EXTRACTION_CACHE_TTL_MS", DEFAULT_CACHE_TTL_MS);
  const cacheKey = buildAttemptCacheKey(input.mode, input.url, attemptNumber);
  const sharedCacheKey = buildSharedCacheKey(input.mode, input.url);
  const priorAttempt1Profile = attemptNumber >= 2
    ? getCachedAttemptExecutionProfile({
        url: input.url,
        mode: input.mode,
        attemptNumber: 1,
      })
    : null;
  const route = resolveAttemptRoute({
    attemptNumber,
    priorAttempt1Profile,
  });
  const cached = extractionCache.get(cacheKey) || extractionCache.get(sharedCacheKey);
  const retryCacheDecision = cached && cached.expiresAt > nowMs()
    ? getRetryCacheDecision({
        attemptNumber,
        triggerType,
        cachedResult: cached.result,
      })
    : {
        bypass: false,
        reason: null,
        cachedStatus: null,
        cachedAcceptedAfter: null,
      };
  console.info("[extraction-cache]", {
    attemptNumber,
    triggerType,
    cacheAvailable: Boolean(cached && cached.expiresAt > nowMs()),
    cacheBypassedForRetry: retryCacheDecision.bypass,
    cacheBypassReason: retryCacheDecision.reason,
    cachedStatus: retryCacheDecision.cachedStatus,
    cachedAcceptedAfter: retryCacheDecision.cachedAcceptedAfter,
  });
  if (!debugEnabled && cached && cached.expiresAt > nowMs() && !retryCacheDecision.bypass) {
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
    persistAttemptExecutionProfileFromResult(cachedResult, Math.max(cached.expiresAt - nowMs(), 1));
    memoryTracker.checkpoint("before_final_response", {
      extra: {
        cacheHit: true,
        status: cachedResult.visualFallback?.selectedCandidate ? "visualFallback" : cachedResult.debug && typeof cachedResult.debug === "object"
          ? (cachedResult.debug as Record<string, any>)?.orchestration?.acceptedAfter ?? null
          : null,
      },
    });
    return cachedResult;
  }

  const totalStartedAt = nowMs();
  await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "started", "Extraction started.");
  await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "metadata_started", "Fetching metadata.");
  const { metadata, metadataFailureReason, metadataMs, metadataFetchMs, commentsMs } = await readMetadata(input.url, {
    mode: input.mode,
    attemptNumber,
    triggerType,
    includeComments: route === "retry_1_long",
    memoryTracker,
  });
  await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "metadata_done", "Metadata fetched.");
  const transcriptTimeoutMs = getTranscriptTimeoutMsForAttempt(attemptNumber, metadata.platform);

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
      transcriptTimeoutMs,
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
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "completed", "Extraction completed.");
    persistAttemptExecutionProfileFromResult(quickResult, cacheTtlMs);
    if (!debugEnabled && !isLowSignalInstagramResult(quickResult)) {
      extractionCache.set(cacheKey, { expiresAt: nowMs() + cacheTtlMs, result: cloneResult(quickResult) });
    }
    const agg = recordSla("extraction.total", quickResult.sla?.totalMs ?? quickResult.perf?.totalMs ?? 0);
    if (Number(process.env.EXTRACTION_SLA_LOG_EVERY || 0) > 0 && agg.sampleSize % Number(process.env.EXTRACTION_SLA_LOG_EVERY) === 0) {
      console.info("[sla][extraction.total]", { p50: agg.p50, p95: agg.p95, sampleSize: agg.sampleSize });
    }
    return quickResult;
  }

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
  let tinyCaptionPromptInput: Record<string, unknown> | null = null;
  let transcriptProbeMs = 0;
  let llmCallsBeforeResponse = 0;
  if (attemptNumber === 1 && !descriptionWeak) {
    tinyCaptionPromptInput = buildTinyCaptionPromptPayload(
      {
        mode: input.mode,
        metadata,
        transcript: { attempted: false, used: false, source: null, text: "", reason: "not_attempted" },
        ocr: { attempted: false, used: false, text: "", reason: "not_attempted" },
        visualFallback: null,
        attemptInfo: {
          attemptNumber,
          triggerType,
        },
        source: metadata.sourceUrl,
        platform: metadata.platform,
        canonicalUrl: metadata.canonicalUrl,
        ...buildCombinedText({
          metadata,
          transcript: null,
          ocr: null,
        }),
      },
      {
        clientRunId: input.clientRunId ?? null,
        requestId: input.clientRunId || null,
        attemptNumber,
        triggerType,
      },
    ) as Record<string, unknown>;
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "tiny_extractor_started", "Running tiny caption extractor.");
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
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "tiny_extractor_done", "Tiny caption extractor finished.");
  }
  const forceBackgroundEnrichment = shouldForceBackgroundLongLane({
    attemptNumber,
    forceBackgroundEnrichment: input.forceBackgroundEnrichment,
    descriptionWeak,
    descriptionAccepted: Boolean(descriptionProbe?.accepted),
  });
  const shouldRunTranscript = attemptNumber >= 2 || descriptionWeak || forceBackgroundEnrichment;
  let transcript: TranscriptResult = {
    attempted: false,
    used: false,
    source: null,
    text: "",
    reason: shouldRunTranscript ? "pending" : "skipped_description_accepted",
  };
  let transcriptMs = 0;

  if (
    attemptNumber === 1 &&
    !descriptionWeak &&
    ((descriptionProbe?.accepted && !forceBackgroundEnrichment) || input.metadataOnlyEnrichment)
  ) {
    pushDecision(
      orchestration,
      "description",
      true,
      input.metadataOnlyEnrichment
        ? "adaptive_caption_only_selected"
        : `accepted_description_tiny_${descriptionProbe?.confidence || "low"}`,
    );
    pushDecision(orchestration, "transcript", false, input.metadataOnlyEnrichment ? "adaptive_action_not_selected" : "description_confidence_sufficient");
    pushDecision(orchestration, "ocr", false, input.metadataOnlyEnrichment ? "adaptive_action_not_selected" : "description_confidence_sufficient");
    pushDecision(orchestration, "visualFallback", false, input.metadataOnlyEnrichment ? "adaptive_action_not_selected" : "initial_attempt_only");
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
      transcriptTimeoutMs,
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
        accepted: Boolean(descriptionProbe?.accepted),
        duplicateDescriptionLlmSkipped: true,
        result: descriptionFastResult,
        tinyFastExtractorUsed: true,
        tinyFastExtractorMs: descriptionProbeMs,
        tinyFastExtractorAccepted: Boolean(descriptionProbe?.accepted),
        tinyFastExtractorRejectedReason,
        modelUsedForTinyExtractor: descriptionFastModel,
        fullPromptSkipped: true,
        tinyCaptionPromptInput,
      },
    });
    if (traceEnabled) {
      console.info("[extraction-debug]", result.debug);
    }
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "accepted_description", "Accepted after caption evidence.");
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "completed", "Extraction completed.");
    persistAttemptExecutionProfileFromResult(result, cacheTtlMs);
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
    memoryTracker.checkpoint("before_final_response", {
      extra: {
        cacheHit: false,
        acceptedAfter: "description",
        llmCallsBeforeResponse,
      },
    });
    return result;
  }

  pushDecision(
    orchestration,
    "description",
    !descriptionProbeFailureReason,
    attemptNumber === 1
      ? descriptionProbeFailureReason ||
        (forceBackgroundEnrichment
        ? "accepted_description_background_enrichment_continues_long_lane"
        : descriptionWeak
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
      await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "transcript_started", "Reading transcript clues.");
      const transcriptRead = await readTranscript(metadata, { memoryTracker, transcriptTimeoutMs });
      transcript = mergeTranscriptResults(inheritedTranscript, transcriptRead.transcript) ?? {
        attempted: true,
        used: false,
        source: transcriptRead.transcript.source || null,
        text: "",
        reason: transcriptRead.transcript.reason || "retry_2_transcript_missing_rerun",
      };
      transcriptMs = transcriptRead.transcriptMs;
      await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "transcript_done", "Transcript step finished.");
      orchestration.transcriptReused = false;
      pushDecision(orchestration, "transcript", true, "retry_2_transcript_missing_rerun");
    }
    pushDecision(orchestration, "ocr", true, "retry_2_frame_ocr");
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "frame_extraction_started", "Checking video frames.");
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "ocr_started", "Reading on-screen text.");
    if (visualFallbackPolicy.includeVisual) {
      await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "visual_started", "Trying visual match.");
    }
    const sequential = await processRetryFramesSequentially({
      metadata,
      transcript,
      selectionMode: "scene_edges",
      includeVisual: visualFallbackPolicy.includeVisual,
      visualForceReason: visualFallbackPolicy.includeVisual ? visualFallbackPolicy.decisionReason : null,
      memoryTracker,
      priorAttemptHypotheses,
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
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "frame_extraction_done", "Frame check finished.");
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "ocr_done", "On-screen text step finished.");
    if (visualFallbackPolicy.includeVisual) {
      await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "visual_done", "Visual match finished.");
    }
    orchestration.ocrFrameCount = sequential.screenshots.length;
    orchestration.visualFrameCount = sequential.screenshots.length;
  } else if (attemptNumber === 2 && route === "retry_1_refinement") {
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
      pushDecision(orchestration, "transcript", false, "retry_1_refinement_transcript_reused");
    } else {
      await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "transcript_started", "Reading transcript clues.");
      const transcriptRead = await readTranscript(metadata, { memoryTracker, transcriptTimeoutMs });
      transcript = mergeTranscriptResults(reusedTranscript ?? null, transcriptRead.transcript) ?? {
        attempted: true,
        used: false,
        source: transcriptRead.transcript.source || null,
        text: "",
        reason: transcriptRead.transcript.reason || "retry_1_refinement_transcript_missing_rerun",
      };
      transcriptMs = transcriptRead.transcriptMs;
      await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "transcript_done", "Transcript step finished.");
      orchestration.transcriptReused = false;
      pushDecision(orchestration, "transcript", true, "retry_1_refinement_transcript_missing_rerun");
    }
    pushDecision(orchestration, "ocr", true, "retry_1_refinement_frame_ocr");
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "frame_extraction_started", "Checking video frames.");
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "ocr_started", "Reading on-screen text.");
    const sequential = await processRetryFramesSequentially({
      metadata,
      transcript,
      selectionMode: "anchors",
      includeVisual: false,
      memoryTracker,
      priorAttemptHypotheses,
    });
    screenshots = sequential.screenshots;
    screenshotsDebug = sequential.screenshotsDebug;
    ocr = mergeOcrResults(priorAttempt1?.ocr ?? null, sequential.ocr) ?? sequential.ocr;
    ocrMs = sequential.ocrMs;
    frameExtractionMs = sequential.frameExtractionMs;
    ocrOnlyMs = sequential.ocrOnlyMs;
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "frame_extraction_done", "Frame check finished.");
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "ocr_done", "On-screen text step finished.");
    orchestration.ocrFrameCount = sequential.screenshots.length;
    orchestration.visualFrameCount = 0;
  } else if (attemptNumber === 2) {
    orchestration.inheritedEvidence = {
      transcriptAttempts: [],
      ocrAttempts: [],
    };
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "transcript_started", "Reading transcript clues.");
    const transcriptRead = await readTranscript(metadata, { memoryTracker, transcriptTimeoutMs });
    transcript = transcriptRead.transcript;
    transcriptMs = transcriptRead.transcriptMs;
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "transcript_done", "Transcript step finished.");
    orchestration.transcriptReused = false;
    pushDecision(orchestration, "transcript", true, "retry_1_long_lane_transcript");
    pushDecision(orchestration, "ocr", true, "retry_1_long_lane_frame_ocr");
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "frame_extraction_started", "Checking video frames.");
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "ocr_started", "Reading on-screen text.");
    const sequential = await processRetryFramesSequentially({
      metadata,
      transcript,
      selectionMode: "anchors",
      includeVisual: false,
      memoryTracker,
      priorAttemptHypotheses,
    });
    screenshots = sequential.screenshots;
    screenshotsDebug = sequential.screenshotsDebug;
    ocr = sequential.ocr;
    ocrMs = sequential.ocrMs;
    frameExtractionMs = sequential.frameExtractionMs;
    ocrOnlyMs = sequential.ocrOnlyMs;
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "frame_extraction_done", "Frame check finished.");
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "ocr_done", "On-screen text step finished.");
    orchestration.ocrFrameCount = sequential.screenshots.length;
    orchestration.visualFrameCount = 0;
  } else {
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "transcript_started", "Reading transcript clues.");
    const transcriptRead = await readTranscript(metadata, { memoryTracker, transcriptTimeoutMs });
    transcript = transcriptRead.transcript;
    transcriptMs = transcriptRead.transcriptMs;
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "transcript_done", "Transcript step finished.");
    const transcriptProbeResult = await safeProbeLlmConfidence(
      {
        metadata,
        mode: input.mode,
        attemptNumber,
        triggerType,
        transcript,
        probeStage: "transcript",
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

    if (!forceBackgroundEnrichment && shouldSkipOcrAfterTranscriptProbe(transcript, transcriptProbe)) {
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
      transcriptTimeoutMs,
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
          tinyCaptionPromptInput,
        },
      });
      if (traceEnabled) {
        console.info("[extraction-debug]", result.debug);
      }
      await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "completed", "Extraction completed.");
      persistAttemptExecutionProfileFromResult(result, cacheTtlMs);
      if (!debugEnabled && !isLowSignalInstagramResult(result)) {
        extractionCache.set(cacheKey, { expiresAt: nowMs() + cacheTtlMs, result: cloneResult(result) });
        extractionCache.set(sharedCacheKey, { expiresAt: nowMs() + cacheTtlMs, result: cloneResult(result) });
      }
      const agg = recordSla("extraction.total", result.sla?.totalMs ?? result.perf?.totalMs ?? 0);
      if (Number(process.env.EXTRACTION_SLA_LOG_EVERY || 0) > 0 && agg.sampleSize % Number(process.env.EXTRACTION_SLA_LOG_EVERY) === 0) {
        console.info("[sla][extraction.total]", { p50: agg.p50, p95: agg.p95, sampleSize: agg.sampleSize });
      }
      memoryTracker.checkpoint("before_final_response", {
        extra: {
          cacheHit: false,
          acceptedAfter: "transcript",
          llmCallsBeforeResponse,
        },
      });
      return result;
    }

    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "frame_extraction_started", "Checking video frames.");
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "ocr_started", "Reading on-screen text.");
    if (forceBackgroundEnrichment) {
      await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "visual_started", "Trying visual match.");
    }
    const sequential = await processRetryFramesSequentially({
      metadata,
      transcript,
      selectionMode: "anchors",
      includeVisual: forceBackgroundEnrichment,
      visualForceReason: forceBackgroundEnrichment ? "background_post_save_standard_visual_enrichment" : null,
      memoryTracker,
      priorAttemptHypotheses,
    });
    screenshots = sequential.screenshots;
    screenshotsDebug = sequential.screenshotsDebug;
    pushDecision(orchestration, "ocr", true, "attempt_1_frame_ocr_after_transcript_probe");
    ocr = sequential.ocr;
    ocrMs = sequential.ocrMs;
    frameExtractionMs = sequential.frameExtractionMs;
    ocrOnlyMs = sequential.ocrOnlyMs;
    visualFallback = sequential.visualFallback;
    visualFallbackMs = sequential.visualFallbackMs;
    visualFallbackOnlyMs = sequential.visualFallbackOnlyMs;
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "frame_extraction_done", "Frame check finished.");
    await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "ocr_done", "On-screen text step finished.");
    if (forceBackgroundEnrichment) {
      await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "visual_done", "Visual match finished.");
    }
    orchestration.ocrFrameCount = sequential.screenshots.length;
    orchestration.visualFrameCount = forceBackgroundEnrichment ? sequential.screenshots.length : 0;
  }

  if (attemptNumber >= 3) {
    pushDecision(orchestration, "visualFallback", true, visualFallbackPolicy.decisionReason);
    finalizeTrace(orchestration, visualFallback.selectedCandidate ? "visualFallback" : "manual_review");
  } else if (forceBackgroundEnrichment) {
    pushDecision(orchestration, "visualFallback", true, "background_post_save_standard_visual_enrichment");
    finalizeTrace(
      orchestration,
      visualFallback.selectedCandidate
        ? "visualFallback"
        : hasMeaningfulOcr(ocr)
          ? "ocr"
          : hasMeaningfulTranscript(transcript)
            ? "transcript"
            : "manual_review",
    );
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
    transcriptTimeoutMs,
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
      tinyCaptionPromptInput,
    },
  });

  if (traceEnabled) {
    console.info("[extraction-debug]", result.debug);
  }
  await emitProgress(input.onProgress, totalStartedAt, attemptNumber, "completed", "Extraction completed.");
  persistAttemptExecutionProfileFromResult(result, cacheTtlMs);
  if (!debugEnabled && !isLowSignalInstagramResult(result)) {
    extractionCache.set(cacheKey, { expiresAt: nowMs() + cacheTtlMs, result: cloneResult(result) });
    extractionCache.set(sharedCacheKey, { expiresAt: nowMs() + cacheTtlMs, result: cloneResult(result) });
  }
  const agg = recordSla("extraction.total", result.sla?.totalMs ?? result.perf?.totalMs ?? 0);
  if (Number(process.env.EXTRACTION_SLA_LOG_EVERY || 0) > 0 && agg.sampleSize % Number(process.env.EXTRACTION_SLA_LOG_EVERY) === 0) {
    console.info("[sla][extraction.total]", { p50: agg.p50, p95: agg.p95, sampleSize: agg.sampleSize });
  }
  memoryTracker.checkpoint("before_final_response", {
    screenshots,
    extra: {
      cacheHit: false,
      acceptedAfter: orchestration.acceptedAfter,
      llmCallsBeforeResponse,
      ocrChars: String(ocr.text || "").trim().length,
      visualSelectedCandidate: visualFallback.selectedCandidate?.candidateName || null,
    },
  });
  return result;
}
