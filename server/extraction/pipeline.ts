import { extractMetadata } from "./metadata";
import { enrichWithFrameOcr } from "./ocr";
import { enrichWithTranscript } from "./transcript";
import type { ExtractionMode, ExtractionResult } from "./types";

export async function runExtractionPipeline(input: { url: string; mode: ExtractionMode }): Promise<ExtractionResult> {
  const metadata = await extractMetadata(input.url);

  if (input.mode === "quick") {
    return { mode: input.mode, metadata, transcript: null, ocr: null };
  }

  const [transcript, ocr] = await Promise.all([
    enrichWithTranscript(metadata),
    enrichWithFrameOcr(metadata),
  ]);

  return { mode: input.mode, metadata, transcript, ocr };
}
