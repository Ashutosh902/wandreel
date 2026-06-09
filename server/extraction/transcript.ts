import type { ExtractedMetadata, TranscriptResult } from "./types";
import { runPythonJsonScript } from "./pythonRunner";

function coerceTranscriptReason(result: any, fallback: string): string {
  const stderr = typeof result?.stderr === "string" ? result.stderr.trim() : "";
  if (typeof result?.error === "string" && /Command failed:/i.test(result.error)) {
    if (/MISSING_FASTER_WHISPER/i.test(stderr)) return "missing_faster_whisper";
    if (/AUDIO_NOT_FOUND/i.test(stderr)) return "audio_not_found";
    return "whisper_script_failed";
  }
  if (typeof result?.error === "string" && result.error.trim()) return result.error.trim();
  if (typeof result?.reason === "string" && result.reason.trim()) return result.reason.trim();
  return fallback;
}

export async function enrichWithTranscript(metadata: ExtractedMetadata): Promise<TranscriptResult> {
  if (metadata.platform !== "youtube" && metadata.platform !== "instagram") {
    return { attempted: false, used: false, source: null, text: "", reason: "unsupported_platform" };
  }

  if (metadata.platform === "youtube") {
    const captions = await runPythonJsonScript("fetch_youtube_transcript.py", metadata.canonicalUrl, 45000);
    if (captions?.ok && typeof captions.transcript === "string" && captions.transcript.trim()) {
      return { attempted: true, used: true, source: "captions", text: captions.transcript.trim(), reason: null };
    }

    const whisper = await runPythonJsonScript("fetch_media_whisper.py", metadata.canonicalUrl, 120000);
    if (whisper?.ok && typeof whisper.transcript === "string" && whisper.transcript.trim()) {
      return { attempted: true, used: true, source: "whisper", text: whisper.transcript.trim(), reason: null };
    }

    return {
      attempted: true,
      used: false,
      source: null,
      text: "",
      reason: coerceTranscriptReason(whisper, "transcript_not_available"),
    };
  }

  const whisper = await runPythonJsonScript("fetch_media_whisper.py", metadata.canonicalUrl, 120000);
  if (whisper?.ok && typeof whisper.transcript === "string" && whisper.transcript.trim()) {
    return { attempted: true, used: true, source: "whisper", text: whisper.transcript.trim(), reason: null };
  }

  return {
    attempted: true,
    used: false,
    source: null,
    text: "",
    reason: coerceTranscriptReason(whisper, "transcript_not_available"),
  };
}
