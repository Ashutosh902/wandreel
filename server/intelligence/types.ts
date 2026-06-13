import type { ExtractionResult } from "../extraction/types";

export const SUPPORTED_CATEGORIES = ["eat", "do", "stay", "see"] as const;
export type SupportedCategory = (typeof SUPPORTED_CATEGORIES)[number];
export const INTENT_L1_VALUES = ["taste", "activity", "stay", "explore"] as const;
export type IntentL1 = (typeof INTENT_L1_VALUES)[number];

export const SOURCE_PLATFORMS = ["youtube", "instagram", "google_maps", "website", "unknown"] as const;
export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];

export const SOURCE_TYPES = [
  "travel_discovery_video",
  "restaurant_recommendation",
  "itinerary",
  "stay_recommendation",
  "activity_recommendation",
  "sightseeing_recommendation",
  "mixed_discovery",
  "unknown",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type PlaceCollection = {
  name: string;
  type: "city" | "locality" | "region" | "country" | "unknown";
  city: string | null;
  state: string | null;
  country: string | null;
  confidence: number;
};

export type EntityConfidence = "high" | "medium" | "low";
export type EntityIntent = {
  l1: IntentL1;
  l2: string;
  l3: string[];
};

export type CategoryLevel2Metadata =
  | {
      category: "eat";
      cuisineType: string | null;
      mealType: string | null;
      dietaryTags: string[];
      vibeTags: string[];
      priceTier: string | null;
    }
  | {
      category: "do";
      activityType: string | null;
      timeTag: string | null;
      audienceTags: string[];
      vibeTags: string[];
      priceTier: string | null;
    }
  | {
      category: "stay";
      stayType: string | null;
      useCase: string | null;
      amenities: string[];
      locationTags: string[];
      priceTier: string | null;
    }
  | {
      category: "see";
      placeType: string | null;
      experienceTag: string | null;
      vibeTags: string[];
      entryFeeSignal: string | null;
    };

export type DiscoveryEntity = {
  category: SupportedCategory;
  name: string;
  entityType: string;
  city: string | null;
  state: string | null;
  country: string | null;
  locality: string | null;
  tags: string[];
  details: Record<string, unknown>;
  level2: CategoryLevel2Metadata;
  googleMapsQuery: string | null;
  sourceEvidence: string;
  confidence: EntityConfidence;
  intent?: EntityIntent;
};

export type StructuredEntity = {
  name: string;
  category: SupportedCategory;
  locality: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  address: string | null;
  placeId?: string | null;
  photoUrl?: string | null;
  lat?: number | null;
  lng?: number | null;
  resolvedBy?: "google_maps" | "none";
  resolutionConfidence?: "high" | "medium" | "low";
  confidence: EntityConfidence;
  googleMapsQuery: string | null;
  evidenceText: string | null;
  intent?: EntityIntent;
};

export type IntelligenceOutput = {
  source: {
    url: string | null;
    platform: SourcePlatform;
    title: string | null;
    creator: string | null;
    sourceType: SourceType;
  };
  placeCollections: PlaceCollection[];
  categoriesPresent: SupportedCategory[];
  weakMentions: Array<{ text: string; reason: string }>;
  showIn: Record<SupportedCategory, boolean>;
  structuredEntities: StructuredEntity[];
  entities: DiscoveryEntity[];
  visibility: {
    showIn: string[];
    doNotShowIn: string[];
    reason: string | null;
  };
  status: "ready" | "needs_review" | "no_supported_entity_found";
};

export type IntelligenceRequest = {
  source: ExtractionResult;
  analytics?: {
    attemptId?: string | null;
    runId?: string | null;
    clientRunId?: string | null;
    attemptNumber?: number | null;
    triggerType?: "initial" | "retry";
    anonymousId?: string | null;
    userId?: string | null;
  };
};

export type IntelligenceMode = "sync" | "async" | "draft_async";

export type IntelligenceJobStatus = "queued" | "running" | "completed" | "failed";

export type IntelligenceJob = {
  id: string;
  status: IntelligenceJobStatus;
  createdAtIso: string;
  updatedAtIso: string;
  error: string | null;
  result: IntelligencePipelineResult | null;
};

export type IntelligencePipelineResult = {
  output: IntelligenceOutput;
  validationErrors: string[];
  fixed: boolean;
  timingsMs?: {
    total: number;
    provider: number;
    schemaFirstPass: number;
    normalize: number;
    schemaSecondPass: number;
  };
  providerMeta?: {
    model: string;
  };
  usage?: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
};
