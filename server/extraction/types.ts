export type SourcePlatform = "youtube" | "instagram" | "web";

export type ExtractionMode = "quick" | "deep";

export const EXTRACTION_STAGE_KEYS = ["basicMetadata", "caption", "transcript", "ocr", "visualFallback"] as const;
export type ExtractionStageKey = (typeof EXTRACTION_STAGE_KEYS)[number];

export type ConfidenceLabel = "high" | "medium" | "low";
export type VerificationQueryShape =
  | "place_like"
  | "address_like"
  | "business_like"
  | "landmark_like"
  | "generic_sentence"
  | "descriptive_caption";

export type ExtractedMetadata = {
  sourceUrl: string;
  canonicalUrl: string;
  platform: SourcePlatform;
  title: string;
  description: string;
  siteName: string | null;
  imageUrl: string | null;
  fetchedAtIso: string;
  provider: "html" | "youtube_script" | "instagram_script";
};

export type TranscriptResult = {
  attempted: boolean;
  used: boolean;
  source: "captions" | "whisper" | null;
  text: string;
  reason: string | null;
};

export type OcrResult = {
  attempted: boolean;
  used: boolean;
  text: string;
  reason: string | null;
};

export type ExtractionStageStatus = "success" | "partial" | "failed";

export type ExtractionStageResult = {
  status: ExtractionStageStatus;
  provider: string;
  reason: string | null;
  chars: number;
};

export type ScreenshotAsset = {
  url: string;
  origin: "video_frame" | "metadata_image";
  label: string;
  timestampSec?: number | null;
  sizeBytes?: number | null;
  sourcePath?: string | null;
};

export type VisualSearchCandidate = {
  query: string;
  source: "ocr_text" | "vision_search";
  rationale: string | null;
  candidateName: string | null;
  aliases?: string[];
  categoryHint?: "eat" | "do" | "stay" | "see" | null;
  locationHint?: string | null;
  formattedAddress: string | null;
  locality: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  visualEvidence?: string | null;
  needsReview?: boolean;
  locationVerified?: boolean;
  supportFrameLabels?: string[];
  queryShape?: VerificationQueryShape;
  corroborationCount?: number;
  semanticMismatch?: boolean;
  visualScore?: number;
  textSupportScore?: number;
  frameAgreementScore?: number;
  searchVerificationScore?: number;
  finalConfidence?: ConfidenceLabel;
  reason?: string | null;
  verificationConfidence: ConfidenceLabel;
  rankingScore: number;
  matchedSignals: string[];
};

export type VisualFallbackResult = {
  attempted: boolean;
  triggered: boolean;
  reason: string | null;
  provider: "shared_visual_fallback";
  confidence: ConfidenceLabel;
  needsReview: boolean;
  screenshots: ScreenshotAsset[];
  textQueries: string[];
  visualQueries: string[];
  candidates: VisualSearchCandidate[];
  selectedCandidate: VisualSearchCandidate | null;
  summaryText: string;
  debug?: Record<string, unknown>;
};

export type ExtractionSla = {
  totalMs: number;
  metadataMs: number;
  transcriptMs: number;
  ocrMs: number;
  visualFallbackMs: number;
};

export type ExtractionResult = {
  mode: ExtractionMode;
  metadata: ExtractedMetadata;
  transcript: TranscriptResult | null;
  ocr: OcrResult | null;
  visualFallback?: VisualFallbackResult | null;
  source: string;
  platform: SourcePlatform;
  canonicalUrl: string;
  stageStatus?: Record<ExtractionStageKey, ExtractionStageStatus>;
  stages?: Record<ExtractionStageKey, ExtractionStageResult>;
  stageTimingsMs?: Record<ExtractionStageKey, number>;
  stageFailures?: Partial<Record<ExtractionStageKey, string>>;
  combinedTextRaw?: string;
  combinedTextClean?: string;
  cleanupStats?: {
    rawChars: number;
    cleanChars: number;
    removedChars: number;
    droppedLines: number;
    dedupedLines: number;
      dedupedHashtags: number;
  };
  perf?: ExtractionSla;
  sla?: ExtractionSla;
  cache?: {
    hit: boolean;
    key: string;
  };
  debug?: Record<string, unknown>;
};
