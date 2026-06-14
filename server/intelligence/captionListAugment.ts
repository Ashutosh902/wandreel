import type { ExtractionResult } from "../extraction/types";
import type {
  CategoryLevel2Metadata,
  DiscoveryEntity,
  EntityIntent,
  IntelligenceOutput,
  IntentL1,
  SupportedCategory,
} from "./types";

type CaptionListEntity = {
  category: SupportedCategory;
  name: string;
  locality: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  googleMapsQuery: string | null;
  evidenceText: string;
  intent: EntityIntent;
  level2: CategoryLevel2Metadata;
  confidence: "low" | "medium";
};

const LIST_HEADER_PATTERNS = [
  /top recommendations?/i,
  /recommendations?/i,
  /cafe details?/i,
  /cafe list/i,
  /best cafes?/i,
  /best places?/i,
  /must try/i,
  /top cafes?/i,
  /food details?/i,
];

const STOP_LINE_PATTERNS = /(don't forget to follow|dont forget to follow|follow @|comment|share|subscribe|link in bio|#fyp|#reels|#viral)/i;
const HANDLE_PATTERN = /@([a-z0-9._]+)/i;
const COMMON_TLD_SUFFIXES = new Set(["in", "com", "co", "org", "io", "og", "app", "shop", "cafe", "club", "net"]);

function decodeEntities(input: string): string {
  return input
    .replace(/&quot;/gi, '"')
    .replace(/&#064;/gi, "@")
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&#x2019;/gi, "’")
    .replace(/&#x2728;/gi, "✨")
    .replace(/&#x1f49b;/gi, "💛")
    .replace(/&#x1f9ff;/gi, "🧿")
    .replace(/&#x1faf6;/gi, "🫶")
    .replace(/&#x1f3fb;/gi, "🏻");
}

function normalizeWhitespace(input: string): string {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function titleCaseHandle(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toLowerCase() : part[0].toUpperCase() + part.slice(1).toLowerCase()))
    .join(" ");
}

function handleToName(handle: string): string {
  const raw = normalizeWhitespace(
    handle
      .replace(/^www\./i, "")
      .replace(/[_-]+/g, " ")
      .replace(/\.+/g, " "),
  );
  if (!raw) return handle;

  const parts = raw.split(" ").filter(Boolean);
  if (parts.length > 1) {
    const last = parts[parts.length - 1]?.toLowerCase();
    if (last && COMMON_TLD_SUFFIXES.has(last)) {
      parts.pop();
    }
  }

  const cleaned = titleCaseHandle(parts.join(" "));
  return cleaned || handle;
}

function normalizeLooseLabel(input: unknown): string {
  return String(input || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function inferIntentL1FromText(text: string): IntentL1 {
  if (/\b(hotel|stay|resort|homestay|hostel|villa|room|suite)\b/i.test(text)) return "stay";
  if (/\b(activity|adventure|cycling|workshop|sports|boating|show|event|music|live music|party)\b/i.test(text)) return "activity";
  if (/\b(hill|hills|viewpoint|sunrise|sunset|nature|scenic|fort|waterfall|falls|lake|beach|temple|palace|monument|park|museum|garden)\b/i.test(text)) return "explore";
  return "taste";
}

function inferL2(category: SupportedCategory, headerText: string, lineText: string): string {
  const text = `${headerText} ${lineText}`.toLowerCase();
  if (category === "eat") {
    if (/\b(cafe|coffee|matcha)\b/.test(text)) return "Cafe";
    if (/\b(bakery|bun|buns|cookie|cookies|bread|pastry)\b/.test(text)) return "Bakery";
    if (/\b(brunch|breakfast|morning)\b/.test(text)) return "Breakfast";
    if (/\b(ice cream|gelato|dessert|sweet)\b/.test(text)) return "Dessert";
    if (/\b(bar|cocktail|drinks|brew)\b/.test(text)) return "Bar";
    if (/\b(food market|market)\b/.test(text)) return "Food Market";
    if (/\b(street food|stall)\b/.test(text)) return "Street Food";
    return "Restaurant";
  }
  if (category === "activity") {
    if (/\b(workshop|class)\b/.test(text)) return "Workshop";
    if (/\b(comedy|standup)\b/.test(text)) return "Comedy";
    if (/\b(night out|nightlife|club|party)\b/.test(text)) return "Night Out";
    if (/\b(shopping|mall|bazaar)\b/.test(text)) return "Shopping";
    if (/\b(wellness|spa|yoga|massage)\b/.test(text)) return "Wellness";
    if (/\b(sports|cricket|football|badminton|arena|karting)\b/.test(text)) return "Sports";
    if (/\b(water activity|kayak|kayaking|boating|boat|paddle|jet ski)\b/.test(text)) return "Water Activity";
    if (/\b(family|kids|children)\b/.test(text)) return "Family Activity";
    return "Event";
  }
  if (category === "stay") {
    if (/\bresort\b/.test(text)) return "Resort";
    if (/\bhostel\b/.test(text)) return "Hostel";
    if (/\bhomestay|guest house\b/.test(text)) return "Homestay";
    if (/\bvilla\b/.test(text)) return "Villa";
    if (/\bdorm\b/.test(text)) return "Dorm Stay";
    if (/\bworkation|workspace|remote work\b/.test(text)) return "Workation";
    if (/\bluxury|premium\b/.test(text)) return "Luxury Stay";
    if (/\bbudget|affordable\b/.test(text)) return "Budget Stay";
    if (/\bpet friendly|pet stay\b/.test(text)) return "Pet Stay";
    return "Hotel";
  }
  if (/\bwaterfall|falls\b/.test(text)) return "Waterfall";
  if (/\bviewpoint|view point|sunrise point|sunset point\b/.test(text)) return "Viewpoint";
  if (/\bmuseum\b/.test(text)) return "Museum";
  if (/\bmonument|memorial|statue\b/.test(text)) return "Monument";
  if (/\bspiritual|temple|church|mosque|shrine\b/.test(text)) return "Spiritual";
  if (/\bpark|garden\b/.test(text)) return "Park";
  if (/\bbeach|shore\b/.test(text)) return "Beach";
  if (/\blocal market|bazaar|market\b/.test(text)) return "Local Market";
  if (/\bheritage|fort|palace|historic|history\b/.test(text)) return "Heritage";
  return "Nature";
}

function inferL3Fragments(lineText: string): string[] {
  const cleaned = normalizeWhitespace(
    lineText
      .replace(/^for\s+/i, "")
      .replace(/^with\s+/i, "")
      .replace(/^loved\s+/i, "")
      .replace(/^love\s+/i, "")
      .replace(/^serving\s+/i, "")
      .replace(/^serves\s+/i, "")
      .replace(/^their\s+/i, "")
      .replace(/^the\s+/i, ""),
  );
  if (!cleaned) return [];

  return cleaned
    .split(/\s*(?:,|\/|&| and )\s*/i)
    .map((part) => normalizeWhitespace(part))
    .filter((part) => part.length > 0 && part.split(" ").length <= 4)
    .slice(0, 3);
}

function buildLevel2(category: SupportedCategory, headerText: string, lineText: string): CategoryLevel2Metadata {
  const line = `${headerText} ${lineText}`.toLowerCase();
  if (category === "eat") {
    return {
      category,
      cuisineType: /\bjapanese\b/.test(line) ? "Japanese" : null,
      mealType: /\bbreakfast|brunch|morning\b/.test(line) ? "Breakfast" : null,
      dietaryTags: /\bveg|vegetarian|vegan|eggless|jain\b/.test(line) ? ["Vegetarian"] : [],
      vibeTags: /\bcafe|coffee|matcha\b/.test(line) ? ["Cafe"] : [],
      priceTier: null,
    };
  }
  if (category === "activity") {
    return {
      category,
      activityType: null,
      timeTag: /\bmorning|evening|night\b/.test(line) ? "Morning" : null,
      audienceTags: [],
      vibeTags: [],
      priceTier: null,
    };
  }
  if (category === "stay") {
    return {
      category,
      stayType: null,
      useCase: null,
      amenities: [],
      locationTags: [],
      priceTier: null,
    };
  }
  return {
    category,
    placeType: null,
    experienceTag: null,
    vibeTags: [],
    entryFeeSignal: null,
  };
}

function inferCategory(headerText: string, lineText: string): SupportedCategory {
  const text = `${headerText} ${lineText}`.toLowerCase();
  if (/\b(hotel|stay|resort|homestay|hostel|villa|room|suite)\b/.test(text)) return "stay";
  if (/\b(activity|adventure|cycling|workshop|sports|boating|show|event|music|live music|party)\b/.test(text)) return "do";
  if (/\b(hill|hills|viewpoint|sunrise|sunset|nature|scenic|fort|waterfall|falls|lake|beach|temple|palace|monument|park|museum|garden)\b/.test(text)) return "see";
  return "eat";
}

function buildCandidate(headerText: string, lineText: string, handle: string): CaptionListEntity {
  const category = inferCategory(headerText, lineText);
  const name = handleToName(handle);
  const intentL1 = inferIntentL1FromText(`${headerText} ${lineText}`);
  const l2 = inferL2(category, headerText, lineText);
  const evidenceText = normalizeWhitespace(lineText);
  return {
    category,
    name,
    locality: null,
    city: null,
    state: null,
    country: null,
    googleMapsQuery: normalizeWhitespace([name, lineText].filter(Boolean).join(" ")),
    evidenceText,
    intent: {
      l1: intentL1,
      l2,
      l3: inferL3Fragments(lineText),
    },
    level2: buildLevel2(category, headerText, lineText),
    confidence: lineText && lineText !== handle ? "medium" : "low",
  };
}

function isHeaderLine(line: string) {
  return LIST_HEADER_PATTERNS.some((pattern) => pattern.test(line));
}

function extractListCandidateLines(text: string): Array<{ header: string; line: string; handle: string }> {
  const lines = decodeEntities(text)
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const candidates: Array<{ header: string; line: string; handle: string }> = [];
  let activeHeader: string | null = null;
  let seenListItem = false;

  for (const line of lines) {
    if (STOP_LINE_PATTERNS.test(line)) {
      if (seenListItem) break;
      continue;
    }

    if (isHeaderLine(line)) {
      activeHeader = line;
      seenListItem = false;
      continue;
    }

    if (!activeHeader) continue;

    const handleMatch = line.match(HANDLE_PATTERN);
    if (!handleMatch) {
      if (seenListItem) break;
      continue;
    }

    candidates.push({
      header: activeHeader,
      line,
      handle: handleMatch[1] || "",
    });
    seenListItem = true;
  }

  return candidates.filter((item) => item.handle.length > 0);
}

function isDuplicate(existingNames: Set<string>, candidate: CaptionListEntity) {
  const key = `${candidate.category}|${candidate.name.toLowerCase()}`;
  if (existingNames.has(key)) return true;
  existingNames.add(key);
  return false;
}

export function extractCaptionListEntities(source: ExtractionResult, existingNames: Set<string> = new Set()): CaptionListEntity[] {
  const text = [
    source.metadata?.title || "",
    source.metadata?.description || "",
    source.transcript?.text || "",
    source.ocr?.text || "",
  ]
    .filter(Boolean)
    .join("\n");

  const candidates = extractListCandidateLines(text).map((item) => buildCandidate(item.header, item.line, item.handle));
  return candidates.filter((candidate) => !isDuplicate(existingNames, candidate));
}

export function augmentIntelligenceOutputWithCaptionLists(
  output: IntelligenceOutput,
  source: ExtractionResult,
): IntelligenceOutput {
  if (output.structuredEntities.length > 1) return output;

  const existingNames = new Set(output.entities.map((entity) => `${entity.category}|${entity.name.toLowerCase()}`));
  const extraCandidates = extractCaptionListEntities(source, existingNames);
  if (!extraCandidates.length) return output;

  const extraEntities: DiscoveryEntity[] = extraCandidates.map((candidate) => ({
    category: candidate.category,
    name: candidate.name,
    entityType: "caption_list_item",
    city: candidate.city,
    state: candidate.state,
    country: candidate.country,
    locality: candidate.locality,
    tags: candidate.level2.category === "eat"
      ? candidate.level2.vibeTags
      : candidate.level2.category === "do"
        ? candidate.level2.vibeTags
        : candidate.level2.category === "stay"
          ? candidate.level2.locationTags
          : candidate.level2.vibeTags,
    details: {
      source: "caption_list",
      header: candidate.evidenceText,
    },
    level2: candidate.level2,
    googleMapsQuery: candidate.googleMapsQuery,
    sourceEvidence: candidate.evidenceText,
    confidence: candidate.confidence,
    intent: candidate.intent,
  }));

  const extraStructured = extraCandidates.map((candidate) => ({
    name: candidate.name,
    category: candidate.category,
    locality: candidate.locality,
    city: candidate.city,
    state: candidate.state,
    country: candidate.country,
    address: null,
    confidence: candidate.confidence,
    googleMapsQuery: candidate.googleMapsQuery,
    evidenceText: candidate.evidenceText,
    intent: candidate.intent,
  }));

  const categoriesPresent = Array.from(new Set([...output.categoriesPresent, ...extraCandidates.map((candidate) => candidate.category)]));
  return {
    ...output,
    categoriesPresent,
    showIn: {
      eat: categoriesPresent.includes("eat"),
      do: categoriesPresent.includes("do"),
      stay: categoriesPresent.includes("stay"),
      see: categoriesPresent.includes("see"),
    },
    structuredEntities: [...output.structuredEntities, ...extraStructured],
    entities: [...output.entities, ...extraEntities],
    visibility: {
      ...output.visibility,
      showIn: Array.from(new Set([...output.visibility.showIn, ...extraCandidates.map((candidate) => candidate.category)])),
      doNotShowIn: output.visibility.doNotShowIn.filter((entry) => !extraCandidates.some((candidate) => entry === candidate.category)),
      reason: `${output.visibility.reason || "Derived from extracted entities."} Caption list augmentation applied.`,
    },
    status: output.status === "no_supported_entity_found" ? "ready" : output.status,
  };
}
