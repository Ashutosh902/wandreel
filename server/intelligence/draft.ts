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
  if (/\b(food|cafe|restaurant|biryani|lunch|dinner|eatery|chai|kitchen|bakery|dessert)\b/.test(t)) return "eat";
  if (/\b(activity|adventure|cycling|workshop|sports|boating|show|event|karting|zipline)\b/.test(t)) return "do";
  if (/\b(park|museum|garden|gardens)\b/.test(t)) return "see";
  return "see";
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

export function buildDraftIntelligenceOutput(source: ExtractionResult): IntelligenceOutput {
  const joinedText = [
    source.metadata?.title || "",
    source.metadata?.description || "",
    source.transcript?.text || "",
    source.ocr?.text || "",
  ].join(" ");

  const category = inferCategory(joinedText);
  const name = inferName(source);
  const localityCandidate = decodeEntities(String(source.metadata?.description || ""))
    .split(",")
    .map((s) => s.trim())
    .find((s) => /road|city|nagar|karnataka|bihar|india|mangalore|patna/i.test(s)) || null;
  const locality = localityCandidate && localityCandidate.length <= 60 ? localityCandidate : null;
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
        confidence: "low",
        googleMapsQuery: [name, locality].filter(Boolean).join(" ").trim() || name,
        evidenceText: "Draft heuristic inference from extracted metadata",
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
        sourceEvidence: "Draft heuristic inference from extracted metadata",
        confidence: "low",
        intent,
      },
    ],
    visibility: {
      showIn: [category],
      doNotShowIn: ["eat", "do", "stay", "see"].filter((v) => v !== category),
      reason: "Draft response generated for fast UX. Async job provides final model output.",
    },
    status: "needs_review",
  };
}
