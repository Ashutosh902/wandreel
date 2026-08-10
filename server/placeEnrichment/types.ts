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
  grounding?: {
    supportType: "direct" | "inferred";
    sourceSignal: PlaceKnowledgeFact["sourceSignal"];
    evidenceText: string;
    sourceField: string;
    groundingConfidence: number;
    span: {
      start: number;
      end: number;
      unit: "character";
    };
    sourceLocation?: {
      startMs?: number | null;
      endMs?: number | null;
      frameLabel?: string | null;
      frameIndex?: number | null;
      timestampSec?: number | null;
      boundingBox?: { x: number; y: number; width: number; height: number } | null;
    };
    frameReferences?: Array<{
      label: string;
      frameIndex?: number | null;
      timestampSec?: number | null;
    }>;
    validation: {
      status: "validated" | "unsupported";
      method: "exact_span" | "normalized_span" | "visual_evidence_record";
      reason: string | null;
    };
  };
  provenance?: {
    sourceType: string;
    sourceUrl: string | null;
    sourceRecordId: string | null;
    extractorName?: string | null;
    extractorVersion?: string | null;
    model?: string | null;
    originPhase?: "place_identification" | "background_enrichment" | null;
  };
  freshness?: {
    observedAt?: string | null;
    verifiedAt?: string | null;
    staleAfterDays?: number | null;
  };
  attributes?: Record<string, unknown>;
};

export type PlaceEnrichmentJobStatus = "pending" | "running" | "completed" | "partial" | "failed";

export type IdentificationEvidenceSnapshot = {
  version: "identification_evidence_v1";
  observedAt: string | null;
  attemptNumber: number | null;
  acceptedAfter: string | null;
  metadata: {
    title: string | null;
    description: string | null;
    siteName: string | null;
    imageUrl: string | null;
    provider: string | null;
  };
  transcript: {
    text: string;
    source: string | null;
    segments?: Array<{ text: string; startMs: number | null; endMs: number | null }>;
  } | null;
  ocr: {
    text: string;
    provider: string | null;
    regions?: Array<{
      text: string;
      frameLabel: string | null;
      frameIndex: number | null;
      timestampSec: number | null;
      boundingBox: { x: number; y: number; width: number; height: number } | null;
    }>;
  } | null;
  visual: {
    summaryText: string | null;
    selectedCandidate: Record<string, unknown> | null;
    screenshots?: Array<{
      label: string;
      frameIndex: number | null;
      timestampSec: number | null;
    }>;
  } | null;
  placeResolution: Record<string, unknown> | null;
};

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
  identificationEvidence?: IdentificationEvidenceSnapshot | null;
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
