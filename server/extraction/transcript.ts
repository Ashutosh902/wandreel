import type { ExtractedMetadata, TranscriptResult } from "./types";
import { runPythonJsonScript } from "./pythonRunner";

export async function enrichWithTranscript(metadata: ExtractedMetadata): Promise<TranscriptResult> {
  if (metadata.platform !== "youtube" && metadata.platform !== "instagram") {
    return { attempted: false, used: false, source: null, text: "", reason: "unsupported_platform" };
  }

  if (metadata.platform === "youtube") {
    const captions = await runPythonJsonScript("fetch_youtube_transcript.py", metadata.canonicalUrl, 45000);
    if (captions?.ok && typeof captions.transcript === "string" && captions.transcript.trim()) {
      return { attempted: true, used: true, source: "captions", text: captions.transcript.trim(), reason: null };
    }
  }

  const whisper = await runPythonJsonScript("fetch_youtube_whisper.py", metadata.canonicalUrl, 120000);
  if (whisper?.ok && typeof whisper.transcript === "string" && whisper.transcript.trim()) {
    return { attempted: true, used: true, source: "whisper", text: whisper.transcript.trim(), reason: null };
  }

  return { attempted: true, used: false, source: null, text: "", reason: "transcript_not_available" };
}
