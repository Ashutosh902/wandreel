import OpenAI from "openai";
import type { ConfidenceLabel, ExtractedMetadata, OcrResult, ScreenshotAsset, TranscriptResult } from "./types";

type VisionCandidate = {
  query: string;
  rationale: string | null;
  confidence: ConfidenceLabel;
};

type VisionCandidateResponse = {
  candidates: VisionCandidate[];
};

function getClient(): OpenAI | null {
  const apiKey = String(process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "").trim();
  if (!apiKey) return null;
  const baseURL = String(process.env.OPENAI_BASE_URL || process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "").trim() || undefined;
  return new OpenAI({ apiKey, baseURL });
}

function extractResponseText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const chunks = Array.isArray(payload?.output) ? payload.output : [];
  const parts: string[] = [];
  for (const item of chunks) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      const text = typeof part?.text === "string" ? part.text : typeof part?.output_text === "string" ? part.output_text : "";
      if (text.trim()) parts.push(text.trim());
    }
  }
  return parts.join("\n").trim();
}

function sanitizeCandidate(input: any): VisionCandidate | null {
  const query = typeof input?.query === "string" ? input.query.trim() : "";
  if (!query) return null;
  const confidence = input?.confidence === "high" || input?.confidence === "medium" ? input.confidence : "low";
  return {
    query: query.slice(0, 120),
    rationale: typeof input?.rationale === "string" && input.rationale.trim() ? input.rationale.trim().slice(0, 220) : null,
    confidence,
  };
}

export async function generateVisualSearchCandidates(input: {
  screenshots: ScreenshotAsset[];
  metadata: ExtractedMetadata;
  transcript: TranscriptResult | null;
  ocr: OcrResult | null;
}): Promise<{ candidates: VisionCandidate[]; reason: string | null }> {
  if (input.screenshots.length === 0) {
    return { candidates: [], reason: "no_screenshots_available" };
  }

  const client = getClient();
  if (!client) {
    return { candidates: [], reason: "openai_api_key_missing" };
  }

  const payload = {
    title: input.metadata.title || "",
    description: input.metadata.description || "",
    transcript: input.transcript?.text || "",
    ocr: input.ocr?.text || "",
    platform: input.metadata.platform,
  };

  try {
    const response = await client.responses.create({
      model: process.env.EXTRACTION_VISUAL_SEARCH_MODEL || process.env.EXTRACTION_VISION_MODEL || process.env.INTELLIGENCE_MODEL || "gpt-5-nano",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "You are generating best-effort place search candidates from a saved social-video screenshot. " +
                "Prioritize visible signage, menu text, landmarks, storefront names, neighborhood clues, and any OCR hints. " +
                "Return up to 5 conservative place search queries for later map verification. " +
                "Do not claim certainty. If the image is too weak, return an empty candidates array.\n\n" +
                `Context:\n${JSON.stringify(payload, null, 2)}`,
            },
            ...input.screenshots.slice(0, 2).map((shot) => ({
              type: "input_image" as const,
              image_url: shot.url,
              detail: "low" as const,
            })),
          ],
        },
      ],
      text: {
        format: {
          type: "json_object",
        },
      },
    });

    const raw = extractResponseText(response as any);
    const parsed = raw ? (JSON.parse(raw) as VisionCandidateResponse) : { candidates: [] };
    const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates.map(sanitizeCandidate).filter(Boolean) as VisionCandidate[] : [];
    return { candidates, reason: candidates.length ? null : "vision_candidates_empty" };
  } catch (error) {
    return {
      candidates: [],
      reason: error instanceof Error ? `vision_search_failed:${error.message}` : "vision_search_failed",
    };
  }
}
