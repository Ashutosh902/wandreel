import type { CategoryLabel } from "./home.data";

export const INTENT_L1_VALUES = ["taste", "activity", "stay", "explore"] as const;
export type IntentL1 = (typeof INTENT_L1_VALUES)[number];
export type EntityIntent = {
  l1: IntentL1;
  l2: string;
  l3: string[];
};

export const CATEGORY_TO_INTENT_L1: Record<CategoryLabel, IntentL1> = {
  Taste: "taste",
  Activity: "activity",
  Stay: "stay",
  Explore: "explore",
};

export const INTENT_L2_OPTIONS: Record<IntentL1, string[]> = {
  taste: ["Cafe", "Restaurant", "Bar", "Dessert", "Street Food", "Fine Dining", "Breakfast", "Bakery", "Sweets", "Food Market"],
  activity: ["Adventure", "Workshop", "Comedy", "Night Out", "Shopping", "Wellness", "Sports", "Water Activity", "Event", "Family Activity"],
  stay: ["Hotel", "Resort", "Hostel", "Homestay", "Villa", "Dorm Stay", "Workation", "Luxury Stay", "Budget Stay", "Pet Stay"],
  explore: ["Nature", "Heritage", "Waterfall", "Viewpoint", "Museum", "Monument", "Spiritual", "Park", "Beach", "Local Market"],
};

const INTENT_L2_DEFAULTS: Record<IntentL1, string> = {
  taste: "Restaurant",
  activity: "Event",
  stay: "Hotel",
  explore: "Nature",
};

const GENERIC_L3_BLOCKLIST = new Set([
  "nice place",
  "good place",
  "good view",
  "nice view",
  "travel spot",
  "food place",
  "place",
  "location",
  "tourist place",
  "viral place",
  "saved",
  "visited",
]);

const CATEGORY_GENERIC_FALLBACKS: Record<CategoryLabel, string> = {
  Taste: "Place",
  Activity: "Experience",
  Stay: "Stay",
  Explore: "Spot",
};

function normalizeLooseLabel(input: unknown): string {
  return String(input || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeIntentL2(l1: IntentL1, input: unknown): string | null {
  const normalized = normalizeLooseLabel(input);
  if (!normalized) return null;
  return INTENT_L2_OPTIONS[l1].find((option) => normalizeLooseLabel(option) === normalized) || null;
}

function sanitizeIntentL3(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const item of input) {
    const label = String(item || "").replace(/\s+/g, " ").trim();
    if (!label) continue;
    const normalized = normalizeLooseLabel(label);
    if (!normalized || GENERIC_L3_BLOCKLIST.has(normalized)) continue;
    if (normalized.split(" ").length > 4) continue;
    out.add(label);
    if (out.size >= 3) break;
  }
  return Array.from(out);
}

function inferIntentL2FromText(l1: IntentL1, text: string): string | null {
  if (!text) return null;
  if (l1 === "taste") {
    if (/\bcafe|cafÃ©|coffee\b/i.test(text)) return "Cafe";
    if (/\bbar|pub|cocktail|drinks\b/i.test(text)) return "Bar";
    if (/\bdessert|gelato|ice cream|sundae\b/i.test(text)) return "Dessert";
    if (/\bstreet food|stall\b/i.test(text)) return "Street Food";
    if (/\bfine dining\b/i.test(text)) return "Fine Dining";
    if (/\bbreakfast|brunch\b/i.test(text)) return "Breakfast";
    if (/\bbakery|bakehouse\b/i.test(text)) return "Bakery";
    if (/\bsweets|mithai|sweet shop\b/i.test(text)) return "Sweets";
    if (/\bfood market|market\b/i.test(text)) return "Food Market";
    if (/\brestaurant|eatery|diner|kitchen|bistro\b/i.test(text)) return "Restaurant";
    return null;
  }
  if (l1 === "activity") {
    if (/\badventure|zipline|hike|rafting\b/i.test(text)) return "Adventure";
    if (/\bworkshop|class\b/i.test(text)) return "Workshop";
    if (/\bcomedy|standup|stand-up\b/i.test(text)) return "Comedy";
    if (/\bnight out|nightlife|club\b/i.test(text)) return "Night Out";
    if (/\bshopping|mall|bazaar\b/i.test(text)) return "Shopping";
    if (/\bwellness|spa|yoga\b/i.test(text)) return "Wellness";
    if (/\bsports|arena|karting|cricket|football|badminton\b/i.test(text)) return "Sports";
    if (/\bwater activity|kayak|kayaking|boating|boat|paddle|jet ski\b/i.test(text)) return "Water Activity";
    if (/\bfamily|kids|children\b/i.test(text)) return "Family Activity";
    if (/\bevent|concert|festival|show\b/i.test(text)) return "Event";
    return null;
  }
  if (l1 === "stay") {
    if (/\bresort\b/i.test(text)) return "Resort";
    if (/\bhostel\b/i.test(text)) return "Hostel";
    if (/\bhomestay|guest house\b/i.test(text)) return "Homestay";
    if (/\bvilla\b/i.test(text)) return "Villa";
    if (/\bdorm\b/i.test(text)) return "Dorm Stay";
    if (/\bworkation|workspace|remote work\b/i.test(text)) return "Workation";
    if (/\bluxury|premium\b/i.test(text)) return "Luxury Stay";
    if (/\bbudget|affordable\b/i.test(text)) return "Budget Stay";
    if (/\bpet friendly|pet stay\b/i.test(text)) return "Pet Stay";
    if (/\bhotel|room|suite|stay\b/i.test(text)) return "Hotel";
    return null;
  }
  if (/\bwaterfall|falls\b/i.test(text)) return "Waterfall";
  if (/\bviewpoint|view point|sunrise point|sunset point\b/i.test(text)) return "Viewpoint";
  if (/\bmuseum\b/i.test(text)) return "Museum";
  if (/\bmonument|memorial|statue\b/i.test(text)) return "Monument";
  if (/\bspiritual|temple|church|mosque|shrine\b/i.test(text)) return "Spiritual";
  if (/\bpark|garden\b/i.test(text)) return "Park";
  if (/\bbeach|shore\b/i.test(text)) return "Beach";
  if (/\blocal market|bazaar|market\b/i.test(text)) return "Local Market";
  if (/\bheritage|fort|palace|historic\b/i.test(text)) return "Heritage";
  if (/\bnature|lake|forest|trail|hill|scenic\b/i.test(text)) return "Nature";
  return null;
}

export function resolveEntityIntent(input: {
  category: CategoryLabel;
  intent?: Partial<EntityIntent> | null;
  title?: string | null;
  metaSecondary?: string | null;
  evidenceText?: string | null;
}): EntityIntent {
  const l1 = CATEGORY_TO_INTENT_L1[input.category];
  const validL2 = normalizeIntentL2(l1, input.intent?.l2);
  const inferredL2 = inferIntentL2FromText(
    l1,
    [input.metaSecondary, input.title, input.evidenceText].filter(Boolean).join(" "),
  );
  const l2 = validL2 || inferredL2 || INTENT_L2_DEFAULTS[l1];
  return {
    l1,
    l2,
    l3: sanitizeIntentL3(input.intent?.l3),
  };
}

export function getIntentLocationLabel(input: { locality?: string | null; city?: string | null }): string {
  return String(input.locality || input.city || "").trim();
}

export function buildIntentSubtitle(input: {
  intent?: EntityIntent | null;
  fallbackSecondary?: string | null;
  locality?: string | null;
  city?: string | null;
  category?: CategoryLabel;
}): { primary: string; secondary: string } {
  const location = getIntentLocationLabel(input);
  const fallbackSecondary = String(input.fallbackSecondary || "").trim();
  const primary = String(input.intent?.l2 || fallbackSecondary || "").trim();
  const firstL3 = String(input.intent?.l3?.[0] || "").trim();
  const secondary =
    firstL3 && location
      ? `${firstL3} · ${location}`
      : location || firstL3 || "";
  return {
    primary: primary || CATEGORY_GENERIC_FALLBACKS[input.category || "Explore"],
    secondary,
  };
}
