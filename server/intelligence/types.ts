import type { ExtractionResult } from "../extraction/types";

export const SUPPORTED_CATEGORIES = ["eat", "do", "stay", "see"] as const;
export type SupportedCategory = (typeof SUPPORTED_CATEGORIES)[number];

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
  googleMapsQuery: string | null;
  sourceEvidence: string;
  confidence: number;
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
  weakMentions: SupportedCategory[];
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
};

export type IntelligenceMode = "sync" | "async";

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
};
