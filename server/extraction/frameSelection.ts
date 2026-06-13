import type { ExtractedMetadata, ScreenshotAsset } from "./types";
import { runPythonJsonScriptWithArgs } from "./pythonRunner";
import fs from "node:fs/promises";

function isInstagramUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().includes("instagram.com");
  } catch {
    return false;
  }
}

export type ScreenshotSelectionMode = "anchors" | "scene_edges";
export type FrameManifestItem = {
  label: string;
  timestampSec: number | null;
  mimeType: string;
  sizeBytes: number | null;
  sourcePath: string | null;
  originalWidth?: number | null;
  originalHeight?: number | null;
  resizedWidth?: number | null;
  resizedHeight?: number | null;
};

function toDataUrl(mimeType: string, dataBase64: string): string {
  return `data:${mimeType};base64,${dataBase64}`;
}

function byteLengthFromBase64(dataBase64: string): number {
  const clean = dataBase64.replace(/\s+/g, "");
  if (!clean) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

function summarizeScreenshots(screenshots: ScreenshotAsset[]) {
  return screenshots.map((shot) => ({
    origin: shot.origin,
    label: shot.label,
    timestampSec: shot.timestampSec ?? null,
    sizeBytes: shot.sizeBytes ?? (shot.url.startsWith("data:") ? Math.round(shot.url.length * 0.75) : null),
    sourcePath: shot.sourcePath ?? null,
    urlKind: shot.url.startsWith("data:") ? "data_url" : "remote_url",
  }));
}

export async function selectSourceScreenshotsDetailed(
  metadata: ExtractedMetadata,
  selectionMode: ScreenshotSelectionMode = "anchors",
): Promise<{
  screenshots: ScreenshotAsset[];
  debug: Record<string, unknown>;
}> {
  const screenshots: ScreenshotAsset[] = [];
  let frameDebug: Record<string, unknown> = {
    didRun: false,
    reason: metadata.platform === "youtube" || metadata.platform === "instagram" ? null : "unsupported_platform",
  };

  if (metadata.platform === "youtube" || metadata.platform === "instagram") {
    const parsed = await runPythonJsonScriptWithArgs("fetch_video_frames.py", [metadata.canonicalUrl, selectionMode], 180000);
    const frames = Array.isArray(parsed?.frames) ? parsed.frames : [];
    frameDebug = {
      didRun: true,
      selectionMode,
      ok: Boolean(parsed?.ok),
      reason:
        parsed?.debug?.frameExtraction?.reason ||
        parsed?.error ||
        parsed?.errorCode ||
        parsed?.status ||
        (frames.length ? "frames_extracted" : "no_frames_returned"),
      error: parsed?.error || parsed?.errorCode || parsed?.status || null,
      count: typeof parsed?.count === "number" ? parsed.count : frames.length,
      durationSeconds: typeof parsed?.durationSeconds === "number" ? parsed.durationSeconds : null,
      mediaUrlAvailable: Boolean(parsed?.debug?.media?.mediaUrlAvailable),
      ytDlpExitCode: parsed?.debug?.ytDlp?.exitCode ?? null,
      ytDlpStderrShortPreview: parsed?.debug?.ytDlp?.stderrShortPreview ?? null,
      ffmpegAvailable: Boolean(parsed?.debug?.runtime?.resolvedFfmpegPath),
      imageioFfmpegAvailable: Boolean(parsed?.debug?.runtime?.imageioFfmpeg?.ok),
      ffmpegLocation: parsed?.ffmpegLocation || parsed?.debug?.runtime?.resolvedFfmpegPath || null,
      timestamps: frames.map((frame: any) => (typeof frame?.timestampSec === "number" ? frame.timestampSec : null)),
      frameFilePaths: parsed?.debug?.frameExtraction?.frameFilePaths || [],
      frameFileSizes: parsed?.debug?.frameExtraction?.frameFileSizes || [],
      runtime: parsed?.debug?.runtime || null,
      rawError: parsed?.stderr || null,
    };
    const maxVideoFrames = selectionMode === "scene_edges" ? 7 : 4;
    for (const frame of frames.slice(0, maxVideoFrames)) {
      const mimeType = typeof frame?.mimeType === "string" && frame.mimeType.trim() ? frame.mimeType.trim() : "image/jpeg";
      const dataBase64 = typeof frame?.dataBase64 === "string" ? frame.dataBase64.trim() : "";
      if (!dataBase64) continue;
      screenshots.push({
        url: toDataUrl(mimeType, dataBase64),
        origin: "video_frame",
        label: typeof frame?.label === "string" && frame.label.trim() ? frame.label.trim() : "video_frame",
        timestampSec: typeof frame?.timestampSec === "number" ? frame.timestampSec : null,
        sizeBytes: typeof frame?.sizeBytes === "number" ? frame.sizeBytes : byteLengthFromBase64(dataBase64),
        sourcePath: typeof frame?.sourcePath === "string" ? frame.sourcePath : null,
      });
    }
  }

  const imageUrl = String(metadata.imageUrl || "").trim();
  if (imageUrl) {
    screenshots.push({
      url: imageUrl,
      origin: "metadata_image",
      label: metadata.siteName || metadata.provider,
      timestampSec: null,
      sizeBytes: null,
      sourcePath: null,
    });
  }

  return {
    screenshots,
    debug: {
      mediaIngestion: {
        platform: metadata.platform,
        canonicalUrl: metadata.canonicalUrl,
        metadataProvider: metadata.provider,
        platformDetectionResult: metadata.platform,
        instagramUrlDetectionResult: isInstagramUrl(metadata.canonicalUrl),
        mediaUrlAvailable: Boolean((frameDebug as any).mediaUrlAvailable),
        thumbnailImageUrlAvailable: Boolean(imageUrl),
      },
      frameExtraction: frameDebug,
      screenshots: {
        count: screenshots.length,
        videoFrameCount: screenshots.filter((shot) => shot.origin === "video_frame").length,
        metadataImageCount: screenshots.filter((shot) => shot.origin === "metadata_image").length,
        sentCandidates: summarizeScreenshots(screenshots),
      },
    },
  };
}

export async function selectSourceScreenshots(metadata: ExtractedMetadata): Promise<ScreenshotAsset[]> {
  return (await selectSourceScreenshotsDetailed(metadata)).screenshots;
}

export async function createFrameManifest(
  metadata: ExtractedMetadata,
  selectionMode: ScreenshotSelectionMode,
): Promise<{
  frames: FrameManifestItem[];
  tempDir: string | null;
  debug: Record<string, unknown>;
}> {
  if (metadata.platform !== "youtube" && metadata.platform !== "instagram") {
    return {
      frames: [],
      tempDir: null,
      debug: {
        didRun: false,
        selectionMode,
        reason: "unsupported_platform",
      },
    };
  }

  const parsed = await runPythonJsonScriptWithArgs("fetch_video_frames.py", [metadata.canonicalUrl, selectionMode, "manifest"], 180000);
  const frames = Array.isArray(parsed?.frames)
    ? parsed.frames.map((frame: any) => ({
        label: typeof frame?.label === "string" ? frame.label : "video_frame",
        timestampSec: typeof frame?.timestampSec === "number" ? frame.timestampSec : null,
        mimeType: typeof frame?.mimeType === "string" ? frame.mimeType : "image/jpeg",
        sizeBytes: typeof frame?.sizeBytes === "number" ? frame.sizeBytes : null,
        sourcePath: typeof frame?.sourcePath === "string" ? frame.sourcePath : null,
        originalWidth: typeof frame?.originalWidth === "number" ? frame.originalWidth : null,
        originalHeight: typeof frame?.originalHeight === "number" ? frame.originalHeight : null,
        resizedWidth: typeof frame?.resizedWidth === "number" ? frame.resizedWidth : null,
        resizedHeight: typeof frame?.resizedHeight === "number" ? frame.resizedHeight : null,
      }))
    : [];

  return {
    frames,
    tempDir: typeof parsed?.debug?.frameExtraction?.tempDir === "string" ? parsed.debug.frameExtraction.tempDir : null,
    debug: {
      didRun: true,
      selectionMode,
      ok: Boolean(parsed?.ok),
      reason:
        parsed?.debug?.frameExtraction?.reason ||
        parsed?.error ||
        parsed?.errorCode ||
        parsed?.status ||
        (frames.length ? "frames_extracted" : "no_frames_returned"),
      error: parsed?.error || parsed?.errorCode || parsed?.status || null,
      count: typeof parsed?.count === "number" ? parsed.count : frames.length,
      durationSeconds: typeof parsed?.durationSeconds === "number" ? parsed.durationSeconds : null,
      mediaUrlAvailable: Boolean(parsed?.debug?.media?.mediaUrlAvailable),
      ytDlpExitCode: parsed?.debug?.ytDlp?.exitCode ?? null,
      ytDlpStderrShortPreview: parsed?.debug?.ytDlp?.stderrShortPreview ?? null,
      ffmpegAvailable: Boolean(parsed?.debug?.runtime?.resolvedFfmpegPath),
      imageioFfmpegAvailable: Boolean(parsed?.debug?.runtime?.imageioFfmpeg?.ok),
      ffmpegLocation: parsed?.ffmpegLocation || parsed?.debug?.runtime?.resolvedFfmpegPath || null,
      timestamps: frames.map((frame: FrameManifestItem) => frame.timestampSec),
      frameFilePaths: frames.map((frame: FrameManifestItem) => frame.sourcePath),
      frameFileSizes: frames.map((frame: FrameManifestItem) => frame.sizeBytes),
      runtime: parsed?.debug?.runtime || null,
      rawError: parsed?.stderr || null,
      tempDir: typeof parsed?.debug?.frameExtraction?.tempDir === "string" ? parsed.debug.frameExtraction.tempDir : null,
    },
  };
}

export async function loadScreenshotAssetFromManifest(frame: FrameManifestItem): Promise<ScreenshotAsset | null> {
  if (!frame.sourcePath) return null;
  const raw = await fs.readFile(frame.sourcePath);
  const encoded = raw.toString("base64");
  return {
    url: `data:${frame.mimeType || "image/jpeg"};base64,${encoded}`,
    origin: "video_frame",
    label: frame.label || "video_frame",
    timestampSec: frame.timestampSec ?? null,
    sizeBytes: frame.sizeBytes ?? raw.byteLength,
    sourcePath: frame.sourcePath,
  };
}
