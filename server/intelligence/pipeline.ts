import { intelligenceOutputSchema, formatZodErrors, tinyCaptionOutputSchema } from "./schema";
import type { DiscoveryEntity, IntelligenceOutput, IntelligencePipelineResult, IntelligenceRequest, StructuredEntity } from "./types";
import { normalizeEntityIntent, normalizeIntelligenceOutput, sanitizeIntelligenceOutputEntityNames } from "./normalize";
import { callOpenAiStructuredExtraction, callOpenAiTinyCaptionExtraction } from "./providers/openai";
import { recordSla } from "../metrics/slaTracker";
import { inferPlaceResolveContext, mergeResolutionIntoContext, resolveEntityLocality } from "./placeResolver";
import type { ExtractionResult } from "../extraction/types";
import { augmentIntelligenceOutputWithCaptionLists } from "./captionListAugment";
import { inferOcrHeuristicCandidate, isSloganLikeText, isVenueLikeText, shouldSuppressGenericOcrOnlyEntity } from "./draft";
import { buildAttempt3EvidenceWeights, buildAttempt3PriorContext, summarizeAttempt3ContextUsage } from "./prompts";

function buildDefaultLevel2(category: "eat" | "do" | "stay" | "see") {
  return category === "eat"
    ? { category: "eat" as const, cuisineType: null, mealType: null, dietaryTags: [], vibeTags: [], priceTier: null }
    : category === "do"
      ? { category: "do" as const, activityType: null, timeTag: null, audienceTags: [], vibeTags: [], priceTier: null }
      : category === "stay"
        ? { category: "stay" as const, stayType: null, useCase: null, amenities: [], locationTags: [], priceTier: null }
        : { category: "see" as const, placeType: null, experienceTag: null, vibeTags: [], entryFeeSignal: null };
}

function adaptStructuredRaw(raw: unknown, req: IntelligenceRequest): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const candidate = raw as any;
  if (!Array.isArray(candidate.entities) || !candidate.showIn || candidate.source) {
    return raw;
  }

  const metadata = req.source.metadata;
  const entities = candidate.entities.map((entity: any) => {
    const rawCategory = String(entity?.category || "").trim().toLowerCase();
    const category = rawCategory === "eat" || rawCategory === "do" || rawCategory === "stay" ? rawCategory : "see";
    const baseDetails = entity?.address ? { address: String(entity.address) } : {};
    const level2 = buildDefaultLevel2(category);
    const adaptedEntity = {
      category,
      name: String(entity?.name || "").trim(),
      entityType: "place",
      city: entity?.city ?? null,
      state: entity?.state ?? null,
      country: entity?.country ?? null,
      locality: entity?.locality ?? null,
      tags: [],
      details: baseDetails,
      level2,
      googleMapsQuery: entity?.googleMapsQuery ?? null,
      sourceEvidence: entity?.evidenceText ?? "Derived from combined extraction text",
      confidence: entity?.confidence ?? "low",
      intent: entity?.intent,
    };

    return {
      ...adaptedEntity,
      intent: normalizeEntityIntent({ entity: adaptedEntity, category, level2 }),
    };
  });

  const weakMentions = Array.isArray(candidate.weakMentions) ? candidate.weakMentions : [];
  const showIn = candidate.showIn ?? { eat: false, do: false, stay: false, see: false };
  const categoriesPresent = (["eat", "do", "stay", "see"] as const).filter((cat) => Boolean(showIn[cat]));

  return {
    source: {
      url: metadata.canonicalUrl || metadata.sourceUrl || null,
      platform: metadata.platform === "web" ? "website" : metadata.platform,
      title: metadata.title || null,
      creator: null,
      sourceType: "mixed_discovery",
    },
    placeCollections: Array.isArray(candidate.placeCollections)
      ? candidate.placeCollections.map((item: any) => ({
          name: String(item?.name || "").trim(),
          type: item?.type || "unknown",
          city: item?.city ?? null,
          state: item?.state ?? null,
          country: item?.country ?? null,
          confidence: item?.confidence ?? "low",
        }))
      : [],
    categoriesPresent,
    weakMentions,
    showIn,
    structuredEntities: Array.isArray(candidate.entities) ? candidate.entities : [],
    entities,
    visibility: {
      showIn: categoriesPresent,
      doNotShowIn: (["eat", "do", "stay", "see"] as const).filter((cat) => !categoriesPresent.includes(cat)),
      reason: "Derived from structured response.",
    },
    status: candidate?.status ?? "needs_review",
  };
}

function adaptTinyCaptionRaw(raw: unknown, req: IntelligenceRequest): unknown {
  const parsed = tinyCaptionOutputSchema.safeParse(raw);
  if (!parsed.success) return raw;

  const metadata = req.source.metadata;
  const entities = parsed.data.entities.map((entity) => {
    const category = entity.category;
    const level2 = buildDefaultLevel2(category);
    const adaptedEntity = {
      category,
      name: entity.name,
      entityType: "place",
      city: entity.city,
      state: entity.state,
      country: entity.country,
      locality: entity.locality,
      tags: [],
      details: {},
      level2,
      googleMapsQuery: entity.googleMapsQuery,
      sourceEvidence: entity.evidenceText ?? "Derived from caption evidence",
      confidence: entity.confidence,
      intent: entity.intent,
    };

    return {
      ...adaptedEntity,
      intent: normalizeEntityIntent({ entity: adaptedEntity, category, level2 }),
    };
  });
  const structuredEntities = parsed.data.entities.map((entity, index) => ({
    ...entity,
    address: null,
    intent: entities[index]?.intent,
  }));

  const showIn = {
    eat: entities.some((entity) => entity.category === "eat"),
    do: entities.some((entity) => entity.category === "do"),
    stay: entities.some((entity) => entity.category === "stay"),
    see: entities.some((entity) => entity.category === "see"),
  };
  const categoriesPresent = (["eat", "do", "stay", "see"] as const).filter((cat) => showIn[cat]);

  return {
    source: {
      url: metadata.canonicalUrl || metadata.sourceUrl || null,
      platform: metadata.platform === "web" ? "website" : metadata.platform,
      title: metadata.title || null,
      creator: null,
      sourceType: "mixed_discovery",
    },
    placeCollections: [],
    categoriesPresent,
    weakMentions: parsed.data.weakMentions,
    showIn,
    structuredEntities,
    entities,
    visibility: {
      showIn: categoriesPresent,
      doNotShowIn: (["eat", "do", "stay", "see"] as const).filter((cat) => !categoriesPresent.includes(cat)),
      reason: "Derived from tiny caption response.",
    },
    status: parsed.data.status,
  };
}

function normalizeVisualHint(input: string): string {
  return String(input || "")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericScenicFallbackEntity(entity: StructuredEntity): boolean {
  const name = String(entity.name || "").trim().toLowerCase();
  if (!name) return false;
  if (String(entity.confidence || "").toLowerCase() === "high") return false;
  return (
    name === "waterfall viewpoint" ||
    name === "bridge viewpoint" ||
    name === "scenic viewpoint" ||
    name === "waterfall bridge viewpoint" ||
    /\b(viewpoint|scenic spot|waterfall)\b/.test(name)
  );
}

function shouldSkipGoogleResolution(entity: StructuredEntity, source: ExtractionResult): boolean {
  return Boolean(!source.visualFallback?.selectedCandidate && isGenericScenicFallbackEntity(entity));
}

function inferScenicVisualEntity(source: ExtractionResult): { entity: DiscoveryEntity; structured: StructuredEntity } | null {
  const selectedCandidate = source.visualFallback?.selectedCandidate;
  if (selectedCandidate?.candidateName) {
    const googleMapsQuery = selectedCandidate.query || selectedCandidate.candidateName;
    const evidenceParts = [
      source.visualFallback?.summaryText || null,
      selectedCandidate.visualEvidence || null,
      selectedCandidate.aliases?.length ? `Aliases: ${selectedCandidate.aliases.join(", ")}` : null,
    ].filter(Boolean);
    const confidence =
      selectedCandidate.verificationConfidence === "high"
        ? "medium"
        : source.visualFallback?.confidence === "high"
          ? "medium"
          : "low";
    const structured: StructuredEntity = {
      name: selectedCandidate.candidateName,
      category: selectedCandidate.categoryHint === "eat" || selectedCandidate.categoryHint === "do" || selectedCandidate.categoryHint === "stay" ? selectedCandidate.categoryHint : "see",
      locality: selectedCandidate.locality,
      city: selectedCandidate.city,
      state: selectedCandidate.state,
      country: selectedCandidate.country,
      address: selectedCandidate.formattedAddress,
      confidence,
      googleMapsQuery,
      evidenceText: evidenceParts.join(" | ") || "Visual landmark candidate inferred from reel frames.",
    };
    const vibeTags = structured.category === "see" ? ["Photo spots"] : [];
    const level2 =
      structured.category === "eat"
        ? { category: "eat" as const, cuisineType: null, mealType: null, dietaryTags: [], vibeTags: [], priceTier: null }
        : structured.category === "do"
          ? { category: "do" as const, activityType: null, timeTag: null, audienceTags: [], vibeTags: [], priceTier: null }
          : structured.category === "stay"
            ? { category: "stay" as const, stayType: null, useCase: null, amenities: [], locationTags: [], priceTier: null }
            : {
                category: "see" as const,
                placeType: "landmark",
                experienceTag: "nature_view",
                vibeTags,
                entryFeeSignal: null,
              };
    const entity: DiscoveryEntity = {
      category: structured.category,
      name: structured.name,
      entityType: "visual_candidate",
      city: structured.city,
      state: structured.state,
      country: structured.country,
      locality: structured.locality,
      tags: vibeTags,
      details: {
        source: "visual_fallback",
        address: structured.address,
        aliases: selectedCandidate.aliases || [],
        locationVerified: selectedCandidate.locationVerified ?? false,
        needsReview: true,
      },
      level2,
      googleMapsQuery,
      sourceEvidence: structured.evidenceText || "Visual landmark candidate inferred from reel frames.",
      confidence,
    };
    const intent = normalizeEntityIntent({ entity, category: entity.category, level2 });
    structured.intent = intent;
    entity.intent = intent;
    return { entity, structured };
  }

  const cluePool = [
    source.visualFallback?.selectedCandidate?.query || "",
    ...(source.visualFallback?.textQueries || []),
    source.ocr?.text || "",
    source.metadata.description || "",
  ]
    .map(normalizeVisualHint)
    .filter(Boolean);

  const joined = cluePool.join(" \n ").toLowerCase();
  if (!joined) return null;

  let name = "";
  let placeType = "scenic_spot";
  let experienceTag = "scenic_view";
  const vibeTags: string[] = [];

  if (/\bwaterfall\b/.test(joined)) {
    name = /\bbridge\b/.test(joined) ? "Waterfall bridge viewpoint" : "Waterfall viewpoint";
    placeType = "waterfall";
    experienceTag = "nature_view";
    vibeTags.push("Nature", "Photo spots");
  } else if (/\bbridge\b/.test(joined) && /\bview\b/.test(joined)) {
    name = "Bridge viewpoint";
    placeType = "bridge";
    experienceTag = "viewpoint";
    vibeTags.push("Photo spots");
  } else if (/\bviewpoint\b|\bview\b|\bscenic\b/.test(joined)) {
    name = "Scenic viewpoint";
    placeType = "viewpoint";
    experienceTag = "scenic_view";
    vibeTags.push("Photo spots");
  } else {
    return null;
  }

  const googleMapsQuery =
    source.visualFallback?.selectedCandidate?.query ||
    cluePool.find((item) => item.length >= 8) ||
    name;
  const evidenceText =
    source.visualFallback?.summaryText ||
    cluePool.slice(0, 2).join(" | ") ||
    "Scenic visual clue detected from reel frames.";

  const entity: DiscoveryEntity = {
    category: "see",
    name,
    entityType: "visual_candidate",
    city: null,
    state: null,
    country: null,
    locality: null,
    tags: vibeTags,
    details: {
      source: "visual_fallback",
    },
    level2: {
      category: "see",
      placeType,
      experienceTag,
      vibeTags,
      entryFeeSignal: null,
    },
    googleMapsQuery,
    sourceEvidence: evidenceText,
    confidence: "low",
  };
  entity.intent = normalizeEntityIntent({ entity, category: entity.category, level2: entity.level2 });

  const structured: StructuredEntity = {
    name,
    category: "see",
    locality: null,
    city: null,
    state: null,
    country: null,
    address: null,
    confidence: "low",
    googleMapsQuery,
    evidenceText,
    intent: entity.intent,
  };

  return { entity, structured };
}

function getAttemptNumber(req: IntelligenceRequest): number {
  return Number(req.analytics?.attemptNumber ?? req.source.attemptInfo?.attemptNumber ?? 1) || 1;
}

function isStronglyVerifiedVisualCandidate(source: ExtractionResult): boolean {
  const selected = source.visualFallback?.selectedCandidate;
  if (!selected) return false;
  const verificationConfidence = String(selected.verificationConfidence || "").toLowerCase();
  const finalConfidence = String(selected.finalConfidence || "").toLowerCase();
  return Boolean(
    selected.locationVerified &&
    (verificationConfidence === "high" || verificationConfidence === "medium" || finalConfidence === "high"),
  );
}

function hasAmbiguousVisualCandidateSet(source: ExtractionResult): boolean {
  const candidates = Array.isArray(source.visualFallback?.candidates) ? source.visualFallback!.candidates : [];
  if (candidates.length < 2) return false;
  const top = Number(candidates[0]?.rankingScore || 0);
  const second = Number(candidates[1]?.rankingScore || 0);
  return Math.abs(top - second) <= 0.08;
}

function buildAttempt3VisualEvidenceText(source: ExtractionResult): string {
  const selected = source.visualFallback?.selectedCandidate;
  const alternates = (source.visualFallback?.candidates || [])
    .slice(0, 3)
    .map((candidate) => candidate.candidateName || candidate.query)
    .filter(Boolean);
  const parts = [
    source.visualFallback?.summaryText || null,
    selected?.visualEvidence || null,
    alternates.length ? `Visual candidates: ${alternates.join(", ")}` : null,
  ].filter(Boolean);
  return parts.join(" | ") || "Attempt 3 visual fallback candidate set remained ambiguous.";
}

function applyAttempt3VisualDecision(output: IntelligenceOutput, req: IntelligenceRequest): IntelligenceOutput {
  if (getAttemptNumber(req) < 3) return output;

  const selected = req.source.visualFallback?.selectedCandidate;
  if (!selected) return output;

  const visualFallbackEntity = inferScenicVisualEntity(req.source);
  if (!visualFallbackEntity) return output;

  const strongVisual = isStronglyVerifiedVisualCandidate(req.source);
  if (strongVisual) {
    const evidenceText = buildAttempt3VisualEvidenceText(req.source);
    const structured = {
      ...visualFallbackEntity.structured,
      confidence: "high" as const,
      evidenceText,
    };
    const entity = {
      ...visualFallbackEntity.entity,
      sourceEvidence: evidenceText,
      confidence: "high" as const,
      details: {
        ...visualFallbackEntity.entity.details,
        locationVerified: true,
        needsReview: false,
      },
    };
    return {
      ...output,
      categoriesPresent: [entity.category],
      showIn: {
        eat: entity.category === "eat",
        do: entity.category === "do",
        stay: entity.category === "stay",
        see: entity.category === "see",
      },
      structuredEntities: [structured],
      entities: [entity],
      visibility: {
        showIn: [entity.category],
        doNotShowIn: (["eat", "do", "stay", "see"] as const).filter((cat) => cat !== entity.category),
        reason: "Attempt 3 strongly verified visual candidate selected as primary evidence.",
      },
      status: "ready",
    };
  }

  if (!hasAmbiguousVisualCandidateSet(req.source) && !selected.needsReview) {
    return output;
  }

  const evidenceText = buildAttempt3VisualEvidenceText(req.source);
  const structured = {
    ...visualFallbackEntity.structured,
    confidence: "low" as const,
    evidenceText,
  };
  const entity = {
    ...visualFallbackEntity.entity,
    sourceEvidence: evidenceText,
    confidence: "low" as const,
    details: {
      ...visualFallbackEntity.entity.details,
      locationVerified: selected.locationVerified ?? false,
      needsReview: true,
    },
  };
  return {
    ...output,
    categoriesPresent: [entity.category],
    showIn: {
      eat: entity.category === "eat",
      do: entity.category === "do",
      stay: entity.category === "stay",
      see: entity.category === "see",
    },
    structuredEntities: [structured],
    entities: [entity],
    visibility: {
      showIn: [entity.category],
      doNotShowIn: (["eat", "do", "stay", "see"] as const).filter((cat) => cat !== entity.category),
      reason: "Attempt 3 visual candidate set remained ambiguous. Manual review required.",
    },
    status: "needs_review",
  };
}

export function applyVisualEntityFallback(output: IntelligenceOutput, req: IntelligenceRequest): IntelligenceOutput {
  if (getAttemptNumber(req) >= 3 && req.source.visualFallback?.selectedCandidate) {
    return applyAttempt3VisualDecision(output, req);
  }

  if (output.structuredEntities.length > 0 || output.entities.length > 0) return output;

  const inferred = inferScenicVisualEntity(req.source);
  if (!inferred) return output;

  return {
    ...output,
    categoriesPresent: ["see"],
    showIn: {
      ...output.showIn,
      see: true,
    },
    structuredEntities: [inferred.structured],
    entities: [inferred.entity],
    visibility: {
      showIn: ["see"],
      doNotShowIn: ["eat", "do", "stay"],
      reason: "Low-confidence scenic visual fallback candidate inferred from OCR and frame evidence.",
    },
    status: "needs_review",
  };
}

async function enrichWithResolvedLocations(output: IntelligencePipelineResult["output"], source: ExtractionResult) {
  const enabled = String(process.env.PLACE_RESOLUTION_ENABLED || "true").toLowerCase() !== "false";
  if (!enabled || !Array.isArray(output.structuredEntities) || output.structuredEntities.length === 0) return output;

  let resolveContext = inferPlaceResolveContext(source, output.structuredEntities);
  const resolved: typeof output.structuredEntities = [];
  for (const entity of output.structuredEntities) {
    if (shouldSkipGoogleResolution(entity, source)) {
      resolved.push(entity);
      continue;
    }
    const resolution = await resolveEntityLocality(entity, resolveContext);
    const resolvedEntity = {
      ...entity,
      locality: resolution.locality || entity.locality,
      city: resolution.city || entity.city,
      state: resolution.state || entity.state,
      country: resolution.country || entity.country,
      address: resolution.formattedAddress || entity.address,
      placeId: resolution.placeId,
      photoUrl: resolution.photoUrl || entity.photoUrl || null,
      lat: resolution.lat,
      lng: resolution.lng,
      resolvedBy: resolution.provider,
      resolutionConfidence: resolution.confidence,
    };
    resolved.push(resolvedEntity);
    if (resolution.provider === "google_maps" && resolution.confidence !== "low") {
      resolveContext = mergeResolutionIntoContext(resolveContext, resolution);
    }
  }

  const byName = new Map<string, (typeof resolved)[number]>();
  for (const item of resolved) {
    byName.set(`${item.category}|${item.name.toLowerCase()}`, item);
  }
  const entities = output.entities.map((entity) => {
    const key = `${entity.category}|${entity.name.toLowerCase()}`;
    const match = byName.get(key);
    if (!match) return entity;
    return {
      ...entity,
      locality: match.locality,
      city: match.city,
      state: match.state,
      country: match.country,
      details: {
        ...entity.details,
        address: match.address || (entity.details as any)?.address || null,
        placeId: match.placeId || null,
        photoUrl: match.photoUrl || null,
        lat: match.lat ?? null,
        lng: match.lng ?? null,
        resolvedBy: match.resolvedBy || "none",
        resolutionConfidence: match.resolutionConfidence || "low",
      },
      googleMapsQuery: match.googleMapsQuery || entity.googleMapsQuery,
    };
  });

  return {
    ...output,
    structuredEntities: resolved,
    entities,
  };
}

export function postProcessTinyCaptionOutput(output: IntelligenceOutput, req: IntelligenceRequest): IntelligenceOutput {
  return augmentIntelligenceOutputWithCaptionLists(applyVisualEntityFallback(output, req), req.source);
}

function logIntelligenceDecision(event: string, details: Record<string, unknown>) {
  console.info("[intelligence-decision]", {
    event,
    ...details,
  });
}

function finalizeOutputForUi(
  output: IntelligenceOutput,
  req: IntelligenceRequest,
  event: "final_output" | "probe_output" | "tiny_caption_output",
): IntelligenceOutput {
  const sanitized = sanitizeIntelligenceOutputEntityNames(output);
  for (const sanitizeEvent of sanitized.events) {
    logIntelligenceDecision(event, {
      clientRunId: req.analytics?.clientRunId ?? null,
      ...sanitizeEvent,
    });
  }
  return sanitized.output;
}

function applyOcrHeuristicPriority(output: IntelligenceOutput, source: ExtractionResult): IntelligenceOutput {
  const candidate = inferOcrHeuristicCandidate(source);
  if (!candidate) return output;
  if (Array.isArray(output.structuredEntities) && output.structuredEntities.length > 0) {
    const alreadyStrong = output.structuredEntities.some((entity) => {
      const name = String(entity.name || "").toLowerCase();
      return name.includes(candidate.name.toLowerCase()) || String(entity.locality || "").toLowerCase() === String(candidate.locality || "").toLowerCase();
    });
    if (alreadyStrong) return output;
  }

  const intent = candidate.category === "eat"
    ? { l1: "taste" as const, l2: /cafe|café|coffee/i.test(candidate.name) ? "Cafe" : "Restaurant", l3: [] }
    : { l1: "explore" as const, l2: "Nature", l3: [] };

  return {
    ...output,
    categoriesPresent: [candidate.category],
    showIn: {
      eat: candidate.category === "eat",
      do: false,
      stay: false,
      see: candidate.category === "see",
    },
    structuredEntities: [
      {
        name: candidate.name,
        category: candidate.category,
        locality: candidate.locality,
        city: null,
        state: null,
        country: null,
        address: null,
        confidence: candidate.confidence,
        googleMapsQuery: [candidate.name, candidate.locality].filter(Boolean).join(" ").trim() || candidate.name,
        evidenceText: candidate.evidenceText,
        intent,
      },
    ],
    entities: [
      {
        category: candidate.category,
        name: candidate.name,
        entityType: "ocr_candidate",
        city: null,
        state: null,
        country: null,
        locality: candidate.locality,
        tags: ["ocr"],
        details: {},
        level2: candidate.category === "eat"
          ? { category: "eat", cuisineType: null, mealType: null, dietaryTags: [], vibeTags: [], priceTier: null }
          : { category: "see", placeType: null, experienceTag: null, vibeTags: [], entryFeeSignal: null },
        googleMapsQuery: [candidate.name, candidate.locality].filter(Boolean).join(" ").trim() || candidate.name,
        sourceEvidence: candidate.evidenceText,
        confidence: candidate.confidence,
        intent,
      },
    ],
    visibility: {
      showIn: [candidate.category],
      doNotShowIn: (["eat", "do", "stay", "see"] as const).filter((cat) => cat !== candidate.category),
      reason: "OCR heuristic candidate prioritized over generic social metadata.",
    },
    status: "ready",
  };
}

function buildOcrHeuristicIntent(candidate: NonNullable<ReturnType<typeof inferOcrHeuristicCandidate>>) {
  return candidate.category === "eat"
    ? { l1: "taste" as const, l2: /cafe|cafÃ©|coffee/i.test(candidate.name) ? "Cafe" : "Restaurant", l3: [] }
    : { l1: "explore" as const, l2: "Nature", l3: [] };
}

function buildStructuredKey(entity: Pick<StructuredEntity, "category" | "name">): string {
  return `${entity.category}|${String(entity.name || "").trim().toLowerCase()}`;
}

function buildDiscoveryKey(entity: Pick<DiscoveryEntity, "category" | "name">): string {
  return `${entity.category}|${String(entity.name || "").trim().toLowerCase()}`;
}

function matchesOcrCandidate(entity: Pick<StructuredEntity, "name" | "locality">, candidate: NonNullable<ReturnType<typeof inferOcrHeuristicCandidate>>): boolean {
  const entityName = String(entity.name || "").trim().toLowerCase();
  const candidateName = candidate.name.trim().toLowerCase();
  const entityLocality = String(entity.locality || "").trim().toLowerCase();
  const candidateLocality = String(candidate.locality || "").trim().toLowerCase();
  return Boolean(
    entityName === candidateName ||
    entityName.includes(candidateName) ||
    candidateName.includes(entityName) ||
    (candidateLocality && entityLocality === candidateLocality),
  );
}

function scoreStructuredEntityForOcrPriority(
  entity: StructuredEntity,
  candidate: NonNullable<ReturnType<typeof inferOcrHeuristicCandidate>> | null,
): number {
  let score = 0;
  if (candidate && matchesOcrCandidate(entity, candidate)) score += 200;
  if (candidate && String(entity.locality || "").trim().toLowerCase() === String(candidate.locality || "").trim().toLowerCase()) score += 25;
  if (candidate && entity.category === candidate.category) score += 15;
  if (isVenueLikeText(entity.name)) score += 35;
  if (isSloganLikeText(entity.name)) score -= 90;
  return score;
}

function filterStructuredEntitiesForOcrPriority(
  structuredEntities: StructuredEntity[],
  candidate: NonNullable<ReturnType<typeof inferOcrHeuristicCandidate>> | null,
): StructuredEntity[] {
  const sorted = [...structuredEntities].sort((left, right) => {
    const delta = scoreStructuredEntityForOcrPriority(right, candidate) - scoreStructuredEntityForOcrPriority(left, candidate);
    if (delta !== 0) return delta;
    return String(left.name || "").localeCompare(String(right.name || ""));
  });

  const hasVenueLikeNonSlogan = sorted.some((entity) => isVenueLikeText(entity.name) && !isSloganLikeText(entity.name));
  if (!hasVenueLikeNonSlogan) return sorted;

  return sorted.filter((entity) => !isSloganLikeText(entity.name) || (candidate ? matchesOcrCandidate(entity, candidate) : false));
}

function buildCandidateStructuredEntity(candidate: NonNullable<ReturnType<typeof inferOcrHeuristicCandidate>>): StructuredEntity {
  return {
    name: candidate.name,
    category: candidate.category,
    locality: candidate.locality,
    city: null,
    state: null,
    country: null,
    address: null,
    confidence: candidate.confidence,
    googleMapsQuery: [candidate.name, candidate.locality].filter(Boolean).join(" ").trim() || candidate.name,
    evidenceText: candidate.evidenceText,
    intent: buildOcrHeuristicIntent(candidate),
  };
}

function buildCandidateDiscoveryEntity(candidate: NonNullable<ReturnType<typeof inferOcrHeuristicCandidate>>): DiscoveryEntity {
  return {
    category: candidate.category,
    name: candidate.name,
    entityType: "ocr_candidate",
    city: null,
    state: null,
    country: null,
    locality: candidate.locality,
    tags: ["ocr"],
    details: {},
    level2: candidate.category === "eat"
      ? { category: "eat", cuisineType: null, mealType: null, dietaryTags: [], vibeTags: [], priceTier: null }
      : { category: "see", placeType: null, experienceTag: null, vibeTags: [], entryFeeSignal: null },
    googleMapsQuery: [candidate.name, candidate.locality].filter(Boolean).join(" ").trim() || candidate.name,
    sourceEvidence: candidate.evidenceText,
    confidence: candidate.confidence,
    intent: buildOcrHeuristicIntent(candidate),
  };
}

function rebuildOutputWithStructuredOrder(output: IntelligenceOutput, structuredEntities: StructuredEntity[]): IntelligenceOutput {
  const entityByKey = new Map<string, DiscoveryEntity>();
  for (const entity of output.entities) {
    const key = buildDiscoveryKey(entity);
    if (!entityByKey.has(key)) {
      entityByKey.set(key, entity);
    }
  }

  const entities = structuredEntities.map((entity) => {
    const existing = entityByKey.get(buildStructuredKey(entity));
    if (existing) return existing;
    return {
      category: entity.category,
      name: entity.name,
      entityType: "place",
      city: entity.city,
      state: entity.state,
      country: entity.country,
      locality: entity.locality,
      tags: [],
      details: {},
      level2: buildDefaultLevel2(entity.category),
      googleMapsQuery: entity.googleMapsQuery,
      sourceEvidence: entity.evidenceText || "",
      confidence: entity.confidence,
      intent: entity.intent,
    };
  });

  const categoriesPresent = (["eat", "do", "stay", "see"] as const).filter((category) =>
    structuredEntities.some((entity) => entity.category === category),
  );

  return {
    ...output,
    categoriesPresent,
    showIn: {
      eat: categoriesPresent.includes("eat"),
      do: categoriesPresent.includes("do"),
      stay: categoriesPresent.includes("stay"),
      see: categoriesPresent.includes("see"),
    },
    structuredEntities,
    entities,
    visibility: {
      ...output.visibility,
      showIn: categoriesPresent,
      doNotShowIn: (["eat", "do", "stay", "see"] as const).filter((category) => !categoriesPresent.includes(category)),
    },
  };
}

export function prioritizeOcrVenueEntities(output: IntelligenceOutput, source: ExtractionResult): IntelligenceOutput {
  const candidate = inferOcrHeuristicCandidate(source);
  const structuredEntities = Array.isArray(output.structuredEntities) ? output.structuredEntities : [];

  if (!candidate) {
    const shouldSuppress = shouldSuppressGenericOcrOnlyEntity(source);
    const allSloganLike = structuredEntities.length > 0 && structuredEntities.every((entity) => isSloganLikeText(entity.name));
    if (!shouldSuppress || !allSloganLike) {
      return output;
    }

    return {
      ...output,
      structuredEntities: [],
      entities: [],
      categoriesPresent: [],
      showIn: { eat: false, do: false, stay: false, see: false },
      visibility: {
        showIn: [],
        doNotShowIn: ["eat", "do", "stay", "see"],
        reason: "OCR text insufficient",
      },
      status: "needs_review",
    };
  }

  if (structuredEntities.length === 0) {
    const candidateStructured = buildCandidateStructuredEntity(candidate);
    return rebuildOutputWithStructuredOrder({
      ...output,
      entities: [buildCandidateDiscoveryEntity(candidate)],
      structuredEntities: [candidateStructured],
      visibility: {
        ...output.visibility,
        reason: "OCR heuristic candidate prioritized over generic social metadata.",
      },
      status: "ready",
    }, [candidateStructured]);
  }

  const ranked = filterStructuredEntitiesForOcrPriority(structuredEntities, candidate);
  const alreadyStrong = ranked.some((entity) => matchesOcrCandidate(entity, candidate));
  const nextStructured = alreadyStrong
    ? ranked
    : [buildCandidateStructuredEntity(candidate), ...ranked.filter((entity) => !isSloganLikeText(entity.name))];

  const nextOutput = rebuildOutputWithStructuredOrder(output, nextStructured);
  if (alreadyStrong) {
    return {
      ...nextOutput,
      visibility: {
        ...nextOutput.visibility,
        reason: "OCR-aware ranking prioritized venue-like entities over slogan-like OCR text.",
      },
    };
  }

  return rebuildOutputWithStructuredOrder({
    ...nextOutput,
    entities: [buildCandidateDiscoveryEntity(candidate), ...nextOutput.entities],
    visibility: {
      ...nextOutput.visibility,
      reason: "OCR heuristic candidate prioritized over generic social metadata.",
    },
    status: "ready",
  }, nextStructured);
}

export async function runIntelligencePipeline(req: IntelligenceRequest): Promise<IntelligencePipelineResult> {
  const totalStartedAt = Date.now();
  const isProbeRun = Boolean(req.analytics?.probeStage);
  if ((req.analytics?.attemptNumber ?? req.source.attemptInfo?.attemptNumber ?? 1) >= 3) {
    logIntelligenceDecision("attempt3_context", {
      clientRunId: req.analytics?.clientRunId ?? null,
      attempt3PriorContext: buildAttempt3PriorContext(req.source),
      attempt3PrimaryVisualEvidence: req.source.visualFallback ? {
        selectedCandidate: req.source.visualFallback.selectedCandidate?.candidateName || null,
        summaryText: req.source.visualFallback.summaryText || null,
      } : null,
      attempt3EvidenceWeights: buildAttempt3EvidenceWeights(),
    });
  }
  logIntelligenceDecision(isProbeRun ? "before_probe_prompt" : "before_final_prompt", {
    clientRunId: req.analytics?.clientRunId ?? null,
    attemptNumber: req.analytics?.attemptNumber ?? req.source.attemptInfo?.attemptNumber ?? 1,
    probeStage: req.analytics?.probeStage ?? null,
    acceptedAfter: (req.source.debug as any)?.orchestration?.acceptedAfter || null,
    ocrChars: String(req.source.ocr?.text || "").trim().length,
    ocrSnippet: String(req.source.ocr?.text || "").trim().slice(0, 160) || null,
    combinedTextHasOcr: Boolean(String(req.source.combinedTextClean || req.source.combinedTextRaw || "").includes(String(req.source.ocr?.text || "").trim().slice(0, 24))),
  });
  const providerResult = await callOpenAiStructuredExtraction(req.source, req.analytics);
  const raw = adaptStructuredRaw(providerResult.raw, req);
  const schemaFirstStartedAt = Date.now();
  const firstPass = intelligenceOutputSchema.safeParse(raw);
  const schemaFirstPassMs = Date.now() - schemaFirstStartedAt;
  if (firstPass.success) {
    const augmentedOutput = prioritizeOcrVenueEntities(
      augmentIntelligenceOutputWithCaptionLists(applyVisualEntityFallback(firstPass.data, req), req.source),
      req.source,
    );
    const enrichedOutput = finalizeOutputForUi(
      await enrichWithResolvedLocations(augmentedOutput, req.source),
      req,
      isProbeRun ? "probe_output" : "final_output",
    );
    if ((req.analytics?.attemptNumber ?? req.source.attemptInfo?.attemptNumber ?? 1) >= 3) {
      const attempt3Usage = summarizeAttempt3ContextUsage(enrichedOutput, req.source);
      logIntelligenceDecision(isProbeRun ? "probe_output" : "final_output", {
        clientRunId: req.analytics?.clientRunId ?? null,
        attempt3PriorNamesIgnored: attempt3Usage.priorNamesIgnored,
        attempt3GeoContextUsed: attempt3Usage.geoContextUsed,
        attempt3CategoryContextUsed: attempt3Usage.categoryContextUsed,
        attempt3CandidateReasoning: attempt3Usage.candidateReasoning,
      });
    }
    logIntelligenceDecision(isProbeRun ? "probe_output" : "final_output", {
      clientRunId: req.analytics?.clientRunId ?? null,
      entityCount: enrichedOutput.structuredEntities.length,
      probeStage: req.analytics?.probeStage ?? null,
      acceptedAfter: (req.source.debug as any)?.orchestration?.acceptedAfter || null,
      entities: enrichedOutput.structuredEntities.map((entity) => ({
        name: entity.name,
        category: entity.category,
        locality: entity.locality,
      })),
    });
    const agg = recordSla("intelligence.total", Date.now() - totalStartedAt);
    if (Number(process.env.INTELLIGENCE_SLA_LOG_EVERY || 0) > 0 && agg.sampleSize % Number(process.env.INTELLIGENCE_SLA_LOG_EVERY) === 0) {
      console.info("[sla][intelligence.total]", { p50: agg.p50, p95: agg.p95, sampleSize: agg.sampleSize });
    }
    return {
      output: enrichedOutput,
      validationErrors: [],
      fixed: false,
      timingsMs: {
        total: Date.now() - totalStartedAt,
        provider: providerResult.timingsMs.provider,
        schemaFirstPass: schemaFirstPassMs,
        normalize: 0,
        schemaSecondPass: 0,
      },
      providerMeta: providerResult.providerMeta,
      usage: providerResult.usage,
    };
  }

  const normalizeStartedAt = Date.now();
  const normalized = normalizeIntelligenceOutput(raw);
  const normalizeMs = Date.now() - normalizeStartedAt;
  const schemaSecondStartedAt = Date.now();
  const secondPass = intelligenceOutputSchema.safeParse(normalized);
  const schemaSecondPassMs = Date.now() - schemaSecondStartedAt;

  if (secondPass.success) {
    const augmentedOutput = prioritizeOcrVenueEntities(
      augmentIntelligenceOutputWithCaptionLists(applyVisualEntityFallback(secondPass.data, req), req.source),
      req.source,
    );
    const enrichedOutput = finalizeOutputForUi(
      await enrichWithResolvedLocations(augmentedOutput, req.source),
      req,
      isProbeRun ? "probe_output" : "final_output",
    );
    if ((req.analytics?.attemptNumber ?? req.source.attemptInfo?.attemptNumber ?? 1) >= 3) {
      const attempt3Usage = summarizeAttempt3ContextUsage(enrichedOutput, req.source);
      logIntelligenceDecision(isProbeRun ? "probe_output" : "final_output", {
        clientRunId: req.analytics?.clientRunId ?? null,
        attempt3PriorNamesIgnored: attempt3Usage.priorNamesIgnored,
        attempt3GeoContextUsed: attempt3Usage.geoContextUsed,
        attempt3CategoryContextUsed: attempt3Usage.categoryContextUsed,
        attempt3CandidateReasoning: attempt3Usage.candidateReasoning,
      });
    }
    logIntelligenceDecision(isProbeRun ? "probe_output" : "final_output", {
      clientRunId: req.analytics?.clientRunId ?? null,
      entityCount: enrichedOutput.structuredEntities.length,
      probeStage: req.analytics?.probeStage ?? null,
      acceptedAfter: (req.source.debug as any)?.orchestration?.acceptedAfter || null,
      entities: enrichedOutput.structuredEntities.map((entity) => ({
        name: entity.name,
        category: entity.category,
        locality: entity.locality,
      })),
    });
    const agg = recordSla("intelligence.total", Date.now() - totalStartedAt);
    if (Number(process.env.INTELLIGENCE_SLA_LOG_EVERY || 0) > 0 && agg.sampleSize % Number(process.env.INTELLIGENCE_SLA_LOG_EVERY) === 0) {
      console.info("[sla][intelligence.total]", { p50: agg.p50, p95: agg.p95, sampleSize: agg.sampleSize });
    }
    return {
      output: enrichedOutput,
      validationErrors: formatZodErrors(firstPass.error),
      fixed: true,
      timingsMs: {
        total: Date.now() - totalStartedAt,
        provider: providerResult.timingsMs.provider,
        schemaFirstPass: schemaFirstPassMs,
        normalize: normalizeMs,
        schemaSecondPass: schemaSecondPassMs,
      },
      providerMeta: providerResult.providerMeta,
      usage: providerResult.usage,
    };
  }

  const fallbackOutput = finalizeOutputForUi(
    prioritizeOcrVenueEntities(augmentIntelligenceOutputWithCaptionLists(applyVisualEntityFallback({
      ...normalized,
      status: "needs_review",
      visibility: {
        ...normalized.visibility,
        reason: "Schema validation failed after auto-fix. Manual review required.",
      },
    }, req), req.source), req.source),
    req,
    isProbeRun ? "probe_output" : "final_output",
  );
  if ((req.analytics?.attemptNumber ?? req.source.attemptInfo?.attemptNumber ?? 1) >= 3) {
    const attempt3Usage = summarizeAttempt3ContextUsage(fallbackOutput, req.source);
    logIntelligenceDecision(isProbeRun ? "probe_output" : "final_output", {
      clientRunId: req.analytics?.clientRunId ?? null,
      attempt3PriorNamesIgnored: attempt3Usage.priorNamesIgnored,
      attempt3GeoContextUsed: attempt3Usage.geoContextUsed,
      attempt3CategoryContextUsed: attempt3Usage.categoryContextUsed,
      attempt3CandidateReasoning: attempt3Usage.candidateReasoning,
    });
  }

  return {
    output: fallbackOutput,
    validationErrors: [
      ...formatZodErrors(firstPass.error),
      ...formatZodErrors(secondPass.error),
    ],
    fixed: true,
    timingsMs: {
      total: Date.now() - totalStartedAt,
      provider: providerResult.timingsMs.provider,
      schemaFirstPass: schemaFirstPassMs,
      normalize: normalizeMs,
      schemaSecondPass: schemaSecondPassMs,
    },
    providerMeta: providerResult.providerMeta,
    usage: providerResult.usage,
  };
}

export async function runTinyCaptionIntelligence(req: IntelligenceRequest): Promise<IntelligencePipelineResult> {
  const totalStartedAt = Date.now();
  const providerResult = await callOpenAiTinyCaptionExtraction(req.source, req.analytics);
  const raw = adaptTinyCaptionRaw(providerResult.raw, req);
  const schemaFirstStartedAt = Date.now();
  const firstPass = intelligenceOutputSchema.safeParse(raw);
  const schemaFirstPassMs = Date.now() - schemaFirstStartedAt;

  if (firstPass.success) {
    const enrichedOutput = finalizeOutputForUi(
      await enrichWithResolvedLocations(postProcessTinyCaptionOutput(firstPass.data, req), req.source),
      req,
      "tiny_caption_output",
    );
    const agg = recordSla("intelligence.total", Date.now() - totalStartedAt);
    if (Number(process.env.INTELLIGENCE_SLA_LOG_EVERY || 0) > 0 && agg.sampleSize % Number(process.env.INTELLIGENCE_SLA_LOG_EVERY) === 0) {
      console.info("[sla][intelligence.total]", { p50: agg.p50, p95: agg.p95, sampleSize: agg.sampleSize });
    }
    return {
      output: enrichedOutput,
      validationErrors: [],
      fixed: false,
      timingsMs: {
        total: Date.now() - totalStartedAt,
        provider: providerResult.timingsMs.provider,
        schemaFirstPass: schemaFirstPassMs,
        normalize: 0,
        schemaSecondPass: 0,
      },
      providerMeta: providerResult.providerMeta,
      usage: providerResult.usage,
    };
  }

  const normalized = normalizeIntelligenceOutput(raw);
  const schemaSecondStartedAt = Date.now();
  const secondPass = intelligenceOutputSchema.safeParse(normalized);
  const schemaSecondPassMs = Date.now() - schemaSecondStartedAt;
  if (secondPass.success) {
    const enrichedOutput = finalizeOutputForUi(
      await enrichWithResolvedLocations(postProcessTinyCaptionOutput(secondPass.data, req), req.source),
      req,
      "tiny_caption_output",
    );
    return {
      output: enrichedOutput,
      validationErrors: formatZodErrors(firstPass.error),
      fixed: true,
      timingsMs: {
        total: Date.now() - totalStartedAt,
        provider: providerResult.timingsMs.provider,
        schemaFirstPass: schemaFirstPassMs,
        normalize: 0,
        schemaSecondPass: schemaSecondPassMs,
      },
      providerMeta: providerResult.providerMeta,
      usage: providerResult.usage,
    };
  }

  return {
    output: finalizeOutputForUi(postProcessTinyCaptionOutput({
      ...normalized,
      status: "needs_review",
      visibility: {
        ...normalized.visibility,
        reason: "Tiny caption schema validation failed. Manual review required.",
      },
    }, req), req, "tiny_caption_output"),
    validationErrors: [
      ...formatZodErrors(firstPass.error),
      ...formatZodErrors(secondPass.error),
    ],
    fixed: true,
    timingsMs: {
      total: Date.now() - totalStartedAt,
      provider: providerResult.timingsMs.provider,
      schemaFirstPass: schemaFirstPassMs,
      normalize: 0,
      schemaSecondPass: schemaSecondPassMs,
    },
    providerMeta: providerResult.providerMeta,
    usage: providerResult.usage,
  };
}
