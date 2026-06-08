import { intelligenceOutputSchema, formatZodErrors } from "./schema";
import type { IntelligencePipelineResult, IntelligenceRequest } from "./types";
import { normalizeIntelligenceOutput } from "./normalize";
import { callOpenAiStructuredExtraction } from "./providers/openai";
import { recordSla } from "../metrics/slaTracker";
import { resolveEntityLocality } from "./placeResolver";

function adaptStructuredRaw(raw: unknown, req: IntelligenceRequest): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const candidate = raw as any;
  if (!Array.isArray(candidate.entities) || !candidate.showIn || candidate.source) {
    return raw;
  }

  const metadata = req.source.metadata;
  const entities = candidate.entities.map((entity: any) => {
    const category = String(entity?.category || "").trim().toLowerCase();
    const baseDetails = entity?.address ? { address: String(entity.address) } : {};
    const level2 =
      category === "eat"
        ? { category: "eat", cuisineType: null, mealType: null, dietaryTags: [], vibeTags: [], priceTier: null }
        : category === "do"
          ? { category: "do", activityType: null, timeTag: null, audienceTags: [], vibeTags: [], priceTier: null }
          : category === "stay"
            ? { category: "stay", stayType: null, useCase: null, amenities: [], locationTags: [], priceTier: null }
            : { category: "see", placeType: null, experienceTag: null, vibeTags: [], entryFeeSignal: null };

    return {
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

async function enrichWithResolvedLocations(output: IntelligencePipelineResult["output"]) {
  const enabled = String(process.env.PLACE_RESOLUTION_ENABLED || "true").toLowerCase() !== "false";
  if (!enabled || !Array.isArray(output.structuredEntities) || output.structuredEntities.length === 0) return output;

  const resolved = await Promise.all(
    output.structuredEntities.map(async (entity) => {
      const resolution = await resolveEntityLocality(entity);
      return {
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
    }),
  );

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

export async function runIntelligencePipeline(req: IntelligenceRequest): Promise<IntelligencePipelineResult> {
  const totalStartedAt = Date.now();
  const providerResult = await callOpenAiStructuredExtraction(req.source);
  const raw = adaptStructuredRaw(providerResult.raw, req);
  const schemaFirstStartedAt = Date.now();
  const firstPass = intelligenceOutputSchema.safeParse(raw);
  const schemaFirstPassMs = Date.now() - schemaFirstStartedAt;
  if (firstPass.success) {
    const enrichedOutput = await enrichWithResolvedLocations(firstPass.data);
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
    const enrichedOutput = await enrichWithResolvedLocations(secondPass.data);
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

  return {
    output: {
      ...normalized,
      status: "needs_review",
      visibility: {
        ...normalized.visibility,
        reason: "Schema validation failed after auto-fix. Manual review required.",
      },
    },
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
