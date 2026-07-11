import { createHash } from "node:crypto";
import OpenAI from "openai";

export const STROLL_STOP_ENRICHMENT_PROMPT_VERSION = "stroll_stop_enrichment_v1";
export const STROLL_STOP_ENRICHMENT_VALIDATION_VERSION = "stroll_stop_validation_v1";

export type StrollStopEnrichmentValidationStatus = "accepted" | "rejected" | "provider_failed" | "skipped_cached";

export type TrustedStrollStopInput = {
  stopId: string;
  placeId: string;
  sequence: number;
  existingGeneratedDescription: string | null;
  existingReason: string | null;
  existingGenerationMeta: unknown | null;
  placeTitle: string | null;
  placeCategory: string | null;
  placeLocality: string | null;
  placeAddress: string | null;
  placeDescription: string | null;
  placeMetaPrimary: string | null;
  placeMetaSecondary: string | null;
  sourceCaption: string | null;
  sourceUrl: string | null;
};

export type StrollStopEnrichmentOutput = {
  description: string;
  whyThisStop: string | null;
};

export type StrollStopEnrichmentProviderResult = StrollStopEnrichmentOutput & {
  model: string;
  raw?: unknown;
};

export type StrollStopEnrichmentGenerator = (
  input: TrustedStrollStopInput,
  context: { promptVersion: string; sourceInputFingerprint: string },
) => Promise<StrollStopEnrichmentProviderResult>;

export type PersistedStrollStopEnrichment = {
  stopId: string;
  description: string | null;
  reason: string | null;
  metadata: StrollStopGenerationMetadata;
};

export type StrollStopGenerationMetadata = {
  model: string | null;
  promptVersion: string;
  validationVersion: string;
  sourceInputFingerprint: string;
  generatedAt: string;
  validationStatus: StrollStopEnrichmentValidationStatus;
  validationReasons: string[];
  trustedInputKeys: string[];
};

const unsupportedPatterns: Array<{ reason: string; pattern: RegExp }> = [
  { reason: "unsupported_awards_or_popularity", pattern: /\b(best|top[-\s]?rated|award[-\s]?winning|popular|famous|iconic|must[-\s]?visit|renowned|celebrated|viral)\b/i },
  { reason: "directions_claim", pattern: /\b(turn left|turn right|go straight|head to|take the|drive|walk along|route|directions?)\b/i },
  { reason: "traffic_claim", pattern: /\btraffic|congestion|jammed|roadblock\b/i },
  { reason: "closure_claim", pattern: /\bclosed|closure|shut down|temporarily shut|not accessible\b/i },
  { reason: "waterlogging_claim", pattern: /\bwaterlog|waterlogged|flooded|flooding\b/i },
  { reason: "opening_status_claim", pattern: /\bopen now|currently open|opens? at|open daily|opening hours|24\/7|closed today\b/i },
  { reason: "unsupported_historical_claim", pattern: /\b(built in|founded in|dates back|century|ancient|historic|colonial era)\b/i },
];

function normalizeText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function wordCount(value: string) {
  return normalizeText(value).split(/\s+/).filter(Boolean).length;
}

function getModel() {
  return (
    process.env.STROLL_ENRICHMENT_MODEL ||
    process.env.OPENAI_MODEL ||
    process.env.INTELLIGENCE_MODEL ||
    "gpt-5-nano"
  );
}

function getOpenAiClient(): OpenAI {
  const apiKey = String(process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for Stroll stop enrichment");
  const baseURL = String(process.env.OPENAI_BASE_URL || process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "").trim() || undefined;
  return new OpenAI({ apiKey, baseURL });
}

function objectValue(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function extractResponseText(payload: unknown): string {
  const outputText = objectValue(payload, "output_text");
  if (typeof outputText === "string" && outputText.trim()) return outputText.trim();
  const output = objectValue(payload, "output");
  const chunks = Array.isArray(output) ? output : [];
  const parts: string[] = [];
  for (const item of chunks) {
    const rawContent = objectValue(item, "content");
    const content = Array.isArray(rawContent) ? rawContent : [];
    for (const part of content) {
      const rawText = objectValue(part, "text");
      const rawOutputText = objectValue(part, "output_text");
      const text = typeof rawText === "string" ? rawText : typeof rawOutputText === "string" ? rawOutputText : "";
      if (text.trim()) parts.push(text.trim());
    }
  }
  return parts.join("\n").trim();
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function metadataString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function validateStopDescriptionQuality(description: string | null | undefined) {
  const text = normalizeText(description);
  const reasons: string[] = [];

  if (!text) reasons.push("missing");
  if (text && text.length < 35) reasons.push("too_short");
  if (text.length > 220) reasons.push("too_long");
  const words = wordCount(text);
  if (text && words < 6) reasons.push("too_few_words");
  if (words > 34) reasons.push("too_many_words");

  for (const rule of unsupportedPatterns) {
    if (rule.pattern.test(text)) reasons.push(rule.reason);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    normalized: text,
  };
}

export function buildTrustedInputFingerprint(input: TrustedStrollStopInput) {
  const stableInput = {
    placeId: input.placeId,
    sequence: input.sequence,
    placeTitle: normalizeText(input.placeTitle),
    placeCategory: normalizeText(input.placeCategory),
    placeLocality: normalizeText(input.placeLocality),
    placeAddress: normalizeText(input.placeAddress),
    placeDescription: normalizeText(input.placeDescription),
    placeMetaPrimary: normalizeText(input.placeMetaPrimary),
    placeMetaSecondary: normalizeText(input.placeMetaSecondary),
    sourceCaption: normalizeText(input.sourceCaption).slice(0, 800),
    sourceUrl: normalizeText(input.sourceUrl),
  };
  return createHash("sha256").update(JSON.stringify(stableInput)).digest("hex");
}

export function getTrustedInputKeys(input: TrustedStrollStopInput) {
  return ([
    ["placeTitle", input.placeTitle],
    ["placeCategory", input.placeCategory],
    ["placeLocality", input.placeLocality],
    ["placeAddress", input.placeAddress],
    ["placeDescription", input.placeDescription],
    ["placeMetaPrimary", input.placeMetaPrimary],
    ["placeMetaSecondary", input.placeMetaSecondary],
    ["sourceCaption", input.sourceCaption],
    ["sourceUrl", input.sourceUrl],
  ] as const)
    .filter(([, value]) => Boolean(normalizeText(value)))
    .map(([key]) => key);
}

export function shouldGenerateStopDescription(input: TrustedStrollStopInput, sourceInputFingerprint = buildTrustedInputFingerprint(input)) {
  const existingGenerated = validateStopDescriptionQuality(input.existingGeneratedDescription);
  const existingStored = validateStopDescriptionQuality(input.placeDescription || input.placeMetaSecondary || input.placeMetaPrimary);
  const meta = metadataRecord(input.existingGenerationMeta);

  if (
    existingGenerated.ok &&
    meta.promptVersion === STROLL_STOP_ENRICHMENT_PROMPT_VERSION &&
    meta.sourceInputFingerprint === sourceInputFingerprint &&
    meta.validationStatus === "accepted"
  ) {
    return { shouldGenerate: false, reason: "cached_generated_description" };
  }

  if (existingStored.ok) {
    return { shouldGenerate: false, reason: "stored_description_is_sufficient" };
  }

  return { shouldGenerate: true, reason: existingGenerated.ok ? "input_changed" : "missing_or_low_quality_description" };
}

export function buildRejectedMetadata(input: {
  model: string | null;
  sourceInputFingerprint: string;
  validationStatus: StrollStopEnrichmentValidationStatus;
  validationReasons: string[];
  generatedAt?: string;
  trustedInputKeys: string[];
}): StrollStopGenerationMetadata {
  return {
    model: input.model,
    promptVersion: STROLL_STOP_ENRICHMENT_PROMPT_VERSION,
    validationVersion: STROLL_STOP_ENRICHMENT_VALIDATION_VERSION,
    sourceInputFingerprint: input.sourceInputFingerprint,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    validationStatus: input.validationStatus,
    validationReasons: input.validationReasons,
    trustedInputKeys: input.trustedInputKeys,
  };
}

export function buildAcceptedMetadata(input: {
  model: string;
  sourceInputFingerprint: string;
  generatedAt?: string;
  trustedInputKeys: string[];
}): StrollStopGenerationMetadata {
  return buildRejectedMetadata({
    model: input.model,
    sourceInputFingerprint: input.sourceInputFingerprint,
    validationStatus: "accepted",
    validationReasons: [],
    generatedAt: input.generatedAt,
    trustedInputKeys: input.trustedInputKeys,
  });
}

function buildSystemPrompt() {
  return [
    "You write brief Wandreel Stroll stop descriptions from verified stored data only.",
    "Never invent awards, popularity, directions, traffic, closures, waterlogging, opening status, or historical facts.",
    "Return JSON only: {\"description\":\"...\",\"whyThisStop\":\"...\"}.",
    "Description must be one short sentence under 34 words.",
    "whyThisStop must use only supplied Stroll context, or null if not clearly supported.",
  ].join("\n");
}

function buildUserPrompt(input: TrustedStrollStopInput) {
  return JSON.stringify({
    stopNumber: input.sequence,
    placeName: input.placeTitle,
    category: input.placeCategory,
    locality: input.placeLocality,
    address: input.placeAddress,
    storedDescription: input.placeDescription,
    attributes: [input.placeMetaPrimary, input.placeMetaSecondary].filter(Boolean),
    sourceCaption: input.sourceCaption,
    sourceUrl: input.sourceUrl,
  });
}

export async function callOpenAiStrollStopEnrichment(
  input: TrustedStrollStopInput,
): Promise<StrollStopEnrichmentProviderResult> {
  const client = getOpenAiClient();
  const model = getModel();
  const response = await client.responses.create({
    model,
    input: [
      { role: "system", content: [{ type: "input_text", text: buildSystemPrompt() }] },
      { role: "user", content: [{ type: "input_text", text: buildUserPrompt(input) }] },
    ],
    text: { format: { type: "json_object" } },
    max_output_tokens: 220,
  });
  const parsed = parseJsonObject(extractResponseText(response));
  return {
    description: normalizeText(metadataString(parsed?.description)),
    whyThisStop: metadataString(parsed?.whyThisStop),
    model,
    raw: parsed,
  };
}

export async function enrichStopDescriptionIfNeeded(
  input: TrustedStrollStopInput,
  generator: StrollStopEnrichmentGenerator = callOpenAiStrollStopEnrichment,
): Promise<PersistedStrollStopEnrichment | null> {
  const sourceInputFingerprint = buildTrustedInputFingerprint(input);
  const trustedInputKeys = getTrustedInputKeys(input);
  const generationPlan = shouldGenerateStopDescription(input, sourceInputFingerprint);
  if (!generationPlan.shouldGenerate) return null;

  try {
    const result = await generator(input, {
      promptVersion: STROLL_STOP_ENRICHMENT_PROMPT_VERSION,
      sourceInputFingerprint,
    });
    const validation = validateStopDescriptionQuality(result.description);
    const whyValidation = result.whyThisStop ? validateStopDescriptionQuality(result.whyThisStop) : { ok: true, reasons: [] };
    const validationReasons = [...validation.reasons, ...whyValidation.reasons.map((reason) => `why_${reason}`)];
    if (!validation.ok || !whyValidation.ok) {
      return {
        stopId: input.stopId,
        description: null,
        reason: null,
        metadata: buildRejectedMetadata({
          model: result.model,
          sourceInputFingerprint,
          validationStatus: "rejected",
          validationReasons,
          trustedInputKeys,
        }),
      };
    }

    return {
      stopId: input.stopId,
      description: validation.normalized,
      reason: result.whyThisStop ? normalizeText(result.whyThisStop) : null,
      metadata: buildAcceptedMetadata({
        model: result.model,
        sourceInputFingerprint,
        trustedInputKeys,
      }),
    };
  } catch (error) {
    return {
      stopId: input.stopId,
      description: null,
      reason: null,
      metadata: buildRejectedMetadata({
        model: null,
        sourceInputFingerprint,
        validationStatus: "provider_failed",
        validationReasons: [error instanceof Error ? error.message : "provider_failed"],
        trustedInputKeys,
      }),
    };
  }
}
