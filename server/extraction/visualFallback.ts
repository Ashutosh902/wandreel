import type {
  ConfidenceLabel,
  ExtractedMetadata,
  OcrResult,
  ScreenshotAsset,
  TranscriptResult,
  VerificationQueryShape,
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

type VerificationAssessmentInput = {
  query: string;
  querySource: "ocr_text" | "vision_search";
  contextText: string;
  visualMeta: {
    name?: string | null;
    aliases?: string[];
    locationHint?: string | null;
    countryOrRegion?: string | null;
    evidence?: string | null;
    category?: string | null;
    supportFrameLabels?: string[];
  } | null;
  verified: VerifiedPlace;
};

type VerificationAssessment = {
  queryShape: VerificationQueryShape;
  allowSearchUpgrade: boolean;
  searchVerificationScore: number;
  corroborationCount: number;
  semanticMismatch: boolean;
  visualNameMatchesVerified: boolean;
  hasPlaceLikeTextSignal: boolean;
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

export function shouldTriggerVisualFallback(input: {
  metadata: ExtractedMetadata;
  transcript: TranscriptResult | null;
  ocr: OcrResult | null;
  forceTrigger?: boolean;
}): boolean {
  if (input.forceTrigger) return true;
  return isWeakEarlySignal(input.metadata, input.transcript, input.ocr);
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

function sanitizeText(input: string): string {
  return normalizeWhitespace(String(input || "").replace(/[^\p{L}\p{N}\s,&'/-]/gu, " "));
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

function scoreTextSupport(candidateParts: Array<string | null | undefined>, contextText: string): number {
  const contextTokens = new Set(tokenize(contextText));
  const candidateTokens = new Set(tokenize(candidateParts.filter(Boolean).join(" ")));
  if (candidateTokens.size === 0 || contextTokens.size === 0) return 0;
  let matched = 0;
  for (const token of candidateTokens) {
    if (contextTokens.has(token)) matched += 1;
  }
  return Number(Math.min(1, matched / Math.max(2, Math.min(6, candidateTokens.size))).toFixed(3));
}

function scoreFrameAgreement(frameLabels: string[] | undefined, screenshotCount: number): number {
  const uniqueCount = Array.from(new Set((frameLabels || []).filter(Boolean))).length;
  if (uniqueCount <= 0 || screenshotCount <= 0) return 0;
  if (uniqueCount >= 2) return 0.7;
  return screenshotCount === 1 ? 0.55 : 0.25;
}

function isLikelyPlaceNameQuery(query: string): boolean {
  const clean = sanitizeText(query);
  if (!clean || clean.length > 80) return false;
  const tokens = clean.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 8) return false;
  if (/\b(i|you|we|they|he|she|my|our|your|are|is|was|were|am|be|being|been|crossing|visited|visiting|watching|going|dangerous|stunning|beautiful|amazing|hidden|best|most|view)\b/i.test(clean)) {
    return false;
  }
  return /\b(waterfall|falls|temple|fort|palace|museum|monument|viewpoint|bridge|ghat|lake|beach|park|island|mount|hill|cafe|café|restaurant|hotel|resort)\b/i.test(clean);
}

export function classifyQueryShape(query: string): VerificationQueryShape {
  const clean = sanitizeText(query);
  const lower = clean.toLowerCase();
  const tokens = clean.split(/\s+/).filter(Boolean);
  if (!clean) return "generic_sentence";
  if (/\b(road|rd|street|st|avenue|ave|lane|ln|sector|block|floor|market|nagar|colony|near|opp|opposite|phase|plot)\b/i.test(clean) && /\d/.test(clean)) {
    return "address_like";
  }
  if (/\b(cafe|cafÃ©|restaurant|hotel|resort|bar|bakery|hostel|villa|homestay|rooftop|lounge)\b/i.test(clean)) {
    return "business_like";
  }
  if (/\b(waterfall|falls|temple|fort|palace|museum|monument|viewpoint|bridge|ghat|lake|beach|park|island|mount|hill|sanctuary|shrine|tower)\b/i.test(clean)) {
    if (/\b(i|you|we|my|our|your|crossing|visited|visiting|watching|going|most|best|stunning|beautiful|dangerous)\b/i.test(lower)) {
      return "descriptive_caption";
    }
    return "landmark_like";
  }
  if (/\b(i|you|we|they|he|she|my|our|your|crossing|visited|visiting|watching|going|feels|look|looks|view)\b/i.test(lower) || tokens.length > 6) {
    return /\b(stunning|beautiful|amazing|hidden|best|favorite|view)\b/i.test(lower) ? "descriptive_caption" : "generic_sentence";
  }
  if (tokens.length <= 5 && tokens.some((token) => /^[A-Z][a-z]+$/.test(token))) {
    return "place_like";
  }
  return "generic_sentence";
}

function inferSceneTags(input: string): Set<string> {
  const clean = sanitizeText(input).toLowerCase();
  const tags = new Set<string>();
  if (/\bwaterfall|falls|cascade\b/.test(clean)) {
    tags.add("waterfall");
    tags.add("nature");
  }
  if (/\bnature|forest|mountain|cliff|valley|river|scenic\b/.test(clean)) tags.add("nature");
  if (/\btemple|shrine|spiritual|ghat\b/.test(clean)) tags.add("spiritual");
  if (/\bbridge\b/.test(clean)) tags.add("bridge");
  if (/\bcafe|cafÃ©|restaurant|food|taste\b/.test(clean)) tags.add("food");
  if (/\bhotel|resort|stay|villa|hostel\b/.test(clean)) tags.add("stay");
  return tags;
}

function hasTokenOverlap(partsA: string[], partsB: string[]): boolean {
  const left = new Set(partsA.flatMap((part) => tokenize(part)));
  if (left.size === 0) return false;
  for (const token of partsB.flatMap((part) => tokenize(part))) {
    if (left.has(token)) return true;
  }
  return false;
}

export function isSemanticMismatch(sceneText: string, candidateText: string): boolean {
  const sceneTags = inferSceneTags(sceneText);
  if (sceneTags.size === 0) return false;
  const candidateTags = inferSceneTags(candidateText);
  if (sceneTags.has("waterfall") && !candidateTags.has("waterfall") && candidateTags.has("bridge")) return true;
  if (sceneTags.has("nature") && !candidateTags.has("nature") && (candidateTags.has("food") || candidateTags.has("stay"))) return true;
  if (sceneTags.has("spiritual") && !candidateTags.has("spiritual") && (candidateTags.has("food") || candidateTags.has("stay"))) return true;
  return false;
}

export function assessVerificationCandidate(input: VerificationAssessmentInput): VerificationAssessment {
  const queryShape = classifyQueryShape(input.query);
  const queryAllowsSearch =
    queryShape === "place_like" ||
    queryShape === "address_like" ||
    queryShape === "business_like" ||
    queryShape === "landmark_like";
  const visualNameMatchesVerified = Boolean(
    input.visualMeta?.name &&
      input.verified.candidateName &&
      hasTokenOverlap([input.visualMeta.name, ...(input.visualMeta.aliases || [])], [input.verified.candidateName]),
  );
  const sceneText = [
    input.contextText,
    input.visualMeta?.evidence || "",
    input.visualMeta?.name || "",
    ...(input.visualMeta?.aliases || []),
  ].join(" ");
  const semanticMismatch = isSemanticMismatch(
    sceneText,
    [
      input.verified.candidateName,
      input.verified.formattedAddress,
      input.verified.locality,
      input.verified.city,
      input.verified.state,
      input.verified.country,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const hasPlaceLikeTextSignal =
    queryAllowsSearch &&
    (queryShape === "place_like" || queryShape === "address_like" || queryShape === "business_like" || isLikelyPlaceNameQuery(input.query));
  const corroborationCount =
    (hasPlaceLikeTextSignal ? 1 : 0) +
    (visualNameMatchesVerified ? 1 : 0) +
    ((input.visualMeta?.supportFrameLabels?.length || 0) >= 2 ? 1 : 0) +
    (hasTokenOverlap(
      [input.verified.candidateName || "", input.verified.locality || "", input.verified.city || "", input.verified.state || "", input.verified.country || ""],
      [input.contextText],
    )
      ? 1
      : 0);
  const allowSearchUpgrade =
    input.querySource === "vision_search"
      ? !semanticMismatch
      : queryAllowsSearch && corroborationCount > 0 && !semanticMismatch;
  const rawSearchScore = confidenceToWeight(input.verified.verificationConfidence);
  const searchVerificationScore = allowSearchUpgrade
    ? rawSearchScore
    : input.querySource === "ocr_text" && (queryShape === "generic_sentence" || queryShape === "descriptive_caption")
      ? Math.min(0.2, rawSearchScore)
      : semanticMismatch
        ? Math.min(0.1, rawSearchScore)
        : Math.min(0.2, rawSearchScore);

  return {
    queryShape,
    allowSearchUpgrade,
    searchVerificationScore: Number(searchVerificationScore.toFixed(3)),
    corroborationCount,
    semanticMismatch,
    visualNameMatchesVerified,
    hasPlaceLikeTextSignal,
  };
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
  const prefix = selectedCandidate.reason?.includes("possible_match") ? "Possible match" : "Visual fallback candidate";
  const parts = [
    `${prefix}: ${selectedCandidate.candidateName || selectedCandidate.query}`,
    selectedCandidate.aliases?.length ? `aliases: ${selectedCandidate.aliases.join(", ")}` : null,
    selectedCandidate.locationHint ? `location hint: ${selectedCandidate.locationHint}` : null,
    selectedCandidate.formattedAddress ? `address: ${selectedCandidate.formattedAddress}` : null,
    selectedCandidate.locationVerified === false ? "location not verified" : null,
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
  forceTrigger?: boolean;
  forceTriggerReason?: string | null;
}): Promise<VisualFallbackResult> {
  const screenshots = input.screenshots ?? (await selectSourceScreenshots(input.metadata));
  const shouldTrigger = shouldTriggerVisualFallback({
    metadata: input.metadata,
    transcript: input.transcript,
    ocr: input.ocr,
    forceTrigger: input.forceTrigger,
  });
  if (!shouldTrigger) {
    const debug = {
      didRun: false,
      reason: "sufficient_upstream_signal",
    };
    console.info("[visual-fallback-debug]", debug);
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
      debug,
    };
  }

  if (screenshots.length === 0) {
    const debug = {
      didRun: true,
      reason: input.forceTriggerReason || "no_screenshots_available",
      screenshotCount: 0,
    };
    console.info("[visual-fallback-debug]", debug);
    return {
      attempted: true,
      triggered: true,
      reason: input.forceTriggerReason || "no_screenshots_available",
      provider: "shared_visual_fallback",
      confidence: "low",
      needsReview: true,
      screenshots: [],
      textQueries: [],
      visualQueries: [],
      candidates: [],
      selectedCandidate: null,
      summaryText: "Visual fallback triggered but no screenshot was available for candidate generation.",
      debug,
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
      const queryShape = classifyQueryShape(query);
      const shouldVerifyDirectly =
        querySource === "vision_search" ||
        queryShape === "place_like" ||
        queryShape === "address_like" ||
        queryShape === "business_like" ||
        queryShape === "landmark_like";
      const verified = shouldVerifyDirectly
        ? await verifyPlaceQuery(query)
        : {
            candidateName: null,
            formattedAddress: null,
            locality: null,
            city: null,
            state: null,
            country: null,
            placeId: null,
            lat: null,
            lng: null,
            verificationConfidence: "low" as const,
          };
      const matchedSignals = matchSignals(query, verified, contextText);
      const verificationAssessment = assessVerificationCandidate({
        query,
        querySource,
        contextText,
        visualMeta,
        verified,
      });
      const verificationWeight = verificationAssessment.searchVerificationScore;
      const visualWeight = visualMeta ? confidenceToWeight(visualMeta.confidence) : querySource === "ocr_text" ? 0.75 : 0.35;
      const overlapWeight = Math.min(0.25, matchedSignals.length * 0.05);
      const textSupportScore = visualMeta
        ? scoreTextSupport(
            [
              visualMeta.name,
              ...(visualMeta.aliases || []),
              visualMeta.locationHint,
              visualMeta.countryOrRegion,
              verified.candidateName,
              verified.locality,
              verified.city,
              verified.state,
              verified.country,
            ],
            contextText,
          )
        : Number(Math.min(1, matchedSignals.length / 6).toFixed(3));
      const frameAgreementScore = visualMeta ? scoreFrameAgreement(visualMeta.supportFrameLabels, screenshots.length) : 0;
      const searchVerificationScore = verificationAssessment.searchVerificationScore;
      const specificLandmarkBoost =
        visualMeta?.name &&
        visualMeta?.confidence &&
        visualMeta.confidence !== "low" &&
        (textSupportScore >= 0.4 || frameAgreementScore >= 0.7 || verificationAssessment.allowSearchUpgrade)
          ? 0.15
          : 0;
      const categoryBoost = visualMeta?.category === "see" ? 0.05 : 0;
      const unsupportedVisionPenalty =
        querySource === "vision_search" && searchVerificationScore <= 0.2 && textSupportScore < 0.35 && frameAgreementScore < 0.7 ? 0.2 : 0;
      const genericTextPenalty =
        querySource === "ocr_text" && (queryShape === "generic_sentence" || queryShape === "descriptive_caption") ? 0.25 : 0;
      const semanticMismatchPenalty = verificationAssessment.semanticMismatch ? 0.35 : 0;
      const rankingScore = Number(
        Math.max(
          0,
          Math.min(
            1,
            verificationWeight * 0.3 +
              visualWeight * 0.3 +
              textSupportScore * 0.2 +
              frameAgreementScore * 0.1 +
              overlapWeight +
              specificLandmarkBoost +
              categoryBoost +
              (verificationAssessment.allowSearchUpgrade && verified.placeId ? 0.05 : 0) -
              unsupportedVisionPenalty -
              genericTextPenalty -
              semanticMismatchPenalty,
          ),
        ).toFixed(3),
      );
      const locationHint =
        [visualMeta?.locationHint, visualMeta?.countryOrRegion].filter(Boolean).join(", ") ||
        null;
      const finalConfidence =
        (querySource === "vision_search" && searchVerificationScore <= 0.2 && textSupportScore < 0.35 && frameAgreementScore < 0.7) ||
        verificationAssessment.semanticMismatch
          ? "low"
          : toConfidenceLabel(rankingScore);
      const supportReason =
        verificationAssessment.semanticMismatch
          ? "semantic_mismatch_rejected"
          : querySource === "ocr_text" && (queryShape === "generic_sentence" || queryShape === "descriptive_caption")
            ? "generic_text_not_verifiable"
          : verificationAssessment.allowSearchUpgrade && verified.verificationConfidence !== "low"
          ? "search_verified_support"
          : verificationAssessment.corroborationCount <= 0 && querySource === "ocr_text"
            ? "needs_corroboration"
          : textSupportScore >= 0.45
            ? "text_or_location_support"
            : frameAgreementScore >= 0.7
              ? "multiple_frames_agree"
              : querySource === "vision_search"
                ? "vision_only_possible_match"
                : "ocr_text_candidate";
      return {
        query,
        source: querySource,
        rationale: visualMeta?.rationale || null,
        candidateName: verified.candidateName || visualMeta?.name || null,
        aliases: visualMeta?.aliases || [],
        categoryHint: visualMeta?.category || null,
        locationHint,
        formattedAddress: verified.formattedAddress,
        locality: verified.locality,
        city: verified.city,
        state: verified.state,
        country: verified.country || visualMeta?.countryOrRegion || null,
        placeId: verified.placeId,
        lat: verified.lat,
        lng: verified.lng,
        visualEvidence: visualMeta?.evidence || null,
        needsReview: visualMeta?.needsReview ?? true,
        locationVerified: Boolean(verificationAssessment.allowSearchUpgrade && (verified.placeId || verified.formattedAddress)),
        supportFrameLabels: visualMeta?.supportFrameLabels || [],
        queryShape,
        corroborationCount: verificationAssessment.corroborationCount,
        semanticMismatch: verificationAssessment.semanticMismatch,
        visualScore: Number(visualWeight.toFixed(3)),
        textSupportScore,
        frameAgreementScore,
        searchVerificationScore,
        finalConfidence,
        reason: supportReason,
        verificationConfidence: verified.verificationConfidence,
        rankingScore,
        matchedSignals,
      } satisfies VisualSearchCandidate;
    }),
  );

  candidates.sort((a, b) => b.rankingScore - a.rankingScore);
  const selectedCandidate = candidates[0] || null;
  const topVisionCandidates = candidates.filter((candidate) => candidate.source === "vision_search" && candidate.candidateName);
  const primaryVisionCandidate = topVisionCandidates[0] || null;
  const competingVisionCandidate =
    primaryVisionCandidate &&
    topVisionCandidates.find(
      (candidate) =>
        candidate.candidateName &&
        candidate.candidateName !== primaryVisionCandidate.candidateName &&
        Math.abs(candidate.rankingScore - primaryVisionCandidate.rankingScore) <= 0.08 &&
        (candidate.textSupportScore || 0) < 0.45 &&
        (primaryVisionCandidate.textSupportScore || 0) < 0.45 &&
        (candidate.searchVerificationScore || 0) < 0.65 &&
        (primaryVisionCandidate.searchVerificationScore || 0) < 0.65,
    );
  const promotionEligible = (candidate: VisualSearchCandidate | null) =>
    Boolean(
      candidate &&
        (
          (candidate.locationVerified && !candidate.semanticMismatch) ||
          (candidate.searchVerificationScore || 0) >= 0.65 ||
          (candidate.textSupportScore || 0) >= 0.45 ||
          (candidate.frameAgreementScore || 0) >= 0.7
        ) &&
        (candidate.corroborationCount || 0) > 0,
    );
  const promotableOcrCandidate = (candidate: VisualSearchCandidate | null) =>
    Boolean(
      candidate &&
        candidate.source === "ocr_text" &&
        (
          (candidate.locationVerified && !candidate.semanticMismatch) ||
          Boolean(candidate.candidateName) ||
          (candidate.searchVerificationScore || 0) >= 0.65 ||
          ((candidate.textSupportScore || 0) >= 0.45 && isLikelyPlaceNameQuery(candidate.query))
        ) &&
        (candidate.queryShape === "place_like" || candidate.queryShape === "address_like" || candidate.queryShape === "business_like" || candidate.queryShape === "landmark_like") &&
        !candidate.semanticMismatch &&
        (candidate.corroborationCount || 0) > 0,
    );
  let finalSelectedCandidate: VisualSearchCandidate | null = null;
  if (promotableOcrCandidate(selectedCandidate)) {
    finalSelectedCandidate = selectedCandidate;
  } else if (primaryVisionCandidate && promotionEligible(primaryVisionCandidate) && !competingVisionCandidate) {
    finalSelectedCandidate = primaryVisionCandidate;
  }

  if (selectedCandidate?.source === "ocr_text" && !finalSelectedCandidate) {
    selectedCandidate.reason = "descriptive_ocr_not_promoted";
  }
  if (!finalSelectedCandidate && primaryVisionCandidate && !competingVisionCandidate) {
    primaryVisionCandidate.reason = primaryVisionCandidate.reason === "vision_only_possible_match" ? "vision_only_possible_match" : "possible_match_unverified";
  }
  if (!finalSelectedCandidate && primaryVisionCandidate && competingVisionCandidate) {
    primaryVisionCandidate.reason = "conflicting_visual_landmarks";
    competingVisionCandidate.reason = "conflicting_visual_landmarks";
  }

  const confidence = finalSelectedCandidate?.finalConfidence || toConfidenceLabel(finalSelectedCandidate?.rankingScore || 0);
  const needsReview =
    !finalSelectedCandidate ||
    !finalSelectedCandidate.locationVerified ||
    confidence !== "high";
  const summaryText =
    finalSelectedCandidate
      ? buildSummary(finalSelectedCandidate, confidence, needsReview)
      : primaryVisionCandidate && competingVisionCandidate
        ? `Possible matches: ${[primaryVisionCandidate.candidateName, competingVisionCandidate.candidateName].filter(Boolean).join(" | ")} | location not verified | manual verification recommended`
        : primaryVisionCandidate
          ? `Possible match: ${primaryVisionCandidate.candidateName || primaryVisionCandidate.query} | location not verified | manual verification recommended`
          : "Visual fallback did not find a verified place candidate.";

  const debug = {
    didRun: true,
    screenshotCount: screenshots.length,
    screenshots: screenshots.map((shot) => ({
      origin: shot.origin,
      label: shot.label,
      timestampSec: shot.timestampSec ?? null,
      sizeBytes: shot.sizeBytes ?? (shot.url.startsWith("data:") ? Math.round(shot.url.length * 0.75) : null),
      urlKind: shot.url.startsWith("data:") ? "data_url" : "remote_url",
    })),
    textQueries,
    visualQueries,
    visualRecognition: visualSearch.debug || null,
    candidateVerification: candidates.map((candidate) => ({
      query: candidate.query,
      source: candidate.source,
      candidateName: candidate.candidateName,
      aliases: candidate.aliases || [],
      queryShape: candidate.queryShape || null,
      searchVerificationScore: candidate.searchVerificationScore ?? null,
      visualScore: candidate.visualScore ?? null,
      textSupportScore: candidate.textSupportScore ?? null,
      frameAgreementScore: candidate.frameAgreementScore ?? null,
      rankingScore: candidate.rankingScore,
      finalConfidence: candidate.finalConfidence || null,
      reason: candidate.reason || null,
      locationVerified: candidate.locationVerified ?? false,
      verificationConfidence: candidate.verificationConfidence,
      semanticMismatch: candidate.semanticMismatch ?? false,
      corroborationCount: candidate.corroborationCount ?? null,
      matchedSignals: candidate.matchedSignals,
    })),
    selection: {
      selectedCandidate: finalSelectedCandidate,
      possibleMatches: [primaryVisionCandidate, competingVisionCandidate].filter(Boolean),
      confidence,
      needsReview,
      locationVerified: finalSelectedCandidate?.locationVerified ?? false,
      summaryText,
      reason: finalSelectedCandidate
        ? "selected_promoted_candidate"
        : primaryVisionCandidate && competingVisionCandidate
          ? "conflicting_visual_landmarks"
          : primaryVisionCandidate
            ? primaryVisionCandidate.reason || "unverified_possible_match"
            : visualSearch.reason || "no_visual_candidates",
    },
  };
  console.info("[visual-fallback-debug]", debug);

  return {
    attempted: true,
    triggered: true,
    reason: finalSelectedCandidate ? visualSearch.reason : visualSearch.reason || "no_verified_candidates",
    provider: "shared_visual_fallback",
    confidence,
    needsReview,
    screenshots,
    textQueries,
    visualQueries,
    candidates,
    selectedCandidate: finalSelectedCandidate,
    summaryText,
    debug,
  };
}
