import type {
  ConfidenceLabel,
  ExtractedMetadata,
  OcrResult,
  ScreenshotAsset,
  TranscriptResult,
  VisualFallbackResult,
  VisualSearchCandidate,
} from "./types";
import { selectSourceScreenshots } from "./frameSelection";
import { generateVisualSearchCandidates } from "./visualSearch";

type VerifiedPlace = {
  candidateName: string | null;
  formattedAddress: string | null;
  locality: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  verificationConfidence: ConfidenceLabel;
};

function getApiKey() {
  return String(
    process.env.GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_PLACES_API_KEY ||
      process.env.VITE_GOOGLE_PLACES_API_KEY ||
      "",
  ).trim();
}

function normalizeWhitespace(input: string): string {
  return String(input || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function meaningfulTextLength(...parts: Array<string | null | undefined>) {
  return normalizeWhitespace(parts.filter(Boolean).join("\n")).length;
}

function isWeakEarlySignal(metadata: ExtractedMetadata, transcript: TranscriptResult | null, ocr: OcrResult | null): boolean {
  const description = String(metadata.description || "").trim();
  const transcriptText = String(transcript?.text || "").trim();
  const ocrText = String(ocr?.text || "").trim();
  const totalChars = meaningfulTextLength(metadata.title, description, transcriptText, ocrText);
  const signalCount = [description.length > 40, transcriptText.length > 80, ocrText.length > 40].filter(Boolean).length;
  const ambiguityHints = /\b(dm for location|location in comments|comment ['"]?location['"]?|guess this place|hidden place)\b/i.test(description);
  return totalChars < 220 || signalCount < 2 || ambiguityHints;
}

function extractLines(input: string): string[] {
  return normalizeWhitespace(input)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isNoiseLine(line: string): boolean {
  return (
    line.length < 3 ||
    line.length > 80 ||
    /^https?:\/\//i.test(line) ||
    /^[@#]/.test(line) ||
    /\b(dm|follow|subscribe|link in bio|comment)\b/i.test(line)
  );
}

function dedupeQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of queries) {
    const cleaned = item.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function deriveTextQueries(metadata: ExtractedMetadata, transcript: TranscriptResult | null, ocr: OcrResult | null): string[] {
  const ocrLines = extractLines(ocr?.text || "")
    .filter((line) => !isNoiseLine(line))
    .slice(0, 6);

  const title = String(metadata.title || "").trim();
  const description = String(metadata.description || "").trim();
  const titleQuery = title && title.toLowerCase() !== "untitled" && title.toLowerCase() !== "instagram" ? [title] : [];
  const descriptionCandidates = extractLines(description)
    .filter((line) => !isNoiseLine(line))
    .slice(0, 2);
  const transcriptCandidates = extractLines(transcript?.text || "")
    .filter((line) => !isNoiseLine(line))
    .slice(0, 2);

  return dedupeQueries([...ocrLines, ...titleQuery, ...descriptionCandidates, ...transcriptCandidates]).slice(0, 6);
}

function toConfidenceLabel(score: number): ConfidenceLabel {
  if (score >= 0.8) return "high";
  if (score >= 0.55) return "medium";
  return "low";
}

function confidenceToWeight(confidence: ConfidenceLabel): number {
  if (confidence === "high") return 0.9;
  if (confidence === "medium") return 0.65;
  return 0.35;
}

function tokenize(input: string): string[] {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function buildContextText(metadata: ExtractedMetadata, transcript: TranscriptResult | null, ocr: OcrResult | null): string {
  return normalizeWhitespace([metadata.title, metadata.description, transcript?.text || "", ocr?.text || ""].filter(Boolean).join("\n"));
}

function matchSignals(query: string, place: VerifiedPlace, contextText: string): string[] {
  const signalMatches = new Set<string>();
  const contextTokens = new Set(tokenize(contextText));
  const queryTokens = tokenize(query);
  for (const token of queryTokens) {
    if (contextTokens.has(token)) signalMatches.add(`context:${token}`);
  }
  for (const token of tokenize(place.candidateName || "")) {
    if (contextTokens.has(token)) signalMatches.add(`name:${token}`);
  }
  for (const token of tokenize([place.locality, place.city, place.state, place.country].filter(Boolean).join(" "))) {
    if (contextTokens.has(token)) signalMatches.add(`location:${token}`);
  }
  return Array.from(signalMatches).slice(0, 6);
}

function pickComponent(components: Array<{ long_name?: string; types?: string[] }>, target: string): string | null {
  for (const item of components) {
    if (Array.isArray(item.types) && item.types.includes(target) && item.long_name) {
      return item.long_name;
    }
  }
  return null;
}

async function verifyPlaceQuery(query: string): Promise<VerifiedPlace> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      candidateName: null,
      formattedAddress: null,
      locality: null,
      city: null,
      state: null,
      country: null,
      placeId: null,
      lat: null,
      lng: null,
      verificationConfidence: "low",
    };
  }

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
    url.searchParams.set("input", query);
    url.searchParams.set("inputtype", "textquery");
    url.searchParams.set("fields", "place_id,name,formatted_address,geometry");
    url.searchParams.set("key", apiKey);
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`maps_status_${response.status}`);
    const data = (await response.json()) as any;
    const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : null;
    if (!candidate?.place_id) {
      return {
        candidateName: null,
        formattedAddress: null,
        locality: null,
        city: null,
        state: null,
        country: null,
        placeId: null,
        lat: null,
        lng: null,
        verificationConfidence: "low",
      };
    }

    const geocodeUrl = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    geocodeUrl.searchParams.set("place_id", String(candidate.place_id));
    geocodeUrl.searchParams.set("key", apiKey);
    const geocodeResponse = await fetch(geocodeUrl.toString());
    const geocode = geocodeResponse.ok ? ((await geocodeResponse.json()) as any) : null;
    const result = Array.isArray(geocode?.results) ? geocode.results[0] : null;
    const components = Array.isArray(result?.address_components) ? result.address_components : [];
    const geometry = result?.geometry?.location || candidate?.geometry?.location || null;

    return {
      candidateName: typeof candidate?.name === "string" ? candidate.name : null,
      formattedAddress: typeof result?.formatted_address === "string" ? result.formatted_address : typeof candidate?.formatted_address === "string" ? candidate.formatted_address : null,
      locality: pickComponent(components, "sublocality_level_1") || pickComponent(components, "locality"),
      city: pickComponent(components, "administrative_area_level_2") || pickComponent(components, "locality"),
      state: pickComponent(components, "administrative_area_level_1"),
      country: pickComponent(components, "country"),
      placeId: typeof candidate?.place_id === "string" ? candidate.place_id : null,
      lat: typeof geometry?.lat === "number" ? geometry.lat : null,
      lng: typeof geometry?.lng === "number" ? geometry.lng : null,
      verificationConfidence: result?.formatted_address ? "high" : candidate?.formatted_address ? "medium" : "low",
    };
  } catch {
    return {
      candidateName: null,
      formattedAddress: null,
      locality: null,
      city: null,
      state: null,
      country: null,
      placeId: null,
      lat: null,
      lng: null,
      verificationConfidence: "low",
    };
  }
}

function buildSummary(selectedCandidate: VisualSearchCandidate | null, confidence: ConfidenceLabel, needsReview: boolean): string {
  if (!selectedCandidate) {
    return "Visual fallback did not find a verified place candidate.";
  }
  const parts = [
    `Visual fallback candidate: ${selectedCandidate.candidateName || selectedCandidate.query}`,
    selectedCandidate.formattedAddress ? `address: ${selectedCandidate.formattedAddress}` : null,
    `confidence: ${confidence}`,
    needsReview ? "manual verification recommended" : "verified candidate",
  ].filter(Boolean);
  return parts.join(" | ");
}

export async function runVisualFallback(input: {
  metadata: ExtractedMetadata;
  transcript: TranscriptResult | null;
  ocr: OcrResult | null;
  screenshots?: ScreenshotAsset[];
}): Promise<VisualFallbackResult> {
  const screenshots = input.screenshots ?? (await selectSourceScreenshots(input.metadata));
  const shouldTrigger = isWeakEarlySignal(input.metadata, input.transcript, input.ocr);
  if (!shouldTrigger) {
    return {
      attempted: false,
      triggered: false,
      reason: "sufficient_upstream_signal",
      provider: "shared_visual_fallback",
      confidence: "high",
      needsReview: false,
      screenshots,
      textQueries: [],
      visualQueries: [],
      candidates: [],
      selectedCandidate: null,
      summaryText: "",
    };
  }

  if (screenshots.length === 0) {
    return {
      attempted: true,
      triggered: true,
      reason: "no_screenshots_available",
      provider: "shared_visual_fallback",
      confidence: "low",
      needsReview: true,
      screenshots: [],
      textQueries: [],
      visualQueries: [],
      candidates: [],
      selectedCandidate: null,
      summaryText: "Visual fallback triggered but no screenshot was available for candidate generation.",
    };
  }

  const textQueries = deriveTextQueries(input.metadata, input.transcript, input.ocr);
  const visualSearch = await generateVisualSearchCandidates({
    screenshots,
    metadata: input.metadata,
    transcript: input.transcript,
    ocr: input.ocr,
  });
  const visualQueries = dedupeQueries((visualSearch.candidates || []).map((candidate) => candidate.query)).slice(0, 5);
  const combinedQueries = dedupeQueries([...textQueries, ...visualQueries]).slice(0, 8);
  const contextText = buildContextText(input.metadata, input.transcript, input.ocr);

  const candidates = await Promise.all(
    combinedQueries.map(async (query) => {
      const querySource = textQueries.includes(query) ? "ocr_text" : "vision_search";
      const visualMeta = visualSearch.candidates.find((item) => item.query.toLowerCase() === query.toLowerCase()) || null;
      const verified = await verifyPlaceQuery(query);
      const matchedSignals = matchSignals(query, verified, contextText);
      const verificationWeight = confidenceToWeight(verified.verificationConfidence);
      const visualWeight = visualMeta ? confidenceToWeight(visualMeta.confidence) : querySource === "ocr_text" ? 0.75 : 0.35;
      const overlapWeight = Math.min(0.25, matchedSignals.length * 0.05);
      const rankingScore = Number(Math.min(1, verificationWeight * 0.55 + visualWeight * 0.3 + overlapWeight + (verified.placeId ? 0.1 : 0)).toFixed(3));
      return {
        query,
        source: querySource,
        rationale: visualMeta?.rationale || null,
        candidateName: verified.candidateName,
        formattedAddress: verified.formattedAddress,
        locality: verified.locality,
        city: verified.city,
        state: verified.state,
        country: verified.country,
        placeId: verified.placeId,
        lat: verified.lat,
        lng: verified.lng,
        verificationConfidence: verified.verificationConfidence,
        rankingScore,
        matchedSignals,
      } satisfies VisualSearchCandidate;
    }),
  );

  candidates.sort((a, b) => b.rankingScore - a.rankingScore);
  const selectedCandidate = candidates[0] || null;
  const confidence = toConfidenceLabel(selectedCandidate?.rankingScore || 0);
  const needsReview = confidence !== "high";

  return {
    attempted: true,
    triggered: true,
    reason: selectedCandidate ? visualSearch.reason : visualSearch.reason || "no_verified_candidates",
    provider: "shared_visual_fallback",
    confidence,
    needsReview,
    screenshots,
    textQueries,
    visualQueries,
    candidates,
    selectedCandidate,
    summaryText: buildSummary(selectedCandidate, confidence, needsReview),
  };
}
