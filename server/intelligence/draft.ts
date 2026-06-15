import type { ExtractionResult } from "../extraction/types";
import type { IntelligenceOutput, SupportedCategory } from "./types";

const GENERIC_HASHTAG_BLACKLIST = new Set([
  "reels",
  "reelsinstagram",
  "reelsvideo",
  "viral",
  "explore",
  "explorepage",
  "explormore",
  "trending",
  "trendingreels",
  "save",
  "travelreels",
  "traveltheworld",
  "naturelovers",
  "roadtrip",
  "corporate",
  "south",
  "placetovisit",
  "pluviophile",
  "reeltemplates",
]);

function titleLooksLikeSocialBoilerplate(title: string): boolean {
  return / on instagram:/i.test(title) || /follow\s+@/i.test(title) || /&quot;/i.test(title);
}

function decodeEntities(input: string): string {
  return input
    .replace(/&quot;/gi, "\"")
    .replace(/&#064;/gi, "@")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'");
}

function normalizeHashtagLabel(value: string): string {
  const cleaned = value.replace(/^#/, "").replace(/[_-]+/g, " ").trim();
  if (!cleaned) return "";

  const scenicSuffixes = ["hills", "hill", "fort", "falls", "waterfall", "lake", "beach", "temple", "park", "palace", "museum", "gardens", "viewpoint"];
  for (const suffix of scenicSuffixes) {
    if (cleaned.toLowerCase().endsWith(suffix) && cleaned.toLowerCase() !== suffix) {
      const prefix = cleaned.slice(0, -suffix.length).trim();
      return `${prefix} ${suffix}`
        .trim()
        .replace(/\s+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
    }
  }

  return cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractHashtags(text: string): string[] {
  return Array.from(text.matchAll(/#([a-z0-9_]+)/gi))
    .map((match) => String(match[1] || "").trim())
    .filter(Boolean);
}

function inferCategory(text: string): SupportedCategory {
  const t = text.toLowerCase();
  if (/\b(hill|hills|viewpoint|sunrise|sunset|nature|clouds|scenic|trek|trekking|camping|fort|waterfall|falls|lake|beach|temple|palace|monument|tourist|landmark|retreat)\b/.test(t)) return "see";
  if (/\b(hotel|stay|resort|homestay|hostel|room|villa|suite)\b/.test(t)) return "stay";
  if (/\b(food|cafe|café|restaurant|biryani|lunch|dinner|eatery|chai|kitchen|bakery|dessert)\b/.test(t)) return "eat";
  if (/\b(activity|adventure|cycling|workshop|sports|boating|show|event|karting|zipline)\b/.test(t)) return "do";
  if (/\b(park|museum|garden|gardens)\b/.test(t)) return "see";
  return "see";
}

type OcrHeuristicCandidate = {
  name: string;
  locality: string | null;
  category: SupportedCategory;
  confidence: "high" | "medium" | "low";
  evidenceText: string;
};

const OCR_VENUE_TERMS = /\b(cafe|café|restaurant|bar|bakery|bistro|diner|kitchen|eatery|canteen|food court)\b/i;
const OCR_GENERIC_FOOD_WORDS = /\b(coffee|tea|food|drinks?)\b/i;
const OCR_SLOGAN_PATTERNS = /\b(you|me|my|our)\b|by the sea|happy place/i;
const OCR_CONTEXT_CONNECTORS = /\b(in|at|near)\b|,/i;

function normalizeOcrLine(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOcrCandidateName(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function tokenizeOcrLine(value: string): string[] {
  return normalizeOcrLine(value)
    .split(/[^A-Za-z0-9&']+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function countAlphabeticTokens(tokens: string[]): number {
  return tokens.filter((token) => /[A-Za-z]/.test(token)).length;
}

function countUppercaseTokens(tokens: string[]): number {
  return tokens.filter((token) => token.length >= 3 && token === token.toUpperCase() && /[A-Z]/.test(token)).length;
}

function getProperNameTokenCount(tokens: string[]): number {
  return tokens.filter((token) => /^[A-Z][a-z0-9&']+$/.test(token)).length;
}

function buildSupportKey(line: string): string {
  return tokenizeOcrLine(line)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 3)
    .join(" ");
}

function extractLocalityFromParts(parts: string[]): string | null {
  if (parts.length < 2) return null;
  const candidate = normalizeOcrCandidateName(parts[parts.length - 1] || "");
  if (!candidate) return null;
  return candidate.length >= 3 && candidate.length <= 40 ? candidate : null;
}

function extractLocalityFromTokens(tokens: string[]): string | null {
  const venueTokenIndex = tokens.findIndex((token) => OCR_VENUE_TERMS.test(token));
  if (venueTokenIndex < 0) return null;
  const rightToken = venueTokenIndex + 1 < tokens.length ? tokens[venueTokenIndex + 1] : "";
  if (/^[A-Z][a-z0-9&']+$/.test(rightToken) && rightToken.length >= 3) {
    return normalizeOcrCandidateName(rightToken);
  }
  const trailingProperToken = [...tokens].reverse().find((token) => /^[A-Z][a-z0-9&']+$/.test(token) && !OCR_VENUE_TERMS.test(token));
  return trailingProperToken ? normalizeOcrCandidateName(trailingProperToken) : null;
}

function buildCandidateNameFromLine(line: string, tokens: string[]): string | null {
  const commaPrefix = line.split(",")[0]?.trim() || "";
  const commaPrefixTokens = tokenizeOcrLine(commaPrefix);
  const commaPrefixLooksVenueLike =
    OCR_VENUE_TERMS.test(commaPrefix) ||
    getProperNameTokenCount(commaPrefixTokens) >= 2;
  if (
    commaPrefix &&
    commaPrefix.length >= 3 &&
    !OCR_SLOGAN_PATTERNS.test(commaPrefix) &&
    commaPrefixLooksVenueLike
  ) {
    return normalizeOcrCandidateName(commaPrefix);
  }

  const venueTokenIndex = tokens.findIndex((token) => OCR_VENUE_TERMS.test(token));
  if (venueTokenIndex >= 0) {
    const leftToken = venueTokenIndex > 0 ? tokens[venueTokenIndex - 1] : "";
    const pair = [leftToken, tokens[venueTokenIndex]].filter(Boolean).join(" ").trim();
    if (pair.length >= 3) {
      return normalizeOcrCandidateName(pair);
    }
  }

  const properTokens = tokens.filter((token) => /^[A-Z][a-z0-9&']+$/.test(token));
  if (properTokens.length >= 2) {
    return normalizeOcrCandidateName(properTokens.slice(0, 2).join(" "));
  }
  if (properTokens.length === 1 && venueTokenIndex >= 0) {
    return normalizeOcrCandidateName(`${properTokens[0]} ${tokens[venueTokenIndex]}`);
  }
  return null;
}

function scoreOcrVenueCandidate(line: string, supportCount: number): {
  score: number;
  name: string | null;
  locality: string | null;
  confidence: "high" | "medium" | "low";
} | null {
  const normalizedLine = normalizeOcrLine(line);
  if (!normalizedLine) return null;

  const hasVenueTerm = OCR_VENUE_TERMS.test(normalizedLine);
  const hasGenericFoodWords = OCR_GENERIC_FOOD_WORDS.test(normalizedLine);
  if (!hasVenueTerm && !hasGenericFoodWords) return null;

  const tokens = tokenizeOcrLine(normalizedLine);
  const alphaTokenCount = countAlphabeticTokens(tokens);
  if (alphaTokenCount < 2) return null;

  const parts = normalizedLine.split(",").map((item) => item.trim()).filter(Boolean);
  const locality = extractLocalityFromParts(parts) || extractLocalityFromTokens(tokens);
  const properNameTokenCount = getProperNameTokenCount(tokens);
  const uppercaseTokens = countUppercaseTokens(tokens);
  const hasConnector = OCR_CONTEXT_CONNECTORS.test(normalizedLine);
  const sloganLike = OCR_SLOGAN_PATTERNS.test(normalizedLine);
  const genericFoodOnly = hasGenericFoodWords && !hasVenueTerm;
  const name = buildCandidateNameFromLine(normalizedLine, tokens);
  if (!name || name.length < 3) return null;

  let score = 0;
  if (hasVenueTerm) score += 8;
  if (genericFoodOnly) score -= 6;
  if (properNameTokenCount >= 2) score += 5;
  else if (properNameTokenCount === 1) score += 2;
  if (locality) score += 5;
  if (hasConnector) score += 3;
  if (supportCount > 1) score += Math.min(4, supportCount * 2);
  if (uppercaseTokens >= Math.ceil(Math.max(alphaTokenCount, 1) * 0.6)) score -= 4;
  if (sloganLike) score -= 8;
  if (name.length > 42) score -= 2;

  const confidence =
    locality && hasVenueTerm && properNameTokenCount >= 1
      ? "high"
      : hasVenueTerm || supportCount > 1
        ? "medium"
        : "low";

  return {
    score,
    name,
    locality,
    confidence,
  };
}

export function inferOcrHeuristicCandidate(source: ExtractionResult): OcrHeuristicCandidate | null {
  const ocrText = String(source.ocr?.text || "").trim();
  if (!ocrText) return null;
  const lines = ocrText
    .split(/\r?\n/)
    .map((line) => normalizeOcrLine(line))
    .filter(Boolean);

  const supportByLine = new Map<string, number>();
  for (const line of lines) {
    const key = buildSupportKey(line);
    if (!key) continue;
    supportByLine.set(key, (supportByLine.get(key) || 0) + 1);
  }

  let bestCandidate: (OcrHeuristicCandidate & { score: number }) | null = null;
  for (const line of lines) {
    const supportCount = supportByLine.get(buildSupportKey(line)) || 1;
    const ranked = scoreOcrVenueCandidate(line, supportCount);
    if (!ranked) continue;
    const candidate = {
      name: ranked.name || "",
      locality: ranked.locality,
      category: "eat" as const,
      confidence: ranked.confidence,
      evidenceText: `OCR candidate: ${line}`,
      score: ranked.score,
    };
    if (!candidate.name || candidate.score <= 0) continue;
    if (!bestCandidate || candidate.score > bestCandidate.score) {
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate) return null;
  return {
    name: bestCandidate.name,
    locality: bestCandidate.locality,
    category: bestCandidate.category,
    confidence: bestCandidate.confidence,
    evidenceText: bestCandidate.evidenceText,
  };
}

function inferName(source: ExtractionResult): string {
  const title = decodeEntities(String(source.metadata?.title || "").trim());
  if (title && title.toLowerCase() !== "untitled" && !titleLooksLikeSocialBoilerplate(title)) return title.slice(0, 80);
  const description = decodeEntities(String(source.metadata?.description || ""));
  const firstLine = description.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "";
  if (firstLine) {
    const cleaned = firstLine.replace(/^location\s*:\s*/i, "").trim();
    const scenicName = cleaned.match(/^([A-Z][A-Za-z0-9&' -]{2,60}?)(?:\s+is\b|\s+-\s+|\s+offers\b|\s+has\b)/)?.[1]?.trim();
    if (scenicName) return scenicName.slice(0, 80);
    if (cleaned && !titleLooksLikeSocialBoilerplate(cleaned)) return cleaned.slice(0, 80);
  }
  const hashtags = extractHashtags(description);
  const scenicTag = hashtags.find((tag) => !GENERIC_HASHTAG_BLACKLIST.has(tag.toLowerCase()) && /(hill|hills|fort|falls|waterfall|lake|beach|temple|park|palace|museum|garden|viewpoint)/i.test(tag));
  if (scenicTag) {
    const normalized = normalizeHashtagLabel(scenicTag);
    if (normalized) return normalized.slice(0, 80);
  }
  return "Detected place";
}

function hasMeaningfulText(input: string | null | undefined, minChars = 12): boolean {
  return String(input || "").trim().length >= minChars;
}

function hasNonGenericMetadataCandidate(source: ExtractionResult): boolean {
  const title = decodeEntities(String(source.metadata?.title || "").trim());
  if (title && title.toLowerCase() !== "untitled" && !titleLooksLikeSocialBoilerplate(title)) {
    return true;
  }

  const description = decodeEntities(String(source.metadata?.description || ""));
  const firstLine = description.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "";
  if (!firstLine) return false;
  if (firstLine.length < 4) return false;
  if (!/[A-Za-z]{3,}/.test(firstLine)) return false;
  if (titleLooksLikeSocialBoilerplate(firstLine)) return false;
  return true;
}

export function buildDraftIntelligenceOutput(source: ExtractionResult): IntelligenceOutput {
  const ocrCandidate = inferOcrHeuristicCandidate(source);
  const ocrAttemptedWithoutCandidate = Boolean(source.ocr?.attempted) && !ocrCandidate;
  const transcriptHasEntitySignal = hasMeaningfulText(source.transcript?.text);
  const metadataHasEntitySignal = hasNonGenericMetadataCandidate(source);
  const joinedText = [
    source.metadata?.title || "",
    source.metadata?.description || "",
    source.transcript?.text || "",
    source.ocr?.text || "",
  ].join(" ");

  const inferredName = inferName(source);
  const shouldSuppressGenericEntity =
    ocrAttemptedWithoutCandidate &&
    !transcriptHasEntitySignal &&
    !metadataHasEntitySignal;

  const category = ocrCandidate?.category || inferCategory(joinedText);
  const name = shouldSuppressGenericEntity ? "Detected place" : (ocrCandidate?.name || inferredName);
  const localityCandidate = decodeEntities(String(source.metadata?.description || ""))
    .split(",")
    .map((s) => s.trim())
    .find((s) => /road|city|nagar|karnataka|bihar|india|mangalore|patna/i.test(s)) || null;
  const locality = ocrCandidate?.locality || (localityCandidate && localityCandidate.length <= 60 ? localityCandidate : null);
  const intent =
    category === "eat"
      ? { l1: "taste" as const, l2: /cafe|café|coffee/i.test(joinedText) ? "Cafe" : "Restaurant", l3: [] }
      : category === "do"
        ? { l1: "activity" as const, l2: "Event", l3: [] }
        : category === "stay"
          ? { l1: "stay" as const, l2: /hostel/i.test(joinedText) ? "Hostel" : "Hotel", l3: [] }
          : { l1: "explore" as const, l2: /waterfall|falls/i.test(joinedText) ? "Waterfall" : "Nature", l3: [] };

  return {
    source: {
      url: source.metadata?.canonicalUrl || source.metadata?.sourceUrl || null,
      platform: source.metadata?.platform === "youtube"
        ? "youtube"
        : source.metadata?.platform === "instagram"
          ? "instagram"
          : "website",
      title: source.metadata?.title || null,
      creator: null,
      sourceType: "mixed_discovery",
    },
    placeCollections: [],
    categoriesPresent: [category],
    weakMentions: [],
    showIn: {
      eat: category === "eat",
      do: category === "do",
      stay: category === "stay",
      see: category === "see",
    },
    structuredEntities: [
      {
        name,
        category,
        locality,
        city: null,
        state: null,
        country: "India",
        address: null,
        confidence: shouldSuppressGenericEntity ? "low" : (ocrCandidate?.confidence || "low"),
        googleMapsQuery: [name, locality].filter(Boolean).join(" ").trim() || name,
        evidenceText: shouldSuppressGenericEntity
          ? "OCR text insufficient"
          : (ocrCandidate?.evidenceText || "Draft heuristic inference from extracted metadata"),
        intent,
      },
    ],
    entities: [
      {
        category,
        name,
        entityType: "place",
        city: null,
        state: null,
        country: "India",
        locality,
        tags: ["draft"],
        details: {},
        level2:
          category === "eat"
            ? { category: "eat", cuisineType: null, mealType: null, dietaryTags: [], vibeTags: [], priceTier: null }
            : category === "do"
              ? { category: "do", activityType: null, timeTag: null, audienceTags: [], vibeTags: [], priceTier: null }
              : category === "stay"
                ? { category: "stay", stayType: null, useCase: null, amenities: [], locationTags: [], priceTier: null }
                : { category: "see", placeType: null, experienceTag: null, vibeTags: [], entryFeeSignal: null },
        googleMapsQuery: [name, locality].filter(Boolean).join(" ").trim() || name,
        sourceEvidence: shouldSuppressGenericEntity
          ? "OCR text insufficient"
          : (ocrCandidate?.evidenceText || "Draft heuristic inference from extracted metadata"),
        confidence: shouldSuppressGenericEntity ? "low" : (ocrCandidate?.confidence || "low"),
        intent,
      },
    ],
    visibility: {
      showIn: [category],
      doNotShowIn: ["eat", "do", "stay", "see"].filter((v) => v !== category),
      reason: shouldSuppressGenericEntity
        ? "OCR text insufficient"
        : ocrCandidate
          ? "Draft response generated from OCR evidence. Async job provides final model output."
          : "Draft response generated for fast UX. Async job provides final model output.",
    },
    status: ocrCandidate ? "ready" : "needs_review",
  };
}
