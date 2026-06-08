import type { ExtractedMetadata, OcrResult, ScreenshotAsset } from "./types";
import { runPythonJsonScript } from "./pythonRunner";
import { extractVisionOcr, extractVisionOcrFromScreenshots } from "./visionOcr";
import { selectSourceScreenshots } from "./frameSelection";

export async function enrichWithFrameOcr(metadata: ExtractedMetadata, screenshotsInput?: ScreenshotAsset[]): Promise<OcrResult> {
  const screenshots = screenshotsInput ?? (await selectSourceScreenshots(metadata));
  if (screenshots.length > 0) {
    const visionScreens = await extractVisionOcrFromScreenshots(screenshots);
    if (visionScreens.text.trim()) {
      return { attempted: true, used: true, text: visionScreens.text.trim(), reason: null };
    }
  }

  if (metadata.platform === "youtube" || metadata.platform === "instagram") {
    const parsed = await runPythonJsonScript("fetch_ocr_text.py", metadata.canonicalUrl, 120000);
    if (parsed?.ok && typeof parsed.text === "string" && parsed.text.trim()) {
      return { attempted: true, used: true, text: parsed.text.trim(), reason: null };
    }

    const pythonReason = typeof parsed?.errorCode === "string"
      ? parsed.errorCode
      : typeof parsed?.status === "string"
        ? parsed.status
        : typeof parsed?.error === "string"
          ? parsed.error
          : "ocr_not_available";

    if (metadata.imageUrl) {
      const vision = await extractVisionOcr(metadata.imageUrl);
      if (vision.text.trim()) {
        return { attempted: true, used: true, text: vision.text.trim(), reason: null };
      }
      if (vision.reason) {
        return {
          attempted: true,
          used: false,
          text: "",
          reason: `${pythonReason};${vision.reason}`,
        };
      }
    }

    return {
      attempted: true,
      used: false,
      text: "",
      reason: pythonReason,
    };
  }

  if (metadata.imageUrl) {
    const vision = await extractVisionOcr(metadata.imageUrl);
    if (vision.text.trim()) {
      return { attempted: true, used: true, text: vision.text.trim(), reason: null };
    }
    if (vision.reason) {
      return {
        attempted: true,
        used: false,
        text: "",
        reason: vision.reason,
      };
    }
  }

  return {
    attempted: screenshots.length > 0 || Boolean(metadata.imageUrl),
    used: false,
    text: "",
    reason: screenshots.length > 0 ? "vision_ocr_empty" : "ocr_not_available",
  };
}
