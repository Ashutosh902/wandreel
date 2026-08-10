import type {
  NormalizedPlaceKnowledge,
  NormalizedPlaceKnowledgeClaim,
  PlaceKnowledgeCollection,
} from "../placeEnrichment/readModel";

export const STROLL_PLACE_KNOWLEDGE_SELECTION_VERSION = "stroll_place_knowledge_selection_v1" as const;
export const DEFAULT_STROLL_KNOWLEDGE_CLAIM_LIMIT = 12;

export type StrollKnowledgeSelectionInput = {
  category: string | null;
  interests: string[];
  theme?: string | null;
  requestedStartTime?: string | null;
  maxClaims?: number;
};

export type SelectedStrollKnowledgeClaim = NormalizedPlaceKnowledgeClaim & {
  collection: PlaceKnowledgeCollection;
  selection: {
    score: number;
    reasonCodes: string[];
  };
};

export type StrollPlaceKnowledgeContext = {
  selectionVersion: typeof STROLL_PLACE_KNOWLEDGE_SELECTION_VERSION;
  readModelVersion: NormalizedPlaceKnowledge["readModelVersion"];
  scoringVersion: NormalizedPlaceKnowledge["scoringVersion"];
  canonicalPlaceId: string;
  selectedClaims: SelectedStrollKnowledgeClaim[];
  omittedClaims: Array<{
    claimId: string;
    kind: string;
    value: string;
    truthState: NormalizedPlaceKnowledgeClaim["truthState"];
    qualityScore: number | null;
    reason: "context_budget" | "historical_not_current";
  }>;
  diagnostics: {
    availableCurrentClaims: number;
    availableHistoricalClaims: number;
    selectedClaimCount: number;
    omittedClaimCount: number;
    disputedClaimsSelected: number;
    weakClaimsSelected: number;
    selectionDurationMs: number;
  };
};

const PRACTICAL_KINDS = new Set([
  "warning",
  "booking_required",
  "parking",
  "pricing",
  "entry_fee",
  "access",
  "accessibility",
  "transport",
  "practical_information",
]);

function normalized(value: string | null | undefined) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function periodForTime(value: string | null | undefined) {
  const match = /^(\d{1,2})(?::\d{2})?/.exec(String(value || ""));
  if (!match) return null;
  const hour = Number(match[1]);
  if (hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

function relevanceForKind(kind: string, context: string) {
  let score = PRACTICAL_KINDS.has(kind) ? 0.72 : 0.55;
  if (/food|taste|restaurant|cafe|eat|culinary/.test(context) && ["recommended_item", "pricing", "seating_tip", "ambience"].includes(kind)) score += 0.28;
  if (/activity|adventure|nature|explore|outdoor/.test(context) && ["activity", "operator", "booking_required", "best_time"].includes(kind)) score += 0.28;
  if (/heritage|culture|history|museum/.test(context) && ["best_time", "activity", "creator_insight"].includes(kind)) score += 0.18;
  if (["best_time", "crowd_note", "ambience", "seating_tip"].includes(kind)) score += 0.08;
  return score;
}

function rankClaim(claim: NormalizedPlaceKnowledgeClaim, input: StrollKnowledgeSelectionInput) {
  const reasonCodes: string[] = [];
  const context = normalized([input.category, input.theme, ...input.interests].filter(Boolean).join(" "));
  let score = relevanceForKind(claim.kind, context);
  reasonCodes.push("kind_relevance");
  if (claim.quality.score !== null) {
    score += claim.quality.score * 0.3;
    reasonCodes.push("quality_prioritized_not_filtered");
  }
  if (claim.truthState === "disputed") {
    score -= 0.12;
    reasonCodes.push("dispute_retained_with_caution");
  } else if (claim.truthState === "conditionally_supported") {
    reasonCodes.push("conditional_qualifiers_preserved");
  }
  const requestedPeriod = periodForTime(input.requestedStartTime);
  const when = normalized(String(claim.qualifiers.when || ""));
  if (requestedPeriod && when.includes(requestedPeriod)) {
    score += 0.12;
    reasonCodes.push("time_qualifier_matches_stroll");
  } else if (requestedPeriod && when) {
    reasonCodes.push("time_qualifier_retained_without_match");
  }
  return { score: Number(score.toFixed(4)), reasonCodes };
}

export function selectPlaceKnowledgeForStroll(
  readModel: NormalizedPlaceKnowledge,
  input: StrollKnowledgeSelectionInput,
): StrollPlaceKnowledgeContext {
  const startedAt = performance.now();
  const maxClaims = Math.max(1, Math.min(30, input.maxClaims ?? DEFAULT_STROLL_KNOWLEDGE_CLAIM_LIMIT));
  const current = (Object.entries(readModel.knowledge) as Array<[PlaceKnowledgeCollection, NormalizedPlaceKnowledgeClaim[]]>)
    .flatMap(([collection, claims]) => claims.map((claim) => ({
      ...claim,
      collection,
      selection: rankClaim(claim, input),
    })))
    .sort((left, right) => right.selection.score - left.selection.score || left.claimId.localeCompare(right.claimId));

  const selected = current.slice(0, maxClaims);
  const selectedIds = new Set(selected.map((claim) => claim.claimId));
  for (const claim of current.filter((candidate) => candidate.truthState === "disputed")) {
    if (selected.some((candidate) => candidate.kind === claim.kind && candidate.truthState === "disputed")) {
      selectedIds.add(claim.claimId);
    }
  }
  const selectedClaims = current.filter((claim) => selectedIds.has(claim.claimId));
  const omittedClaims: StrollPlaceKnowledgeContext["omittedClaims"] = current
    .filter((claim) => !selectedIds.has(claim.claimId))
    .map((claim) => ({
      claimId: claim.claimId,
      kind: claim.kind,
      value: claim.value,
      truthState: claim.truthState,
      qualityScore: claim.quality.score,
      reason: "context_budget",
    }));
  const historical = Object.values(readModel.historical).flat();
  omittedClaims.push(...historical.map((claim) => ({
    claimId: claim.claimId,
    kind: claim.kind,
    value: claim.value,
    truthState: claim.truthState,
    qualityScore: claim.quality.score,
    reason: "historical_not_current" as const,
  })));
  return {
    selectionVersion: STROLL_PLACE_KNOWLEDGE_SELECTION_VERSION,
    readModelVersion: readModel.readModelVersion,
    scoringVersion: readModel.scoringVersion,
    canonicalPlaceId: readModel.canonicalPlaceId,
    selectedClaims,
    omittedClaims,
    diagnostics: {
      availableCurrentClaims: current.length,
      availableHistoricalClaims: historical.length,
      selectedClaimCount: selectedClaims.length,
      omittedClaimCount: omittedClaims.length,
      disputedClaimsSelected: selectedClaims.filter((claim) => claim.truthState === "disputed").length,
      weakClaimsSelected: selectedClaims.filter((claim) => claim.quality.band === "weak").length,
      selectionDurationMs: Number((performance.now() - startedAt).toFixed(3)),
    },
  };
}

export function compactPlaceKnowledgeForPrompt(context: StrollPlaceKnowledgeContext | null) {
  if (!context) return null;
  return {
    selectionVersion: context.selectionVersion,
    claims: context.selectedClaims.map((claim) => ({
      claimId: claim.claimId,
      kind: claim.kind,
      value: claim.value,
      qualifiers: claim.qualifiers,
      truthState: claim.truthState,
      quality: { score: claim.quality.score, band: claim.quality.band },
      support: { count: claim.support.count, sourceCount: claim.support.sourceCount },
    })),
  };
}
