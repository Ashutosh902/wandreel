import { createHash } from "node:crypto";
import OpenAI from "openai";
import { sharedProviderRuntime } from "../providers/runtime";
import {
  compactPlaceKnowledgeForPrompt,
  type SelectedStrollKnowledgeClaim,
  type StrollPlaceKnowledgeContext,
} from "./placeKnowledgeContext";

export const STROLL_STOP_ENRICHMENT_PROMPT_VERSION = "stroll_stop_enrichment_v2";
export const STROLL_STOP_ENRICHMENT_VALIDATION_VERSION = "stroll_stop_validation_v2";

export type StrollStopEnrichmentValidationStatus = "accepted" | "rejected" | "provider_failed" | "skipped_cached";

export type TrustedStrollStopInput = {
  stopId: string;
  placeId: string;
  canonicalPlaceId: string | null;
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
  placeKnowledgeContext: StrollPlaceKnowledgeContext | null;
};

export type StrollStopEnrichmentOutput = {
  description: string;
  whyThisStop: string | null;
  usedKnowledgeClaimIds: string[];
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
  knowledgeAttribution: StrollKnowledgeAttribution;
};

export type StrollKnowledgeStatementAudit = {
  field: "description" | "whyThisStop";
  statement: string;
  classification: "A_supported_knowledge" | "B_generic_connective" | "C_unsupported_place_claim";
  claimIds: string[];
  reasonCodes: string[];
};

export type StrollKnowledgeAttribution = {
  canonicalPlaceId: string | null;
  selectionVersion: string | null;
  suppliedClaimIds: string[];
  selectedClaims: Array<{
    claimId: string;
    kind: string;
    value: string;
    qualifiers: Record<string, unknown>;
    truthState: string;
    qualityScore: number | null;
  }>;
  omittedClaims: Array<{ claimId: string; reason: string }>;
  usedClaimIds: string[];
  invalidClaimIds: string[];
  statementAudit: StrollKnowledgeStatementAudit[];
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

function getEnrichmentTimeoutMs() {
  return Number(process.env.STROLL_ENRICHMENT_TIMEOUT_MS || process.env.OPENAI_PROVIDER_TIMEOUT_MS || 30_000);
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
    placeKnowledge: compactPlaceKnowledgeForPrompt(input.placeKnowledgeContext),
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
    ["placeKnowledgeContext", input.placeKnowledgeContext?.selectedClaims.length ? "selected_claims" : null],
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

  if (input.placeKnowledgeContext?.selectedClaims.length) {
    return { shouldGenerate: true, reason: "selected_place_knowledge_available" };
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
  knowledgeAttribution: StrollKnowledgeAttribution;
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
    knowledgeAttribution: input.knowledgeAttribution,
  };
}

export function buildAcceptedMetadata(input: {
  model: string;
  sourceInputFingerprint: string;
  generatedAt?: string;
  trustedInputKeys: string[];
  knowledgeAttribution: StrollKnowledgeAttribution;
}): StrollStopGenerationMetadata {
  return buildRejectedMetadata({
    model: input.model,
    sourceInputFingerprint: input.sourceInputFingerprint,
    validationStatus: "accepted",
    validationReasons: [],
    generatedAt: input.generatedAt,
    trustedInputKeys: input.trustedInputKeys,
    knowledgeAttribution: input.knowledgeAttribution,
  });
}

function buildSystemPrompt() {
  return [
    "You write brief Wandreel Stroll stop descriptions from verified stored data only.",
    "Never invent awards, popularity, directions, traffic, closures, waterlogging, opening status, or historical facts.",
    "Place-specific factual claims may come only from supplied Place Knowledge claims.",
    "Preserve all supplied qualifiers. Never state either side of a disputed claim as settled fact.",
    "General connective copy is allowed, but do not invent dishes, activities, timing, prices, parking, booking, access, warnings, operators, or creator tips.",
    "usedKnowledgeClaimIds may contain only claimId values from placeKnowledge.claims. If claims is empty or placeKnowledge is null, return an empty array.",
    "Return JSON only: {\"description\":\"...\",\"whyThisStop\":\"...\",\"usedKnowledgeClaimIds\":[\"claim_id\"]}.",
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
    placeKnowledge: compactPlaceKnowledgeForPrompt(input.placeKnowledgeContext),
  });
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function claimSupportsText(text: string, claim: SelectedStrollKnowledgeClaim) {
  const normalizedStatement = normalizeText(text).toLowerCase();
  const value = normalizeText(claim.value).toLowerCase();
  if (value && normalizedStatement.includes(value)) return true;
  if (claim.kind === "booking_required" && /\b(book|booking|reservation|required)\b/.test(normalizedStatement)) return true;
  if (claim.kind === "parking" && /\b(parking|valet)\b/.test(normalizedStatement)) return true;
  if (["pricing", "entry_fee"].includes(claim.kind) && /(?:\u20b9|\brs\.?\b|\binr\b|\bprice\b|\bcost\b|\bfee\b)/.test(normalizedStatement)) return true;
  if (claim.kind === "crowd_note" && /\b(crowd|crowded|busy)\b/.test(normalizedStatement)) return true;
  if (claim.kind === "best_time" && /\b(best time|morning|afternoon|evening|night|sunset|sunrise|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/.test(normalizedStatement)) return true;
  if (claim.kind === "seating_tip" && /\b(seat|seating|upstairs|downstairs|terrace|deck|view)\b/.test(normalizedStatement)) return true;
  return false;
}

function qualifierIsPreserved(text: string, claim: SelectedStrollKnowledgeClaim) {
  const normalizedStatement = normalizeText(text).toLowerCase();
  for (const [key, rawValue] of Object.entries(claim.qualifiers)) {
    if (!["when", "activity", "reason"].includes(key)) continue;
    const value = normalizeText(String(rawValue)).toLowerCase();
    if (value && !normalizedStatement.includes(value)) return false;
  }
  return true;
}

const PLACE_FACT_PATTERN = /(?:\u20b9|\brs\.?\b|\binr\b|\bmust try\b|\border\b|\bdish\b|\bmenu\b|\bprice\b|\bcost\b|\bfee\b|\bparking\b|\bvalet\b|\bbook(?:ing)?\b|\breservation\b|\brequired\b|\bbest time\b|\bsunrise\b|\bsunset\b|\bcrowd(?:ed)?\b|\bbusy\b|\bseating\b|\bupstairs\b|\bterrace\b|\bboat ride\b|\bsafari\b|\boperator\b|\borganised by\b|\borganized by\b|\bavoid\b|\bwarning\b|\baccess\b)/i;

export function auditStrollKnowledgeAttribution(input: {
  stop: TrustedStrollStopInput;
  description: string;
  whyThisStop: string | null;
  usedKnowledgeClaimIds: string[];
}): StrollKnowledgeAttribution {
  const context = input.stop.placeKnowledgeContext;
  const selectedClaims = context?.selectedClaims || [];
  const selectedById = new Map(selectedClaims.map((claim) => [claim.claimId, claim]));
  const usedClaimIds = [...new Set(input.usedKnowledgeClaimIds)];
  const invalidClaimIds = usedClaimIds.filter((claimId) => !selectedById.has(claimId));
  const usedClaims = usedClaimIds.flatMap((claimId) => selectedById.get(claimId) || []);
  const statementAudit: StrollKnowledgeStatementAudit[] = [];
  for (const [field, statement] of [["description", input.description], ["whyThisStop", input.whyThisStop]] as const) {
    if (!statement) continue;
    const matchingClaims = usedClaims.filter((claim) => claimSupportsText(statement, claim));
    const missingQualifier = matchingClaims.some((claim) => !qualifierIsPreserved(statement, claim));
    const disputedWithoutCaution = matchingClaims.some((claim) => claim.truthState === "disputed") &&
      !/\b(disputed|conflicting|sources differ|unclear|may|reported)\b/i.test(statement);
    if (invalidClaimIds.length || missingQualifier || disputedWithoutCaution) {
      statementAudit.push({
        field,
        statement,
        classification: "C_unsupported_place_claim",
        claimIds: matchingClaims.map((claim) => claim.claimId),
        reasonCodes: [
          ...(invalidClaimIds.length ? ["unknown_claim_id"] : []),
          ...(missingQualifier ? ["conditional_qualifier_missing"] : []),
          ...(disputedWithoutCaution ? ["dispute_stated_as_settled"] : []),
        ],
      });
    } else if (matchingClaims.length) {
      statementAudit.push({
        field,
        statement,
        classification: "A_supported_knowledge",
        claimIds: matchingClaims.map((claim) => claim.claimId),
        reasonCodes: ["selected_claim_cited", "claim_value_or_semantics_present"],
      });
    } else if (PLACE_FACT_PATTERN.test(statement)) {
      statementAudit.push({
        field,
        statement,
        classification: "C_unsupported_place_claim",
        claimIds: [],
        reasonCodes: ["place_specific_fact_without_matching_claim"],
      });
    } else {
      statementAudit.push({
        field,
        statement,
        classification: "B_generic_connective",
        claimIds: [],
        reasonCodes: ["no_place_specific_fact_detected"],
      });
    }
  }
  return {
    canonicalPlaceId: input.stop.canonicalPlaceId,
    selectionVersion: context?.selectionVersion || null,
    suppliedClaimIds: selectedClaims.map((claim) => claim.claimId),
    selectedClaims: selectedClaims.map((claim) => ({
      claimId: claim.claimId,
      kind: claim.kind,
      value: claim.value,
      qualifiers: claim.qualifiers,
      truthState: claim.truthState,
      qualityScore: claim.quality.score,
    })),
    omittedClaims: (context?.omittedClaims || []).map((claim) => ({ claimId: claim.claimId, reason: claim.reason })),
    usedClaimIds,
    invalidClaimIds,
    statementAudit,
  };
}

export async function callOpenAiStrollStopEnrichment(
  input: TrustedStrollStopInput,
): Promise<StrollStopEnrichmentProviderResult> {
  const client = getOpenAiClient();
  const model = getModel();
  const fingerprint = buildTrustedInputFingerprint(input);
  const response = await sharedProviderRuntime.execute({
    provider: "openai",
    operation: "stroll_stop_enrichment",
    timeoutMs: getEnrichmentTimeoutMs(),
    retries: 0,
    dedupeKey: `openai:stroll_stop_enrichment:${fingerprint}`,
    maxConcurrency: 2,
    circuitBreaker: { failureThreshold: 5, cooldownMs: 30_000 },
    task: ({ signal }) => client.responses.create({
      model,
      input: [
        { role: "system", content: [{ type: "input_text", text: buildSystemPrompt() }] },
        { role: "user", content: [{ type: "input_text", text: buildUserPrompt(input) }] },
      ],
      reasoning: { effort: "minimal" },
      text: { format: { type: "json_object" } },
      // Reasoning models can consume part of this budget before emitting the compact JSON payload.
      max_output_tokens: 600,
    }, { signal }),
  });
  const responseText = extractResponseText(response);
  if (!responseText) {
    const status = metadataString(objectValue(response, "status")) || "unknown_status";
    const incompleteReason = metadataString(objectValue(objectValue(response, "incomplete_details"), "reason"));
    throw new Error(`openai_empty_response:${status}:${incompleteReason || "no_output_text"}`);
  }
  const parsed = parseJsonObject(responseText);
  if (!parsed) throw new Error("openai_invalid_json_response");
  return {
    description: normalizeText(metadataString(parsed?.description)),
    whyThisStop: metadataString(parsed?.whyThisStop),
    usedKnowledgeClaimIds: stringArray(parsed?.usedKnowledgeClaimIds),
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
    const knowledgeAttribution = auditStrollKnowledgeAttribution({
      stop: input,
      description: result.description,
      whyThisStop: result.whyThisStop,
      usedKnowledgeClaimIds: result.usedKnowledgeClaimIds || [],
    });
    const validation = validateStopDescriptionQuality(result.description);
    const whyValidation = result.whyThisStop ? validateStopDescriptionQuality(result.whyThisStop) : { ok: true, reasons: [] };
    const categoryC = knowledgeAttribution.statementAudit.filter((entry) => entry.classification === "C_unsupported_place_claim");
    const validationReasons = [
      ...validation.reasons,
      ...whyValidation.reasons.map((reason) => `why_${reason}`),
      ...categoryC.flatMap((entry) => entry.reasonCodes.map((reason) => `knowledge_${entry.field}_${reason}`)),
    ];
    if (!validation.ok || !whyValidation.ok || categoryC.length > 0) {
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
          knowledgeAttribution,
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
        knowledgeAttribution,
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
        knowledgeAttribution: auditStrollKnowledgeAttribution({
          stop: input,
          description: "",
          whyThisStop: null,
          usedKnowledgeClaimIds: [],
        }),
      }),
    };
  }
}
