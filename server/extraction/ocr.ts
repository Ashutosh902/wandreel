import type { ExtractedMetadata, OcrResult } from "./types";
import { runPythonJsonScript } from "./pythonRunner";

export async function enrichWithFrameOcr(metadata: ExtractedMetadata): Promise<OcrResult> {
  if (metadata.platform !== "youtube" && metadata.platform !== "instagram") {
    return { attempted: false, used: false, text: "", reason: "unsupported_platform" };
  }

  const parsed = await runPythonJsonScript("fetch_ocr_text.py", metadata.canonicalUrl, 120000);
  if (parsed?.ok && typeof parsed.text === "string" && parsed.text.trim()) {
    return { attempted: true, used: true, text: parsed.text.trim(), reason: null };
  }

  return { attempted: true, used: false, text: "", reason: "ocr_not_available" };
}
