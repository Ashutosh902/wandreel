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

export type ExtractionResult = {
  mode: ExtractionMode;
  metadata: ExtractedMetadata;
  transcript: TranscriptResult | null;
  ocr: OcrResult | null;
};
