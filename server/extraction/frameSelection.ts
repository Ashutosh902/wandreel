import type { ExtractedMetadata, ScreenshotAsset } from "./types";
import { runPythonJsonScript } from "./pythonRunner";

function toDataUrl(mimeType: string, dataBase64: string): string {
  return `data:${mimeType};base64,${dataBase64}`;
}

export async function selectSourceScreenshots(metadata: ExtractedMetadata): Promise<ScreenshotAsset[]> {
  const screenshots: ScreenshotAsset[] = [];

  if (metadata.platform === "youtube" || metadata.platform === "instagram") {
    const parsed = await runPythonJsonScript("fetch_video_frames.py", metadata.canonicalUrl, 180000);
    const frames = Array.isArray(parsed?.frames) ? parsed.frames : [];
    for (const frame of frames.slice(0, 4)) {
      const mimeType = typeof frame?.mimeType === "string" && frame.mimeType.trim() ? frame.mimeType.trim() : "image/jpeg";
      const dataBase64 = typeof frame?.dataBase64 === "string" ? frame.dataBase64.trim() : "";
      if (!dataBase64) continue;
      screenshots.push({
        url: toDataUrl(mimeType, dataBase64),
        origin: "video_frame",
        label: typeof frame?.label === "string" && frame.label.trim() ? frame.label.trim() : "video_frame",
        timestampSec: typeof frame?.timestampSec === "number" ? frame.timestampSec : null,
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
    });
  }

  return screenshots;
}
