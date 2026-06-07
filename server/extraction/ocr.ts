import type { ExtractedMetadata, OcrResult } from "./types";
import { runPythonJsonScript } from "./pythonRunner";
import { extractVisionOcr } from "./visionOcr";

export async function enrichWithFrameOcr(metadata: ExtractedMetadata): Promise<OcrResult> {
  if (metadata.platform !== "youtube" && metadata.platform !== "instagram") {
    return { attempted: false, used: false, text: "", reason: "unsupported_platform" };
  }

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
