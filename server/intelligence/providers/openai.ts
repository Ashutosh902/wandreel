import OpenAI from "openai";
import type { ExtractionResult } from "../../extraction/types";
import { buildSystemPrompt, buildUserPrompt } from "../prompts";

export type OpenAiExtractionResult = {
  raw: unknown;
  timingsMs: {
    provider: number;
  };
  providerMeta: {
    model: string;
    fallbackUsed?: boolean;
    taskType?: "default" | "complex_extraction";
  };
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
};

function getClient(): OpenAI {
  const apiKey = String(process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for intelligence extraction");
  }

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

function extractParsedJson(response: any): unknown {
  const rawText = extractResponseText(response);
  if (!rawText) return null;
  try {
    return JSON.parse(rawText);
  } catch {
    return null;
  }
}

function hasStrongSourceSignal(source: ExtractionResult): boolean {
  const metadataChars = String(source.metadata.description || "").trim().length;
  const ocrChars = String(source.ocr?.text || "").trim().length;
  const transcriptChars = String(source.transcript?.text || "").trim().length;
  const screenshotCount = Array.isArray(source.visualFallback?.screenshots) ? source.visualFallback!.screenshots.length : 0;
  return metadataChars >= 30 || ocrChars >= 20 || transcriptChars >= 60 || screenshotCount > 0;
}

function shouldUseComplexFallback(source: ExtractionResult, parsed: any): boolean {
  if (!process.env.EXTRACTION_COMPLEX_MODEL?.trim()) return false;
  if (!hasStrongSourceSignal(source)) return false;
  if (!parsed || typeof parsed !== "object") return true;

  const status = String(parsed?.status || "").trim().toLowerCase();
  const entities = Array.isArray(parsed?.entities) ? parsed.entities : [];
  const lowConfidenceOnly =
    entities.length > 0 &&
    entities.every((entity: any) => String(entity?.confidence || "").trim().toLowerCase() === "low");
  const multiplePossiblePlaces =
    Array.isArray(source.visualFallback?.candidates) && source.visualFallback!.candidates.length >= 2;

  return status === "no_supported_entity_found" || entities.length === 0 || lowConfidenceOnly || multiplePossiblePlaces;
}

async function runStructuredRequest(input: {
  client: OpenAI;
  model: string;
  source: ExtractionResult;
  taskType: "default" | "complex_extraction";
  fallbackUsed: boolean;
  fallbackReason: string | null;
}): Promise<OpenAiExtractionResult & { parsed: unknown }> {
  console.info("[openai-model-routing]", {
    selectedModel: input.model,
    taskType: input.taskType,
    fallbackUsed: input.fallbackUsed,
    fallbackReason: input.fallbackReason,
  });

  const startedAt = Date.now();
  const response = await input.client.responses.create({
    model: input.model,
    input: [
      { role: "system", content: [{ type: "input_text", text: buildSystemPrompt() }] },
      { role: "user", content: [{ type: "input_text", text: buildUserPrompt(input.source) }] },
    ],
    text: {
      format: {
        type: "json_object",
      },
    },
  });
  const providerMs = Date.now() - startedAt;
  const usage = {
    inputTokens: typeof (response as any)?.usage?.input_tokens === "number" ? (response as any).usage.input_tokens : null,
    outputTokens: typeof (response as any)?.usage?.output_tokens === "number" ? (response as any).usage.output_tokens : null,
    totalTokens: typeof (response as any)?.usage?.total_tokens === "number" ? (response as any).usage.total_tokens : null,
  };
  const parsed = extractParsedJson(response as any);
  console.info("[openai-model-routing]", {
    selectedModel: input.model,
    taskType: input.taskType,
    fallbackUsed: input.fallbackUsed,
    fallbackReason: input.fallbackReason,
    finalModelUsed: input.model,
  });

  return {
    raw: parsed,
    parsed,
    timingsMs: { provider: providerMs },
    providerMeta: { model: input.model, fallbackUsed: input.fallbackUsed, taskType: input.taskType },
    usage,
  };
}

export async function callOpenAiStructuredExtraction(source: ExtractionResult): Promise<OpenAiExtractionResult> {
  const client = getClient();
  const defaultModel = process.env.OPENAI_MODEL || process.env.INTELLIGENCE_MODEL || "gpt-5-nano";
  const firstPass = await runStructuredRequest({
    client,
    model: defaultModel,
    source,
    taskType: "default",
    fallbackUsed: false,
    fallbackReason: null,
  });

  const complexModel = String(process.env.EXTRACTION_COMPLEX_MODEL || "").trim();
  if (!complexModel || complexModel === defaultModel || !shouldUseComplexFallback(source, firstPass.parsed)) {
    return firstPass;
  }

  const secondPass = await runStructuredRequest({
    client,
    model: complexModel,
    source,
    taskType: "complex_extraction",
    fallbackUsed: true,
    fallbackReason: "low_confidence_or_no_strong_entity",
  });

  return {
    raw: secondPass.raw ?? firstPass.raw,
    timingsMs: {
      provider: firstPass.timingsMs.provider + secondPass.timingsMs.provider,
    },
    providerMeta: secondPass.providerMeta,
    usage: {
      inputTokens: (firstPass.usage.inputTokens || 0) + (secondPass.usage.inputTokens || 0) || null,
      outputTokens: (firstPass.usage.outputTokens || 0) + (secondPass.usage.outputTokens || 0) || null,
      totalTokens: (firstPass.usage.totalTokens || 0) + (secondPass.usage.totalTokens || 0) || null,
    },
  };
}
