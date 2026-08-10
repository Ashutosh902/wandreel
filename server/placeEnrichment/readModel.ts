import {
  loadScoredConflictAwarePlaceKnowledge,
  type ScoredConflictAwareClaim,
  type ScoredConflictAwarePlaceKnowledge,
} from "./knowledgeQuality";

export const PLACE_KNOWLEDGE_READ_MODEL_VERSION = "place_knowledge_read_v1" as const;

export const PLACE_KNOWLEDGE_COLLECTIONS = [
  "recommendedItems",
  "activities",
  "bestTimes",
  "crowdNotes",
  "pricing",
  "parking",
  "ambience",
  "seatingTips",
  "operators",
  "bookingRequirements",
  "practicalInformation",
  "warnings",
  "creatorTips",
  "other",
] as const;

export type PlaceKnowledgeCollection = (typeof PLACE_KNOWLEDGE_COLLECTIONS)[number];

export type NormalizedPlaceKnowledgeClaim = {
  claimId: string;
  kind: string;
  value: string;
  normalizedValue: string;
  qualifiers: Record<string, unknown>;
  truthState: ScoredConflictAwareClaim["truthState"];
  quality: {
    score: number | null;
    evidenceStrength: number | null;
    band: ScoredConflictAwareClaim["quality"]["qualityBand"];
    version: ScoredConflictAwareClaim["quality"]["scoringVersion"];
    reasonCodes: ScoredConflictAwareClaim["quality"]["reasonCodes"];
  };
  support: {
    count: number;
    sourceCount: number;
    evidenceIds: string[];
    sourceTypes: string[];
  };
  grounding: {
    allValidated: boolean;
    supportTypes: Array<"direct" | "inferred">;
    signals: string[];
    directSupportCount: number;
    inferredSupportCount: number;
  };
  freshness: {
    observedAt: string | null;
    verifiedAt: string | null;
    expiresAt: string | null;
  };
};

export type NormalizedPlaceKnowledge = {
  readModelVersion: typeof PLACE_KNOWLEDGE_READ_MODEL_VERSION;
  scoringVersion: ScoredConflictAwarePlaceKnowledge["scoringVersion"];
  canonicalPlaceId: string;
  generatedAt: string;
  knowledge: Record<PlaceKnowledgeCollection, NormalizedPlaceKnowledgeClaim[]>;
  historical: Record<PlaceKnowledgeCollection, NormalizedPlaceKnowledgeClaim[]>;
  summary: {
    currentClaimCount: number;
    historicalClaimCount: number;
    disputedClaimCount: number;
    conditionalClaimCount: number;
    strongClaimCount: number;
    usableClaimCount: number;
    weakClaimCount: number;
  };
};

const COLLECTION_BY_KIND: Record<string, PlaceKnowledgeCollection> = {
  recommended_item: "recommendedItems",
  activity: "activities",
  best_time: "bestTimes",
  crowd_note: "crowdNotes",
  pricing: "pricing",
  entry_fee: "pricing",
  parking: "parking",
  ambience: "ambience",
  seating_tip: "seatingTips",
  operator: "operators",
  exclusive_operator: "operators",
  booking_required: "bookingRequirements",
  practical_information: "practicalInformation",
  accessibility: "practicalInformation",
  transport: "practicalInformation",
  access: "practicalInformation",
  warning: "warnings",
  creator_insight: "creatorTips",
};

function emptyCollections(): Record<PlaceKnowledgeCollection, NormalizedPlaceKnowledgeClaim[]> {
  const collections = {} as Record<PlaceKnowledgeCollection, NormalizedPlaceKnowledgeClaim[]>;
  for (const key of PLACE_KNOWLEDGE_COLLECTIONS) collections[key] = [];
  return collections;
}

function latest(values: Array<string | null>) {
  return values
    .filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value))))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
}

function earliestFutureOrLatest(values: Array<string | null>) {
  const valid = values.filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value))));
  return valid.sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
}

function normalizedClaim(claim: ScoredConflictAwareClaim): NormalizedPlaceKnowledgeClaim {
  const supportTypes = [...new Set(claim.supports.map((support) => support.supportType))];
  return {
    claimId: claim.claimId,
    kind: claim.kind,
    value: claim.value,
    normalizedValue: claim.normalizedValue,
    qualifiers: claim.qualifiers,
    truthState: claim.truthState,
    quality: {
      score: claim.quality.qualityScore,
      evidenceStrength: claim.quality.evidenceStrengthScore,
      band: claim.quality.qualityBand,
      version: claim.quality.scoringVersion,
      reasonCodes: claim.quality.reasonCodes,
    },
    support: {
      count: claim.supportCount,
      sourceCount: claim.independentSourceCount,
      evidenceIds: claim.supports.map((support) => support.evidenceId),
      sourceTypes: [...new Set(claim.supports.map((support) => support.sourceType).filter((value): value is string => Boolean(value)))],
    },
    grounding: {
      allValidated: claim.supports.every((support) => support.groundingValidation === "validated"),
      supportTypes,
      signals: [...new Set(claim.supports.map((support) => support.sourceSignal))],
      directSupportCount: claim.supports.filter((support) => support.supportType === "direct").length,
      inferredSupportCount: claim.supports.filter((support) => support.supportType === "inferred").length,
    },
    freshness: {
      observedAt: latest(claim.supports.map((support) => support.observedAt)),
      verifiedAt: latest(claim.supports.map((support) => support.verifiedAt)),
      expiresAt: earliestFutureOrLatest(claim.supports.map((support) => support.expiresAt)),
    },
  };
}

function sortClaims(claims: NormalizedPlaceKnowledgeClaim[]) {
  return claims.sort((left, right) =>
    (right.quality.score ?? -1) - (left.quality.score ?? -1) || left.claimId.localeCompare(right.claimId)
  );
}

export function buildNormalizedPlaceKnowledge(input: ScoredConflictAwarePlaceKnowledge): NormalizedPlaceKnowledge {
  const knowledge = emptyCollections();
  const historical = emptyCollections();
  for (const group of Object.values(input.knowledge)) {
    for (const claim of group.claims) {
      const collection = COLLECTION_BY_KIND[claim.kind] || "other";
      const target = claim.truthState === "superseded" || claim.truthState === "stale" ? historical : knowledge;
      target[collection].push(normalizedClaim(claim));
    }
  }
  for (const collection of PLACE_KNOWLEDGE_COLLECTIONS) {
    sortClaims(knowledge[collection]);
    sortClaims(historical[collection]);
  }
  const current = Object.values(knowledge).flat();
  const past = Object.values(historical).flat();
  return {
    readModelVersion: PLACE_KNOWLEDGE_READ_MODEL_VERSION,
    scoringVersion: input.scoringVersion,
    canonicalPlaceId: input.canonicalPlaceId,
    generatedAt: input.generatedAt,
    knowledge,
    historical,
    summary: {
      currentClaimCount: current.length,
      historicalClaimCount: past.length,
      disputedClaimCount: current.filter((claim) => claim.truthState === "disputed").length,
      conditionalClaimCount: current.filter((claim) => claim.truthState === "conditionally_supported").length,
      strongClaimCount: current.filter((claim) => claim.quality.band === "strong").length,
      usableClaimCount: current.filter((claim) => claim.quality.band === "usable").length,
      weakClaimCount: current.filter((claim) => claim.quality.band === "weak").length,
    },
  };
}

export async function loadNormalizedPlaceKnowledge(
  database: Parameters<typeof loadScoredConflictAwarePlaceKnowledge>[0],
  canonicalPlaceId: string,
  options: { now?: Date } = {},
) {
  const scored = await loadScoredConflictAwarePlaceKnowledge(database, canonicalPlaceId, options);
  return buildNormalizedPlaceKnowledge(scored);
}
