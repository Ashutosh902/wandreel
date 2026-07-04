import OpenAI from "openai";
import { createHash } from "node:crypto";
import type { ExtractionResult } from "../../extraction/types";
import { createMemoryTracker } from "../../diagnostics/memoryDiagnostics";
import type { IntelligenceRequest } from "../types";
import { buildSystemPrompt, buildTinyCaptionSystemPrompt, buildTinyCaptionUserPrompt, buildUserPrompt } from "../prompts";

export type OpenAiExtractionResult = {
  raw: unknown;
  timingsMs: {
    provider: number;
  };
  providerMeta: {
    model: string;
    fallbackUsed?: boolean;
    taskType?: "default" | "complex_extraction" | "retry_refined" | "retry_final" | "tiny_caption";
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

function buildRoutingLogContext(input: {
  source: ExtractionResult;
  analytics?: IntelligenceRequest["analytics"];
  taskType: "default" | "complex_extraction" | "retry_refined" | "retry_final" | "tiny_caption";
  model: string;
  fallbackUsed: boolean;
  fallbackReason: string | null;
}) {
  const canonicalUrl = input.source.canonicalUrl || input.source.source || input.source.metadata.sourceUrl || "";
  const urlHash = canonicalUrl
    ? createHash("sha1").update(canonicalUrl).digest("hex").slice(0, 12)
    : null;
  return {
    requestId: input.analytics?.requestId ?? null,
    clientRunId: input.analytics?.clientRunId ?? null,
    urlHash,
    attemptNumber: Number(input.analytics?.attemptNumber ?? input.source.attemptInfo?.attemptNumber ?? 1) || 1,
    probeStage: input.analytics?.probeStage ?? null,
    selectedModel: input.model,
    taskType: input.taskType,
    fallbackUsed: input.fallbackUsed,
    fallbackReason: input.fallbackReason,
  };
}

async function runStructuredRequest(input: {
  client: OpenAI;
  model: string;
  source: ExtractionResult;
  analytics?: IntelligenceRequest["analytics"];
  taskType: "default" | "complex_extraction" | "retry_refined" | "retry_final" | "tiny_caption";
  fallbackUsed: boolean;
  fallbackReason: string | null;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens?: number;
}): Promise<OpenAiExtractionResult & { parsed: unknown }> {
  const memoryTracker = createMemoryTracker({
    attemptNumber: Number(input.analytics?.attemptNumber ?? input.source.attemptInfo?.attemptNumber ?? 1) || 1,
    triggerType: (input.analytics?.triggerType ?? input.source.attemptInfo?.triggerType ?? "unknown") as "initial" | "retry" | "unknown",
    url: input.source.canonicalUrl || input.source.source || input.source.metadata.sourceUrl,
    requestId:
      input.analytics?.requestId ||
      `intelligence:${input.taskType}:${Date.now()}:${input.source.canonicalUrl || input.source.metadata.sourceUrl}`,
  });
  console.info("[openai-model-routing]", buildRoutingLogContext(input));
  memoryTracker.checkpoint("before_intelligence_llm_call", {
    screenshots: input.source.visualFallback?.screenshots || [],
    extra: {
      taskType: input.taskType,
      model: input.model,
      fallbackUsed: input.fallbackUsed,
      fallbackReason: input.fallbackReason,
      metadataChars: String(input.source.metadata.description || "").trim().length,
      transcriptChars: String(input.source.transcript?.text || "").trim().length,
      ocrChars: String(input.source.ocr?.text || "").trim().length,
      screenshotCount: Array.isArray(input.source.visualFallback?.screenshots) ? input.source.visualFallback!.screenshots.length : 0,
    },
  });

  const startedAt = Date.now();
  const response = await input.client.responses.create({
    model: input.model,
    input: [
      { role: "system", content: [{ type: "input_text", text: input.systemPrompt }] },
      { role: "user", content: [{ type: "input_text", text: input.userPrompt }] },
    ],
    text: {
      format: {
        type: "json_object",
      },
    },
    ...(input.maxOutputTokens ? { max_output_tokens: input.maxOutputTokens } : {}),
  });
  const providerMs = Date.now() - startedAt;
  const usage = {
    inputTokens: typeof (response as any)?.usage?.input_tokens === "number" ? (response as any).usage.input_tokens : null,
    outputTokens: typeof (response as any)?.usage?.output_tokens === "number" ? (response as any).usage.output_tokens : null,
    totalTokens: typeof (response as any)?.usage?.total_tokens === "number" ? (response as any).usage.total_tokens : null,
  };
  const parsed = extractParsedJson(response as any);
  memoryTracker.checkpoint("after_intelligence_llm_call", {
    screenshots: input.source.visualFallback?.screenshots || [],
    extra: {
      taskType: input.taskType,
      model: input.model,
      providerMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      parsedEntityCount: Array.isArray((parsed as any)?.entities) ? (parsed as any).entities.length : null,
      parsedStatus: typeof (parsed as any)?.status === "string" ? (parsed as any).status : null,
    },
  });
  console.info("[openai-model-routing]", {
    ...buildRoutingLogContext(input),
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

export async function callOpenAiStructuredExtraction(
  source: ExtractionResult,
  analytics?: IntelligenceRequest["analytics"],
): Promise<OpenAiExtractionResult> {
  const client = getClient();
  const defaultModel = process.env.OPENAI_MODEL || process.env.INTELLIGENCE_MODEL || "gpt-5-nano";
  const complexModel = String(process.env.EXTRACTION_COMPLEX_MODEL || "").trim();
  const finalRetryModel =
    String(process.env.EXTRACTION_VISUAL_SEARCH_MODEL || "").trim() ||
    complexModel ||
    defaultModel;
  const attemptNumber = Number(analytics?.attemptNumber ?? source.attemptInfo?.attemptNumber ?? 1) || 1;
  const disableComplexFallback = Boolean(analytics?.probeStage);

  if (attemptNumber >= 3) {
    return runStructuredRequest({
      client,
      model: finalRetryModel,
      source,
      analytics,
      taskType: "retry_final",
      fallbackUsed: finalRetryModel !== defaultModel,
      fallbackReason: "final_retry_strict_prompt",
      systemPrompt: buildSystemPrompt({ attemptNumber: analytics?.attemptNumber }),
      userPrompt: buildUserPrompt(source, analytics),
    });
  }

  if (attemptNumber === 2) {
    return runStructuredRequest({
      client,
      model: complexModel || defaultModel,
      source,
      analytics,
      taskType: "retry_refined",
      fallbackUsed: Boolean(complexModel && complexModel !== defaultModel),
      fallbackReason: "retry_refined_prompt",
      systemPrompt: buildSystemPrompt({ attemptNumber: analytics?.attemptNumber }),
      userPrompt: buildUserPrompt(source, analytics),
    });
  }

  const firstPass = await runStructuredRequest({
    client,
    model: defaultModel,
    source,
    analytics,
    taskType: "default",
    fallbackUsed: false,
    fallbackReason: null,
    systemPrompt: buildSystemPrompt({ attemptNumber: analytics?.attemptNumber }),
    userPrompt: buildUserPrompt(source, analytics),
  });

  if (
    disableComplexFallback ||
    !complexModel ||
    complexModel === defaultModel ||
    !shouldUseComplexFallback(source, firstPass.parsed)
  ) {
    return firstPass;
  }

  const secondPass = await runStructuredRequest({
    client,
    model: complexModel,
    source,
    analytics,
    taskType: "complex_extraction",
    fallbackUsed: true,
    fallbackReason: "low_confidence_or_no_strong_entity",
    systemPrompt: buildSystemPrompt({ attemptNumber: analytics?.attemptNumber }),
    userPrompt: buildUserPrompt(source, analytics),
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

export async function callOpenAiTinyCaptionExtraction(
  source: ExtractionResult,
  analytics?: IntelligenceRequest["analytics"],
): Promise<OpenAiExtractionResult> {
  const client = getClient();
  const defaultModel =
    process.env.OPENAI_TINY_CAPTION_MODEL ||
    process.env.EXTRACTION_COMPLEX_MODEL ||
    process.env.OPENAI_MODEL ||
    process.env.INTELLIGENCE_MODEL ||
    "gpt-5-nano";
  return runStructuredRequest({
    client,
    model: defaultModel,
    source,
    analytics,
    taskType: "tiny_caption",
    fallbackUsed: false,
    fallbackReason: null,
    systemPrompt: buildTinyCaptionSystemPrompt(),
    userPrompt: buildTinyCaptionUserPrompt(source, analytics),
    maxOutputTokens: 600,
  });
}
