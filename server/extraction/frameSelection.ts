import type { ExtractedMetadata, ScreenshotAsset } from "./types";
import { runPythonJsonScript } from "./pythonRunner";

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

export async function selectSourceScreenshotsDetailed(metadata: ExtractedMetadata): Promise<{
  screenshots: ScreenshotAsset[];
  debug: Record<string, unknown>;
}> {
  const screenshots: ScreenshotAsset[] = [];
  let frameDebug: Record<string, unknown> = {
    didRun: false,
    reason: metadata.platform === "youtube" || metadata.platform === "instagram" ? null : "unsupported_platform",
  };

  if (metadata.platform === "youtube" || metadata.platform === "instagram") {
    const parsed = await runPythonJsonScript("fetch_video_frames.py", metadata.canonicalUrl, 180000);
    const frames = Array.isArray(parsed?.frames) ? parsed.frames : [];
    frameDebug = {
      didRun: true,
      ok: Boolean(parsed?.ok),
      error: parsed?.error || parsed?.errorCode || parsed?.status || null,
      count: typeof parsed?.count === "number" ? parsed.count : frames.length,
      durationSeconds: typeof parsed?.durationSeconds === "number" ? parsed.durationSeconds : null,
      mediaUrlAvailable: Boolean(parsed?.debug?.media?.mediaUrlAvailable),
      ffmpegAvailable: Boolean(parsed?.debug?.runtime?.resolvedFfmpegPath),
      imageioFfmpegAvailable: Boolean(parsed?.debug?.runtime?.imageioFfmpeg?.ok),
      ffmpegLocation: parsed?.ffmpegLocation || parsed?.debug?.runtime?.resolvedFfmpegPath || null,
      timestamps: frames.map((frame: any) => (typeof frame?.timestampSec === "number" ? frame.timestampSec : null)),
      frameFilePaths: parsed?.debug?.frameExtraction?.frameFilePaths || [],
      frameFileSizes: parsed?.debug?.frameExtraction?.frameFileSizes || [],
      runtime: parsed?.debug?.runtime || null,
      rawError: parsed?.stderr || null,
    };
    for (const frame of frames.slice(0, 4)) {
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
