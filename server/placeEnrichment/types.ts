import type { ExtractionResult } from "../extraction/types";
import type { IntelligencePipelineResult } from "../intelligence/types";

export const PLACE_KNOWLEDGE_CATEGORIES = [
  "practical_information",
  "recommendations",
  "tips",
  "warnings",
  "atmosphere",
  "accessibility",
  "timing",
  "food",
  "activities",
  "shopping",
  "transport",
  "seasonal_notes",
  "nearby_places",
  "creator_insights",
] as const;

export type PlaceKnowledgeCategory = (typeof PLACE_KNOWLEDGE_CATEGORIES)[number];

export type PlaceKnowledgeFact = {
  category: PlaceKnowledgeCategory;
  text: string;
  sourceSignal: "caption" | "transcript" | "ocr" | "comment" | "visual" | "intelligence" | "saved_place";
  confidence: "high" | "medium" | "low";
  confidenceScore?: number;
  structured?: {
    kind: string;
    value: string;
    qualifiers?: Record<string, unknown>;
  };
  provenance?: {
    sourceType: string;
    sourceUrl: string | null;
    sourceRecordId: string | null;
    extractorVersion?: string | null;
    model?: string | null;
  };
  freshness?: {
    observedAt?: string | null;
    verifiedAt?: string | null;
    staleAfterDays?: number | null;
  };
  attributes?: Record<string, unknown>;
};

export type PlaceEnrichmentJobStatus = "pending" | "running" | "completed" | "partial" | "failed";

export type PlaceEnrichmentPayload = {
  savedPlace: {
    id: string;
    placeId: string;
    title: string;
    category: string | null;
    metadata: unknown;
    createdAt: string | null;
    updatedAt: string | null;
  };
  sourceUrl: string | null;
  sourcePlatform: string | null;
  contentFingerprint?: string | null;
  resolutionStrategy: string;
};

export type PlaceEnrichmentExecutionResult = {
  status: "completed" | "partial";
  summary: Record<string, unknown>;
  extraction?: ExtractionResult | null;
  intelligence?: IntelligencePipelineResult | null;
};

export type EnrichmentSourceCoverage = {
  caption: boolean;
  transcript: boolean;
  ocr: boolean;
  visual: boolean;
  comments: boolean;
  creatorMetadata: boolean;
  locationMetadata: boolean;
  structuredIntelligence: boolean;
  googleMaps: boolean;
  website: boolean;
};

export type EnrichmentSourceAuditEntry = {
  available: boolean;
  attempted: boolean;
  contributed: boolean;
  failed: boolean;
  noUsableEvidence: boolean;
  reason: string | null;
  provider: string | null;
};

export type EnrichmentSourceAudit = Record<keyof EnrichmentSourceCoverage, EnrichmentSourceAuditEntry>;
