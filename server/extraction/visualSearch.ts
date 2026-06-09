import OpenAI from "openai";
import type { ConfidenceLabel, ExtractedMetadata, OcrResult, ScreenshotAsset, TranscriptResult } from "./types";

type VisionCandidateCategory = "eat" | "do" | "stay" | "see";

export type VisionCandidate = {
  name: string;
  aliases: string[];
  category: VisionCandidateCategory | null;
  query: string;
  locationHint: string | null;
  countryOrRegion: string | null;
  rationale: string | null;
  evidence: string | null;
  confidence: ConfidenceLabel;
  needsReview: boolean;
  supportFrameLabels?: string[];
};

type VisionCandidateResponse = {
  candidates: VisionCandidate[];
};

const VISUAL_SEARCH_SCHEMA_NAME = "visual_landmark_candidates";

const VISUAL_SEARCH_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          aliases: {
            type: "array",
            items: { type: "string" },
          },
          category: {
            anyOf: [
              { type: "string", enum: ["eat", "do", "stay", "see"] },
              { type: "null" },
            ],
          },
          query: { type: "string" },
          locationHint: { type: ["string", "null"] },
          countryOrRegion: { type: ["string", "null"] },
          rationale: { type: ["string", "null"] },
          evidence: { type: ["string", "null"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          needsReview: { type: "boolean" },
        },
        required: [
          "name",
          "aliases",
          "category",
          "query",
          "locationHint",
          "countryOrRegion",
          "rationale",
          "evidence",
          "confidence",
          "needsReview",
        ],
      },
    },
  },
  required: ["candidates"],
} as const;

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

function normalizeCategory(input: unknown): VisionCandidateCategory | null {
  const value = String(input || "").trim().toLowerCase();
  if (value === "eat" || value === "do" || value === "stay" || value === "see") return value;
  if (value === "taste") return "eat";
  if (value === "activity") return "do";
  return null;
}

function sanitizeString(input: unknown, max = 220): string {
  return String(input || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function sanitizeCandidate(input: any): VisionCandidate | null {
  const name = sanitizeString(input?.name, 120);
  const query = sanitizeString(input?.query, 160);
  if (!name || !query) return null;
  const confidence = input?.confidence === "high" || input?.confidence === "medium" ? input.confidence : "low";
  const aliases = Array.isArray(input?.aliases)
    ? input.aliases.map((value: unknown) => sanitizeString(value, 80)).filter(Boolean).slice(0, 4)
    : [];
  return {
    name,
    aliases,
    category: normalizeCategory(input?.category),
    query,
    locationHint: sanitizeString(input?.locationHint, 140) || null,
    countryOrRegion: sanitizeString(input?.countryOrRegion, 80) || null,
    rationale: sanitizeString(input?.rationale, 220) || null,
    evidence: sanitizeString(input?.evidence, 220) || null,
    confidence,
    needsReview: input?.needsReview !== false,
    supportFrameLabels: [],
  };
}

function normalizeCandidateKey(candidate: VisionCandidate): string {
  const base = candidate.name || candidate.query;
  return sanitizeString(base, 180).toLowerCase();
}

function candidateScore(candidate: VisionCandidate): number {
  const confidenceWeight = candidate.confidence === "high" ? 3 : candidate.confidence === "medium" ? 2 : 1;
  const aliasWeight = Math.min(2, candidate.aliases.length);
  const locationWeight = candidate.locationHint || candidate.countryOrRegion ? 1 : 0;
  const categoryWeight = candidate.category === "see" ? 1 : 0;
  return confidenceWeight + aliasWeight + locationWeight + categoryWeight;
}

function mergeCandidates(candidates: VisionCandidate[]): VisionCandidate[] {
  const merged = new Map<string, VisionCandidate>();
  for (const candidate of candidates) {
    const key = normalizeCandidateKey(candidate);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, candidate);
      continue;
    }
    const preferred = candidateScore(candidate) > candidateScore(existing) ? candidate : existing;
    merged.set(key, {
      ...preferred,
      aliases: Array.from(new Set([...(existing.aliases || []), ...(candidate.aliases || [])])).slice(0, 4),
      locationHint: preferred.locationHint || existing.locationHint || candidate.locationHint || null,
      countryOrRegion: preferred.countryOrRegion || existing.countryOrRegion || candidate.countryOrRegion || null,
      rationale: preferred.rationale || existing.rationale || candidate.rationale || null,
      evidence: preferred.evidence || existing.evidence || candidate.evidence || null,
      needsReview: existing.needsReview || candidate.needsReview,
      supportFrameLabels: Array.from(new Set([...(existing.supportFrameLabels || []), ...(candidate.supportFrameLabels || [])])).slice(0, 4),
    });
  }
  return Array.from(merged.values())
    .sort((a, b) => candidateScore(b) - candidateScore(a))
    .slice(0, 2);
}

async function requestVisionCandidates(input: {
  client: OpenAI;
  model: string;
  screenshots: ScreenshotAsset[];
  prompt: string;
  schemaName: string;
}): Promise<{
  candidates: VisionCandidate[];
  mode: "json_schema" | "json_object";
  error: string | null;
  fatalError: string | null;
}> {
  const requestInput = [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text: input.prompt,
        },
        ...input.screenshots.map((shot) => ({
          type: "input_image" as const,
          image_url: shot.url,
          detail: "high" as const,
        })),
      ],
    },
  ];

  const parseCandidates = (raw: string): VisionCandidate[] => {
    const parsed = raw ? (JSON.parse(raw) as VisionCandidateResponse) : { candidates: [] };
    return Array.isArray(parsed?.candidates) ? (parsed.candidates.map(sanitizeCandidate).filter(Boolean) as VisionCandidate[]) : [];
  };

  try {
    console.info("[visual-search] request", {
      requestMode: "json_schema",
      model: input.model,
      schemaName: input.schemaName,
    });
    const response = await input.client.responses.create({
      model: input.model,
      input: requestInput,
      text: {
        format: {
          type: "json_schema",
          name: input.schemaName,
          strict: true,
          schema: VISUAL_SEARCH_JSON_SCHEMA,
        },
      },
    });
    return {
      candidates: parseCandidates(extractResponseText(response as any)),
      mode: "json_schema",
      error: null,
      fatalError: null,
    };
  } catch (error) {
    const schemaError = error instanceof Error ? error.message : "unknown_error";
    console.warn("[visual-search] request_failed", {
      requestMode: "json_schema",
      model: input.model,
      schemaName: input.schemaName,
      validationError: schemaError,
    });
    try {
      console.info("[visual-search] request", {
        requestMode: "json_object",
        model: input.model,
        schemaName: input.schemaName,
      });
      const response = await input.client.responses.create({
        model: input.model,
        input: requestInput,
        text: {
          format: {
            type: "json_object",
          },
        },
      });
      return {
        candidates: parseCandidates(extractResponseText(response as any)),
        mode: "json_object",
        error: schemaError,
        fatalError: null,
      };
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "unknown_error";
      console.warn("[visual-search] request_failed", {
        requestMode: "json_object",
        model: input.model,
        schemaName: input.schemaName,
        validationError: fallbackMessage,
      });
      return {
        candidates: [],
        mode: "json_object",
        error: schemaError,
        fatalError: fallbackMessage,
      };
    }
  }
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
  const model =
    process.env.EXTRACTION_VISUAL_SEARCH_MODEL || process.env.EXTRACTION_VISION_MODEL || process.env.OPENAI_MODEL || process.env.INTELLIGENCE_MODEL || "gpt-5-nano";
  const fallbackModel =
    process.env.EXTRACTION_VISUAL_SEARCH_FALLBACK_MODEL || process.env.OPENAI_MODEL || "gpt-5-nano";
  const basePrompt =
    "You are identifying landmark or place candidates directly from social-video frames. " +
    "Use image understanding first. OCR text, caption, and transcript are only supporting evidence. " +
    "If a specific landmark, waterfall, viewpoint, temple, museum, hotel, cafe, or activity venue is recognizable, return it with its best-known public place name and aliases. " +
    "Natural landmarks are allowed when visually distinctive. " +
    "Do not invent a famous place when uncertain. If confidence is low or the scene is generic, return an empty candidates array. " +
    "Return at most 2 candidates. If multiple plausible landmarks exist, include both and mark needsReview true. " +
    "Each candidate must stay conservative and needsReview should normally be true unless the frame is unmistakable. " +
    "Return valid JSON only.\n\n" +
    `Context:\n${JSON.stringify(payload, null, 2)}`;

  const screenshots = input.screenshots.slice(0, 4);
  console.info("[openai-model-routing]", {
    selectedModel: model,
    taskType: "visual_landmark",
    fallbackUsed: false,
    fallbackReason: null,
  });
  const batchResponse = await requestVisionCandidates({
    client,
    model,
    screenshots,
    prompt: basePrompt,
    schemaName: VISUAL_SEARCH_SCHEMA_NAME,
  });
  let candidates = mergeCandidates(batchResponse.candidates);
  let reason = candidates.length ? null : batchResponse.error ? `vision_batch_failed:${batchResponse.error}` : "vision_candidates_empty";
  let finalModelUsed = model;

  if (batchResponse.fatalError && fallbackModel && fallbackModel !== model) {
    console.info("[openai-model-routing]", {
      selectedModel: fallbackModel,
      taskType: "visual_landmark",
      fallbackUsed: true,
      fallbackReason: batchResponse.fatalError,
    });
    const fallbackResponse = await requestVisionCandidates({
      client,
      model: fallbackModel,
      screenshots,
      prompt: basePrompt,
      schemaName: `${VISUAL_SEARCH_SCHEMA_NAME}_fallback`,
    });
    finalModelUsed = fallbackModel;
    candidates = mergeCandidates(fallbackResponse.candidates);
    if (candidates.length) {
      console.info("[openai-model-routing]", {
        selectedModel: model,
        taskType: "visual_landmark",
        fallbackUsed: true,
        fallbackReason: batchResponse.fatalError,
        finalModelUsed,
      });
      return {
        candidates,
        reason: "vision_fallback_model_candidates",
      };
    }
    reason = fallbackResponse.fatalError
      ? `vision_search_failed:${fallbackResponse.fatalError}`
      : fallbackResponse.error
        ? `vision_search_failed:${fallbackResponse.error}`
        : reason;
    console.info("[openai-model-routing]", {
      selectedModel: model,
      taskType: "visual_landmark",
      fallbackUsed: true,
      fallbackReason: batchResponse.fatalError,
      finalModelUsed,
    });
    return {
      candidates,
      reason,
    };
  }

  if (candidates.length === 0) {
    const framewiseCandidates: VisionCandidate[] = [];
    for (const [index, screenshot] of screenshots.entries()) {
      const framePrompt =
        `${basePrompt}\n\nFocus on this single frame. If this frame shows a recognizable landmark or named place, return it. ` +
        `If not, return an empty candidates array. Frame label: ${screenshot.label || `frame_${index + 1}`}.`;
      const frameResponse = await requestVisionCandidates({
        client,
        model,
        screenshots: [screenshot],
        prompt: framePrompt,
        schemaName: `${VISUAL_SEARCH_SCHEMA_NAME}_frame_${index + 1}`,
      });
      framewiseCandidates.push(
        ...frameResponse.candidates.map((candidate) => ({
          ...candidate,
          supportFrameLabels: Array.from(new Set([...(candidate.supportFrameLabels || []), screenshot.label || `frame_${index + 1}`])),
        })),
      );
    }
    candidates = mergeCandidates(framewiseCandidates);
    if (candidates.length) {
      console.info("[openai-model-routing]", {
        selectedModel: model,
        taskType: "visual_landmark",
        fallbackUsed: false,
        fallbackReason: null,
        finalModelUsed,
      });
      return {
        candidates,
        reason: "vision_framewise_candidates",
      };
    }
  }

  if (candidates.length === 0 && fallbackModel && fallbackModel !== model && batchResponse.fatalError) {
    const strongerResponse = await requestVisionCandidates({
      client,
      model: fallbackModel,
      screenshots,
      prompt: `${basePrompt}\n\nBe especially attentive to distinctive natural landmarks, cliffside waterfalls, iconic bridges, and scenic viewpoints.`,
      schemaName: `${VISUAL_SEARCH_SCHEMA_NAME}_fallback`,
    });
    candidates = mergeCandidates(strongerResponse.candidates);
    if (candidates.length) {
      return {
        candidates,
        reason: "vision_fallback_model_candidates",
      };
    }
    if (strongerResponse.error) {
      reason = `vision_search_failed:${strongerResponse.error}`;
    }
  }

  console.info("[openai-model-routing]", {
    selectedModel: model,
    taskType: "visual_landmark",
    fallbackUsed: false,
    fallbackReason: null,
    finalModelUsed,
  });
  return {
    candidates,
    reason,
  };
}
