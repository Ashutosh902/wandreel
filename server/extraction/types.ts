export type SourcePlatform = "youtube" | "instagram" | "web";

export type ExtractionMode = "quick" | "deep";

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

export type ExtractionSla = {
  totalMs: number;
  metadataMs: number;
  transcriptMs: number;
  ocrMs: number;
};

export type ExtractionResult = {
  mode: ExtractionMode;
  metadata: ExtractedMetadata;
  transcript: TranscriptResult | null;
  ocr: OcrResult | null;
  source: string;
  platform: SourcePlatform;
  canonicalUrl: string;
  stageStatus?: Record<"basicMetadata" | "caption" | "transcript" | "ocr", ExtractionStageStatus>;
  stages?: Record<"basicMetadata" | "caption" | "transcript" | "ocr", ExtractionStageResult>;
  stageTimingsMs?: Record<"basicMetadata" | "caption" | "transcript" | "ocr", number>;
  stageFailures?: Partial<Record<"basicMetadata" | "caption" | "transcript" | "ocr", string>>;
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
};
