import {
  loadConflictAwarePlaceKnowledge,
  type ClaimStatus,
  type ConflictAwareClaim,
  type ConflictAwarePlaceKnowledge,
  type ConflictAwareSupport,
} from "./truthMaintenance";

export const KNOWLEDGE_QUALITY_VERSION = "knowledge_quality_v1" as const;

// Initial calibration favors evidence quality and independent corroboration. These
// weights are descriptive, consumer-neutral, and versioned rather than universal policy.
export const KNOWLEDGE_QUALITY_POLICY = Object.freeze({
  version: KNOWLEDGE_QUALITY_VERSION,
  weights: Object.freeze({
    grounding: 0.2,
    factConfidence: 0.15,
    support: 0.15,
    sourceDiversity: 0.15,
    freshness: 0.15,
    provenance: 0.1,
    directness: 0.05,
    truthState: 0.05,
  }),
  adjustments: Object.freeze({
    disputePenalty: 0.2,
    stalenessPenalty: 0.15,
    supersededPenalty: 0.25,
    maximumInferencePenalty: 0.05,
    missingSignalPenalty: 0.03,
  }),
  bands: Object.freeze({ strong: 0.8, usable: 0.6 }),
  groundingMethodFactors: Object.freeze({
    exact_span: 1,
    normalized_span: 0.95,
    visual_evidence_record: 0.9,
  }),
  provenance: Object.freeze({
    manual: 1,
    caption: 0.9,
    transcript: 0.9,
    ocr: 0.82,
    vision: 0.72,
    comments: 0.62,
    structured_model: 0.55,
    saved_place: 0.7,
    unknown: 0.5,
  }),
});

export type QualityBand = "strong" | "usable" | "weak" | "disputed";
export type QualityStatus = "scored" | "not_scorable";
export type FreshnessState = "current" | "approaching_stale" | "expired" | "unknown";
export type QualityReasonCode =
  | "validated_direct_grounding"
  | "validated_inferred_grounding"
  | "exact_evidence_location"
  | "normalized_evidence_location"
  | "visual_evidence_location"
  | "multiple_evidence_records"
  | "multiple_independent_sources"
  | "single_source_only"
  | "duplicate_same_source_support"
  | "fresh_evidence"
  | "approaching_stale"
  | "expired_evidence"
  | "inferred_support"
  | "active_dispute"
  | "conditional_context_preserved"
  | "superseded_claim"
  | "stale_claim"
  | "strong_provenance"
  | "weak_provenance"
  | "missing_freshness_signal"
  | "missing_provenance_signal"
  | "unsupported_grounding";

export type QualityComponents = {
  grounding: number | null;
  factConfidence: number | null;
  support: number;
  sourceDiversity: number;
  freshness: number | null;
  provenance: number | null;
  directness: number | null;
  truthState: number;
};

export type QualityAdjustments = {
  disputePenalty: number;
  stalenessPenalty: number;
  supersededPenalty: number;
  inferencePenalty: number;
  missingSignalPenalty: number;
  totalPenalty: number;
};

export type QualityScoringInputs = {
  claimStatus: ClaimStatus;
  supportCount: number;
  independentSourceCount: number;
  qualifierCount: number;
  supports: Array<{
    evidenceId: string;
    sourceIdentity: string;
    sourceType: string | null;
    sourceSignal: string;
    factConfidence: number;
    groundingConfidence: number;
    groundingValidation: ConflictAwareSupport["groundingValidation"];
    groundingMethod: ConflictAwareSupport["groundingMethod"];
    hasEvidenceLocation: boolean;
    supportType: ConflictAwareSupport["supportType"];
    observedAt: string | null;
    verifiedAt: string | null;
    expiresAt: string | null;
    freshnessState: FreshnessState;
    freshnessScore: number | null;
    provenanceScore: number | null;
  }>;
};

export type ClaimQuality = {
  scoringVersion: typeof KNOWLEDGE_QUALITY_VERSION;
  qualityStatus: QualityStatus;
  qualityScore: number | null;
  evidenceStrengthScore: number | null;
  qualityBand: QualityBand | null;
  components: QualityComponents | null;
  adjustments: QualityAdjustments | null;
  reasonCodes: QualityReasonCode[];
  missingSignals: string[];
  inputs: QualityScoringInputs;
};

export type ScoredConflictAwareClaim = ConflictAwareClaim & {
  truthState: ClaimStatus;
  quality: ClaimQuality;
};

export type ScoredConflictAwarePlaceKnowledge = Omit<ConflictAwarePlaceKnowledge, "knowledge"> & {
  scoringVersion: typeof KNOWLEDGE_QUALITY_VERSION;
  knowledge: Record<string, Omit<ConflictAwarePlaceKnowledge["knowledge"][string], "claims"> & {
    claims: ScoredConflictAwareClaim[];
  }>;
};

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function rounded(value: number) {
  return Number(clamp(value).toFixed(4));
}

export function supportScore(supportCount: number) {
  if (supportCount <= 0) return 0;
  return rounded(0.55 + 0.45 * (1 - Math.exp(-0.75 * (supportCount - 1))));
}

export function sourceDiversityScore(independentSourceCount: number) {
  if (independentSourceCount <= 0) return 0;
  return rounded(0.5 + 0.5 * (1 - Math.exp(-0.9 * (independentSourceCount - 1))));
}

export function freshnessScore(
  support: Pick<ConflictAwareSupport, "observedAt" | "verifiedAt" | "expiresAt">,
  now: Date,
): { score: number | null; state: FreshnessState } {
  const expiresAt = Date.parse(String(support.expiresAt || ""));
  const startsAt = Date.parse(String(support.verifiedAt || support.observedAt || ""));
  if (!Number.isFinite(expiresAt) || !Number.isFinite(startsAt) || expiresAt <= startsAt) {
    return { score: null, state: "unknown" };
  }
  const nowMs = now.getTime();
  if (nowMs >= expiresAt) return { score: 0, state: "expired" };
  const remainingRatio = clamp((expiresAt - nowMs) / (expiresAt - startsAt));
  const score = rounded(0.4 + 0.6 * remainingRatio);
  return { score, state: remainingRatio < 0.35 ? "approaching_stale" : "current" };
}

function sourceIdentity(support: ConflictAwareSupport) {
  return support.sourceUrl || `${support.sourceType || "unknown"}:${support.sourceRecordId || support.evidenceId}`;
}

export function provenanceScore(sourceType: string | null) {
  if (!sourceType) return null;
  const normalized = sourceType.toLowerCase();
  const mapping = KNOWLEDGE_QUALITY_POLICY.provenance;
  if (normalized.includes("manual")) return mapping.manual;
  if (normalized.includes("caption")) return mapping.caption;
  if (normalized.includes("transcript")) return mapping.transcript;
  if (normalized.includes("ocr")) return mapping.ocr;
  if (normalized.includes("vision") || normalized.includes("visual")) return mapping.vision;
  if (normalized.includes("comment")) return mapping.comments;
  if (normalized.includes("llm") || normalized.includes("intelligence") || normalized.includes("model")) return mapping.structured_model;
  if (normalized.includes("saved_place") || normalized.includes("seed")) return mapping.saved_place;
  return mapping.unknown;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function groundingScore(support: ConflictAwareSupport) {
  if (support.groundingValidation !== "validated") return null;
  const methodFactor = KNOWLEDGE_QUALITY_POLICY.groundingMethodFactors[support.groundingMethod];
  const locationFactor = support.hasEvidenceLocation ? 1 : 0.85;
  return clamp(support.groundingConfidence * methodFactor * locationFactor);
}

function truthStateScore(status: ClaimStatus) {
  if (status === "supported" || status === "conditionally_supported") return 1;
  if (status === "disputed") return 0.65;
  if (status === "stale") return 0.2;
  return 0.1;
}

function weightedComponentScore(components: QualityComponents) {
  const weights = KNOWLEDGE_QUALITY_POLICY.weights;
  let numerator = 0;
  let denominator = 0;
  for (const [key, weight] of Object.entries(weights) as Array<[keyof QualityComponents, number]>) {
    const value = components[key];
    if (value === null) continue;
    numerator += value * weight;
    denominator += weight;
  }
  return denominator ? rounded(numerator / denominator) : null;
}

function qualityBand(score: number, status: ClaimStatus): QualityBand {
  if (status === "disputed") return "disputed";
  if (status === "stale" || status === "superseded") return "weak";
  if (score >= KNOWLEDGE_QUALITY_POLICY.bands.strong) return "strong";
  if (score >= KNOWLEDGE_QUALITY_POLICY.bands.usable) return "usable";
  return "weak";
}

export function scoreConflictAwareClaim(claim: ConflictAwareClaim, options: { now?: Date } = {}): ClaimQuality {
  const now = options.now ?? new Date();
  const supportInputs = claim.supports.map((support) => {
    const freshness = freshnessScore(support, now);
    return {
      evidenceId: support.evidenceId,
      sourceIdentity: sourceIdentity(support),
      sourceType: support.sourceType,
      sourceSignal: support.sourceSignal,
      factConfidence: support.factConfidence,
      groundingConfidence: support.groundingConfidence,
      groundingValidation: support.groundingValidation,
      groundingMethod: support.groundingMethod,
      hasEvidenceLocation: support.hasEvidenceLocation,
      supportType: support.supportType,
      observedAt: support.observedAt,
      verifiedAt: support.verifiedAt,
      expiresAt: support.expiresAt,
      freshnessState: freshness.state,
      freshnessScore: freshness.score,
      provenanceScore: provenanceScore(support.sourceType),
    };
  });
  const inputs: QualityScoringInputs = {
    claimStatus: claim.status,
    supportCount: claim.supportCount,
    independentSourceCount: claim.independentSourceCount,
    qualifierCount: Object.keys(claim.normalizedQualifiers).length,
    supports: supportInputs,
  };
  const reasonCodes = new Set<QualityReasonCode>();
  const missingSignals: string[] = [];

  if (!supportInputs.length || supportInputs.some((support) => support.groundingValidation !== "validated")) {
    reasonCodes.add("unsupported_grounding");
    return {
      scoringVersion: KNOWLEDGE_QUALITY_VERSION,
      qualityStatus: "not_scorable",
      qualityScore: null,
      evidenceStrengthScore: null,
      qualityBand: null,
      components: null,
      adjustments: null,
      reasonCodes: [...reasonCodes],
      missingSignals,
      inputs,
    };
  }

  const groundingValues = claim.supports.map(groundingScore).filter((value): value is number => value !== null);
  const freshnessValues = supportInputs.map((support) => support.freshnessScore).filter((value): value is number => value !== null);
  const provenanceValues: number[] = supportInputs.flatMap((support) =>
    support.provenanceScore === null ? [] : [Number(support.provenanceScore)]
  );
  const inferredRatio = supportInputs.filter((support) => support.supportType === "inferred").length / supportInputs.length;
  const components: QualityComponents = {
    grounding: average(groundingValues),
    factConfidence: average(supportInputs.map((support) => clamp(support.factConfidence))),
    support: supportScore(claim.supportCount),
    sourceDiversity: sourceDiversityScore(claim.independentSourceCount),
    freshness: freshnessValues.length ? Math.max(...freshnessValues) : null,
    provenance: average(provenanceValues),
    directness: average(supportInputs.map((support) => support.supportType === "direct" ? 1 : 0.65)),
    truthState: truthStateScore(claim.status),
  };
  if (components.freshness === null) {
    missingSignals.push("freshness_timestamps");
    reasonCodes.add("missing_freshness_signal");
  } else if (supportInputs.some((support) => support.freshnessState === "current")) {
    reasonCodes.add("fresh_evidence");
  } else if (supportInputs.some((support) => support.freshnessState === "approaching_stale")) {
    reasonCodes.add("approaching_stale");
  } else {
    reasonCodes.add("expired_evidence");
  }
  if (components.provenance === null) {
    missingSignals.push("source_type");
    reasonCodes.add("missing_provenance_signal");
  } else if (components.provenance >= 0.8) {
    reasonCodes.add("strong_provenance");
  } else if (components.provenance < 0.65) {
    reasonCodes.add("weak_provenance");
  }
  if (supportInputs.every((support) => support.supportType === "direct")) reasonCodes.add("validated_direct_grounding");
  if (inferredRatio > 0) {
    reasonCodes.add("validated_inferred_grounding");
    reasonCodes.add("inferred_support");
  }
  if (supportInputs.some((support) => support.groundingMethod === "exact_span" && support.hasEvidenceLocation)) reasonCodes.add("exact_evidence_location");
  if (supportInputs.some((support) => support.groundingMethod === "normalized_span" && support.hasEvidenceLocation)) reasonCodes.add("normalized_evidence_location");
  if (supportInputs.some((support) => support.groundingMethod === "visual_evidence_record" && support.hasEvidenceLocation)) reasonCodes.add("visual_evidence_location");
  if (claim.supportCount > 1) reasonCodes.add("multiple_evidence_records");
  if (claim.independentSourceCount > 1) reasonCodes.add("multiple_independent_sources");
  else reasonCodes.add("single_source_only");
  if (claim.supportCount > claim.independentSourceCount) reasonCodes.add("duplicate_same_source_support");
  if (claim.status === "disputed") reasonCodes.add("active_dispute");
  if (claim.status === "conditionally_supported") reasonCodes.add("conditional_context_preserved");
  if (claim.status === "stale") reasonCodes.add("stale_claim");
  if (claim.status === "superseded") reasonCodes.add("superseded_claim");

  const config = KNOWLEDGE_QUALITY_POLICY.adjustments;
  const adjustments: QualityAdjustments = {
    disputePenalty: claim.status === "disputed" ? config.disputePenalty : 0,
    stalenessPenalty: claim.status === "stale" ? config.stalenessPenalty : 0,
    supersededPenalty: claim.status === "superseded" ? config.supersededPenalty : 0,
    inferencePenalty: rounded(config.maximumInferencePenalty * inferredRatio),
    missingSignalPenalty: rounded(config.missingSignalPenalty * missingSignals.length),
    totalPenalty: 0,
  };
  adjustments.totalPenalty = rounded(
    adjustments.disputePenalty +
    adjustments.stalenessPenalty +
    adjustments.supersededPenalty +
    adjustments.inferencePenalty +
    adjustments.missingSignalPenalty,
  );
  const evidenceStrengthScore = weightedComponentScore(components);
  const qualityScore = evidenceStrengthScore === null ? null : rounded(evidenceStrengthScore - adjustments.totalPenalty);
  return {
    scoringVersion: KNOWLEDGE_QUALITY_VERSION,
    qualityStatus: "scored",
    qualityScore,
    evidenceStrengthScore,
    qualityBand: qualityScore === null ? null : qualityBand(qualityScore, claim.status),
    components: Object.fromEntries(
      Object.entries(components).map(([key, value]) => [key, value === null ? null : rounded(value)]),
    ) as QualityComponents,
    adjustments,
    reasonCodes: [...reasonCodes],
    missingSignals,
    inputs,
  };
}

export function scoreConflictAwarePlaceKnowledge(
  input: ConflictAwarePlaceKnowledge,
  options: { now?: Date } = {},
): ScoredConflictAwarePlaceKnowledge {
  return {
    canonicalPlaceId: input.canonicalPlaceId,
    generatedAt: input.generatedAt,
    scoringVersion: KNOWLEDGE_QUALITY_VERSION,
    audit: input.audit,
    knowledge: Object.fromEntries(Object.entries(input.knowledge).map(([kind, group]) => [kind, {
      ...group,
      claims: group.claims.map((claim) => ({
        ...claim,
        truthState: claim.status,
        quality: scoreConflictAwareClaim(claim, options),
      })),
    }])),
  };
}

export async function loadScoredConflictAwarePlaceKnowledge(
  database: Parameters<typeof loadConflictAwarePlaceKnowledge>[0],
  canonicalPlaceId: string,
  options: { now?: Date } = {},
) {
  const truthMaintained = await loadConflictAwarePlaceKnowledge(database, canonicalPlaceId, options);
  return scoreConflictAwarePlaceKnowledge(truthMaintained, options);
}
