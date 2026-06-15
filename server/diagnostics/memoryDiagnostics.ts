import type { ExtractionTriggerType, ScreenshotAsset } from "../extraction/types";
import type { FrameManifestItem } from "../extraction/frameSelection";

type MemoryCheckpointOptions = {
  stage: string;
  attemptNumber: number;
  triggerType: ExtractionTriggerType | "unknown";
  url?: string | null;
  requestId?: string | null;
  screenshots?: ScreenshotAsset[] | null;
  frames?: FrameManifestItem[] | null;
  extra?: Record<string, unknown>;
  previousAtMs?: number | null;
  nowMs?: number;
};

type MemoryTracker = {
  checkpoint: (stage: string, options?: Omit<MemoryCheckpointOptions, "stage" | "attemptNumber" | "triggerType" | "url" | "requestId" | "previousAtMs" | "nowMs">) => void;
};

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function approximateScreenshotBytes(screenshot: ScreenshotAsset): number | null {
  if (typeof screenshot.sizeBytes === "number" && Number.isFinite(screenshot.sizeBytes)) return screenshot.sizeBytes;
  if (typeof screenshot.url === "string" && screenshot.url.startsWith("data:")) {
    return Math.max(0, Math.round(screenshot.url.length * 0.75));
  }
  return null;
}

function summarizeScreenshots(screenshots: ScreenshotAsset[] | null | undefined) {
  const items = Array.isArray(screenshots) ? screenshots : [];
  return items.slice(0, 8).map((shot) => ({
    label: shot.label,
    origin: shot.origin,
    timestampSec: safeNumber(shot.timestampSec),
    sizeBytes: approximateScreenshotBytes(shot),
    sourcePath: shot.sourcePath ?? null,
    urlKind: typeof shot.url === "string" && shot.url.startsWith("data:") ? "data_url" : "non_data_url",
  }));
}

function summarizeFrames(frames: FrameManifestItem[] | null | undefined) {
  const items = Array.isArray(frames) ? frames : [];
  return items.slice(0, 8).map((frame) => ({
    label: frame.label,
    timestampSec: safeNumber(frame.timestampSec),
    sizeBytes: safeNumber(frame.sizeBytes),
    sourcePath: frame.sourcePath ?? null,
    originalWidth: safeNumber(frame.originalWidth),
    originalHeight: safeNumber(frame.originalHeight),
    resizedWidth: safeNumber(frame.resizedWidth),
    resizedHeight: safeNumber(frame.resizedHeight),
  }));
}

function aggregateApproxBytes(options: {
  screenshots?: ScreenshotAsset[] | null;
  frames?: FrameManifestItem[] | null;
}) {
  const screenshotBytes = (options.screenshots || []).reduce((sum, item) => sum + (approximateScreenshotBytes(item) || 0), 0);
  const frameBytes = (options.frames || []).reduce((sum, item) => sum + (safeNumber(item.sizeBytes) || 0), 0);
  return screenshotBytes + frameBytes;
}

function truncateUrl(url: string | null | undefined): string | null {
  const value = String(url || "").trim();
  if (!value) return null;
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}

export function logMemoryCheckpoint(options: MemoryCheckpointOptions) {
  const usage = process.memoryUsage();
  const screenshots = Array.isArray(options.screenshots) ? options.screenshots : [];
  const frames = Array.isArray(options.frames) ? options.frames : [];
  const now = options.nowMs ?? Date.now();
  const elapsedSincePreviousMs =
    typeof options.previousAtMs === "number" && Number.isFinite(options.previousAtMs)
      ? Math.max(0, now - options.previousAtMs)
      : null;

  console.info("[memory-diag]", {
    stage: options.stage,
    attemptNumber: options.attemptNumber,
    triggerType: options.triggerType,
    requestId: options.requestId ?? null,
    url: truncateUrl(options.url),
    elapsedSincePreviousMs,
    memory: {
      rss: usage.rss,
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      arrayBuffers: "arrayBuffers" in usage ? (usage as NodeJS.MemoryUsage & { arrayBuffers?: number }).arrayBuffers ?? null : null,
    },
    held: {
      frameCount: frames.length,
      imageCount: screenshots.length,
      approxBytes: aggregateApproxBytes({ screenshots, frames }),
      frames: summarizeFrames(frames),
      screenshots: summarizeScreenshots(screenshots),
    },
    ...options.extra,
  });
}

export function createMemoryTracker(input: {
  attemptNumber: number;
  triggerType: ExtractionTriggerType | "unknown";
  url?: string | null;
  requestId?: string | null;
}): MemoryTracker {
  let lastAtMs: number | null = null;
  return {
    checkpoint(stage, options) {
      const now = Date.now();
      logMemoryCheckpoint({
        stage,
        attemptNumber: input.attemptNumber,
        triggerType: input.triggerType,
        url: input.url ?? null,
        requestId: input.requestId ?? null,
        previousAtMs: lastAtMs,
        nowMs: now,
        screenshots: options?.screenshots ?? null,
        frames: options?.frames ?? null,
        extra: options?.extra,
      });
      lastAtMs = now;
    },
  };
}
