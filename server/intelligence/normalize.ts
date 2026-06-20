import type { CategoryLevel2Metadata, EntityConfidence, EntityIntent, IntelligenceOutput, IntentL1, SupportedCategory } from "./types";

const CATEGORY_ALIAS: Record<string, SupportedCategory> = {
  eat: "eat",
  food: "eat",
  restaurant: "eat",
  restaurants: "eat",
  dining: "eat",
  do: "do",
  activity: "do",
  activities: "do",
  experience: "do",
  experiences: "do",
  stay: "stay",
  hotel: "stay",
  hotels: "stay",
  hostel: "stay",
  resort: "stay",
  see: "see",
  visit: "see",
  sightseeing: "see",
  attraction: "see",
  attractions: "see",
};

const ALL_CATEGORIES: SupportedCategory[] = ["eat", "do", "stay", "see"];
export const CATEGORY_TO_INTENT_L1: Record<SupportedCategory, IntentL1> = {
  eat: "taste",
  do: "activity",
  stay: "stay",
  see: "explore",
};
export const INTENT_L2_OPTIONS: Record<IntentL1, string[]> = {
  taste: ["Cafe", "Restaurant", "Bar", "Dessert", "Street Food", "Fine Dining", "Breakfast", "Bakery", "Sweets", "Food Market"],
  activity: ["Adventure", "Workshop", "Comedy", "Night Out", "Shopping", "Wellness", "Sports", "Water Activity", "Event", "Family Activity"],
  stay: ["Hotel", "Resort", "Hostel", "Homestay", "Villa", "Dorm Stay", "Workation", "Luxury Stay", "Budget Stay", "Pet Stay"],
  explore: ["Nature", "Heritage", "Waterfall", "Viewpoint", "Museum", "Monument", "Spiritual", "Park", "Beach", "Local Market"],
};
export const INTENT_L2_DEFAULTS: Record<IntentL1, string> = {
  taste: "Restaurant",
  activity: "Event",
  stay: "Hotel",
  explore: "Nature",
};
export const GENERIC_INTENT_L3_BLOCKLIST = new Set([
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

const EAT_VIBE_MAP: Record<string, string> = {
  trending: "Trending",
  visited: "Visited",
  "date night": "Date-night",
  datenight: "Date-night",
  budget: "Budget",
  "street style": "Street-style",
  streetstyle: "Street-style",
  iconic: "Iconic",
  veg: "Veg-only",
  "veg only": "Veg-only",
  vegetarian: "Veg-only",
  cafe: "Cafe",
};

const DO_VIBE_MAP: Record<string, string> = {
  trending: "Trending",
  visited: "Visited",
  weekend: "Weekend",
  outdoor: "Outdoor",
  adventure: "Adventure",
  family: "Family",
  comedy: "Comedy",
  workshop: "Workshop",
  free: "Free",
  "hidden gem": "Hidden gem",
};

const STAY_VIBE_MAP: Record<string, string> = {
  saved: "Saved",
  visited: "Visited",
  budget: "Budget",
  premium: "Premium",
  "couple friendly": "Couple-friendly",
  workation: "Workation",
  pool: "Pool",
  dorm: "Dorm",
  family: "Family",
};

const SEE_VIBE_MAP: Record<string, string> = {
  trending: "Trending",
  visited: "Visited",
  heritage: "Heritage",
  nature: "Nature",
  "photo spots": "Photo spots",
  "hidden gem": "Hidden gem",
  spiritual: "Spiritual",
  iconic: "Iconic",
  free: "Free",
};

function asCategory(input: unknown): SupportedCategory | null {
  const key = String(input || "").trim().toLowerCase();
  return CATEGORY_ALIAS[key] || null;
}

function toConfidence(input: unknown): EntityConfidence {
  const text = String(input || "").trim().toLowerCase();
  if (text === "high" || text === "medium" || text === "low") return text;
  const value = Number(input);
  if (!Number.isFinite(value)) return "low";
  if (value >= 0.75) return "high";
  if (value >= 0.45) return "medium";
  return "low";
}

function toNumericConfidence(input: unknown): number {
  const text = String(input || "").trim().toLowerCase();
  if (text === "high") return 0.9;
  if (text === "medium") return 0.6;
  if (text === "low") return 0.3;
  const value = Number(input);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeLabel(input: unknown): string | null {
  const value = String(input || "").trim();
  return value || null;
}

function normalizeLooseLabel(input: unknown): string {
  return String(input || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export type EntityNameSanitizeEvent = {
  finalEntitySanitized: true;
  finalEntitySanitizeReason: "instagram_metadata_boilerplate";
  rejectedEntityNamePreview: string;
  replacementName: "Detected place";
};

const MONTH_PATTERN = "january|february|march|april|may|june|july|august|september|october|november|december";

export function isInstagramMetadataBoilerplateName(input: unknown): boolean {
  const raw = String(input || "").trim();
  if (!raw) return false;
  const normalized = raw.toLowerCase();
  const commaCount = (raw.match(/,/g) || []).length;
  const htmlEntityCount = (raw.match(/&[a-z#0-9]+;/gi) || []).length;

  if (/\blikes?\b/.test(normalized)) return true;
  if (/\bcomments?\b/.test(normalized)) return true;
  if (/\bview all comments\b/.test(normalized)) return true;
  if (/\badd a comment\b/.test(normalized)) return true;
  if (/\bfollow\b/.test(normalized)) return true;
  if (/\binstagram\b/.test(normalized)) return true;
  if (/&quot;|&#0*39;|&amp;|&#064;|&[a-z#0-9]+;/i.test(raw) && htmlEntityCount >= 1) return true;
  if (new RegExp(`\\bon\\s+(${MONTH_PATTERN})\\b`, "i").test(normalized)) return true;
  if (new RegExp(`\\b[a-z0-9._]{3,}\\s+on\\s+(${MONTH_PATTERN})\\b`, "i").test(normalized)) return true;
  if (/^\s*[\d,]+\b/.test(raw)) return true;
  if (/#\w+/.test(raw)) return true;
  if (/\blikes?\s*,?\s*\d|\d[\d,]*\s+likes?\b/.test(normalized)) return true;
  if (/\bcomments?\s*,?\s*\d|\d[\d,]*\s+comments?\b/.test(normalized)) return true;
  if (/:\s*["“”']/.test(raw) && new RegExp(`\\bon\\s+(${MONTH_PATTERN})\\b`, "i").test(normalized)) return true;
  if (raw.length > 80 && (commaCount >= 1 || htmlEntityCount >= 1)) return true;
  if (raw.length > 80 && /\b(on|likes?|comments?|instagram|follow)\b/i.test(raw)) return true;

  return false;
}

function previewRejectedName(input: string): string {
  return input.replace(/\s+/g, " ").trim().slice(0, 80);
}

export function sanitizeIntelligenceOutputEntityNames(output: IntelligenceOutput): {
  output: IntelligenceOutput;
  events: EntityNameSanitizeEvent[];
} {
  const events: EntityNameSanitizeEvent[] = [];
  let sanitizedPrimary = false;

  const structuredEntities = output.structuredEntities.map((entity, index) => {
    if (!isInstagramMetadataBoilerplateName(entity.name)) return entity;
    const rejectedEntityNamePreview = previewRejectedName(entity.name);
    events.push({
      finalEntitySanitized: true,
      finalEntitySanitizeReason: "instagram_metadata_boilerplate",
      rejectedEntityNamePreview,
      replacementName: "Detected place",
    });
    if (index === 0) sanitizedPrimary = true;
    return {
      ...entity,
      name: "Detected place",
      confidence: "low" as const,
      googleMapsQuery: buildMapsQuery({
        name: "Detected place",
        locality: entity.locality,
        city: entity.city,
        state: entity.state,
        country: entity.country,
      }),
      evidenceText: entity.evidenceText || "instagram_metadata_boilerplate",
    };
  });

  const entities = output.entities.map((entity, index) => {
    if (!isInstagramMetadataBoilerplateName(entity.name)) return entity;
    if (index === 0) sanitizedPrimary = true;
    return {
      ...entity,
      name: "Detected place",
      confidence: "low" as const,
      googleMapsQuery: buildMapsQuery({
        name: "Detected place",
        locality: entity.locality,
        city: entity.city,
        state: entity.state,
        country: entity.country,
      }),
      sourceEvidence: entity.sourceEvidence || "instagram_metadata_boilerplate",
      details: {
        ...entity.details,
        needsReview: true,
      },
    };
  });

  if (events.length === 0) {
    return { output, events };
  }

  return {
    output: {
      ...output,
      structuredEntities,
      entities,
      status: sanitizedPrimary ? "needs_review" : output.status,
      visibility: sanitizedPrimary
        ? {
            ...output.visibility,
            reason: "instagram_metadata_boilerplate",
          }
        : output.visibility,
    },
    events,
  };
}

function asIntentL1(input: unknown): IntentL1 | null {
  const value = normalizeLooseLabel(input);
  if (value === "taste" || value === "activity" || value === "stay" || value === "explore") return value;
  return null;
}

function normalizeIntentL2(l1: IntentL1, input: unknown): string | null {
  const normalized = normalizeLooseLabel(input);
  if (!normalized) return null;
  return INTENT_L2_OPTIONS[l1].find((option) => normalizeLooseLabel(option) === normalized) || null;
}

function buildMapsQuery(entity: {
  name: string;
  locality: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}): string | null {
  const parts = [entity.name, entity.locality, entity.city, entity.state, entity.country].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

function isWeakFoodOnly(entityType: string, evidence: string): boolean {
  const text = `${entityType} ${evidence}`.toLowerCase();
  return /(local food|delicious food|great food|try food|restaurants in town|best food spots|generic_food)/.test(text);
}

function sanitizeTags(input: unknown): string[] {
  return Array.isArray(input) ? input.map((v) => String(v || "").trim()).filter(Boolean) : [];
}

function sanitizeIntentL3(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const item of input) {
    const label = String(item || "").replace(/\s+/g, " ").trim();
    if (!label) continue;
    const normalized = normalizeLooseLabel(label);
    if (!normalized || GENERIC_INTENT_L3_BLOCKLIST.has(normalized)) continue;
    if (normalized === "saved" || normalized === "visited") continue;
    if (normalized.split(" ").length > 4) continue;
    out.add(label);
    if (out.size >= 3) break;
  }
  return Array.from(out);
}

function collectIntentInferenceText(entity: any, level2: CategoryLevel2Metadata): string {
  const details = entity?.details && typeof entity.details === "object" ? entity.details : {};
  let level2Values: Array<string | null> = [];
  if (level2.category === "eat") {
    level2Values = [level2.cuisineType, level2.mealType];
  } else if (level2.category === "do") {
    level2Values = [level2.activityType, level2.timeTag];
  } else if (level2.category === "stay") {
    level2Values = [level2.stayType, level2.useCase];
  } else {
    level2Values = [level2.placeType, level2.experienceTag];
  }
  return [
    entity?.name,
    entity?.entityType,
    entity?.sourceEvidence,
    entity?.evidenceText,
    entity?.googleMapsQuery,
    ...sanitizeTags(entity?.tags),
    ...Object.values(details),
    ...level2Values,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();
}

function inferIntentL2FromEvidence(l1: IntentL1, entity: any, level2: CategoryLevel2Metadata): string | null {
  const text = collectIntentInferenceText(entity, level2);
  if (!text) return null;

  if (l1 === "taste") {
    if (/\bcafe|café|coffee\b/.test(text)) return "Cafe";
    if (/\bbar|pub|cocktail|drinks|rooftop drinks\b/.test(text)) return "Bar";
    if (/\bdessert|gelato|ice cream|icecream|patisserie\b/.test(text)) return "Dessert";
    if (/\bstreet food|street-style|street style|stall\b/.test(text)) return "Street Food";
    if (/\bfine dining|tasting menu\b/.test(text)) return "Fine Dining";
    if (/\bbreakfast|brunch\b/.test(text)) return "Breakfast";
    if (/\bbakery|bakehouse\b/.test(text)) return "Bakery";
    if (/\bsweets|mithai|sweet shop\b/.test(text)) return "Sweets";
    if (/\bfood market|market\b/.test(text)) return "Food Market";
    if (/\brestaurant|diner|eatery|kitchen|bistro|food\b/.test(text)) return "Restaurant";
    return null;
  }

  if (l1 === "activity") {
    if (/\badventure|zipline|trek|hike|climb|rafting\b/.test(text)) return "Adventure";
    if (/\bworkshop|class|masterclass\b/.test(text)) return "Workshop";
    if (/\bcomedy|standup|stand-up\b/.test(text)) return "Comedy";
    if (/\bnight out|nightlife|club\b/.test(text)) return "Night Out";
    if (/\bshopping|mall|bazaar\b/.test(text)) return "Shopping";
    if (/\bwellness|spa|yoga|massage\b/.test(text)) return "Wellness";
    if (/\bsports|cricket|football|badminton|arena|karting\b/.test(text)) return "Sports";
    if (/\bwater activity|kayak|kayaking|boating|boat|paddle|jet ski\b/.test(text)) return "Water Activity";
    if (/\bfamily activity|kids|children|family\b/.test(text)) return "Family Activity";
    if (/\bevent|concert|festival|show\b/.test(text)) return "Event";
    return null;
  }

  if (l1 === "stay") {
    if (/\bresort\b/.test(text)) return "Resort";
    if (/\bhostel\b/.test(text)) return "Hostel";
    if (/\bhomestay|guest house\b/.test(text)) return "Homestay";
    if (/\bvilla\b/.test(text)) return "Villa";
    if (/\bdorm\b/.test(text)) return "Dorm Stay";
    if (/\bworkation|workspace|remote work\b/.test(text)) return "Workation";
    if (/\bluxury|premium\b/.test(text)) return "Luxury Stay";
    if (/\bbudget|affordable\b/.test(text)) return "Budget Stay";
    if (/\bpet friendly|pet stay\b/.test(text)) return "Pet Stay";
    if (/\bhotel|stay|suite|room\b/.test(text)) return "Hotel";
    return null;
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
  if (/\bnature|lake|forest|trail|hill|hills|scenic|landmark\b/.test(text)) return "Nature";
  return null;
}

export function normalizeEntityIntent(input: { entity: any; category: SupportedCategory; level2: CategoryLevel2Metadata }): EntityIntent {
  const l1 = asIntentL1(input.entity?.intent?.l1) || CATEGORY_TO_INTENT_L1[input.category];
  const validL2 = normalizeIntentL2(l1, input.entity?.intent?.l2);
  const inferredL2 = inferIntentL2FromEvidence(l1, input.entity, input.level2);
  const l2 = validL2 || inferredL2 || INTENT_L2_DEFAULTS[l1];
  const l3 = sanitizeIntentL3(input.entity?.intent?.l3);
  return { l1, l2, l3 };
}

function mapAllowedTags(input: string[], category: SupportedCategory): string[] {
  const mapper =
    category === "eat" ? EAT_VIBE_MAP :
      category === "do" ? DO_VIBE_MAP :
        category === "stay" ? STAY_VIBE_MAP : SEE_VIBE_MAP;
  const out = new Set<string>();
  for (const tag of input) {
    const key = tag.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    const mapped = mapper[key];
    if (mapped) out.add(mapped);
  }
  return Array.from(out);
}

function buildLevel2(category: SupportedCategory, entity: any): CategoryLevel2Metadata {
  const details = entity?.details && typeof entity.details === "object" ? entity.details : {};
  switch (category) {
    case "eat":
      {
      const vibeTags = mapAllowedTags(sanitizeTags(details.vibeTags), category);
      const dietaryTags = sanitizeTags(details.dietaryTags).filter((tag) =>
        /veg|vegetarian|vegan|eggless|jain/i.test(tag),
      );
      return {
        category,
        cuisineType: normalizeLabel(details.cuisineType),
        mealType: normalizeLabel(details.mealType),
        dietaryTags,
        vibeTags,
        priceTier: normalizeLabel(details.priceTier),
      };
      }
    case "do":
      {
      const vibeTags = mapAllowedTags(sanitizeTags(details.vibeTags), category);
      const audienceTags = sanitizeTags(details.audienceTags).filter((tag) =>
        /family|friends|solo|couple|kids/i.test(tag),
      );
      return {
        category,
        activityType: normalizeLabel(details.activityType),
        timeTag: normalizeLabel(details.timeTag),
        audienceTags,
        vibeTags,
        priceTier: normalizeLabel(details.priceTier),
      };
      }
    case "stay":
      {
      const locationTags = mapAllowedTags(sanitizeTags(details.locationTags), category);
      const amenities = sanitizeTags(details.amenities).slice(0, 8);
      return {
        category,
        stayType: normalizeLabel(details.stayType),
        useCase: normalizeLabel(details.useCase),
        amenities,
        locationTags,
        priceTier: normalizeLabel(details.priceTier),
      };
      }
    default:
      {
      const vibeTags = mapAllowedTags(sanitizeTags(details.vibeTags), category);
      return {
        category,
        placeType: normalizeLabel(details.placeType),
        experienceTag: normalizeLabel(details.experienceTag),
        vibeTags,
        entryFeeSignal: normalizeLabel(details.entryFeeSignal),
      };
      }
  }
}

function listTagsFromLevel2(level2: CategoryLevel2Metadata): string[] {
  switch (level2.category) {
    case "eat":
      return level2.vibeTags;
    case "do":
      return level2.vibeTags;
    case "stay":
      return level2.locationTags;
    default:
      return level2.vibeTags;
  }
}

export function normalizeIntelligenceOutput(raw: unknown): IntelligenceOutput {
  const sourceRaw = (raw as any)?.source || {};
  const entitiesRaw = Array.isArray((raw as any)?.entities) ? (raw as any).entities : [];
  const weakMentionsRaw = Array.isArray((raw as any)?.weakMentions) ? (raw as any).weakMentions : [];
  const placeCollectionsRaw = Array.isArray((raw as any)?.placeCollections) ? (raw as any).placeCollections : [];

  let droppedWeakEatEntity = false;
  const entities = entitiesRaw
    .map((entity: any) => {
      const category = asCategory(entity?.category);
      const name = normalizeLabel(entity?.name);
      if (!category || !name) return null;

      const sourceEvidence = normalizeLabel(entity?.sourceEvidence) || "Metadata mention";
      const entityType = normalizeLabel(entity?.entityType) || "place";

      if (category === "eat" && isWeakFoodOnly(entityType, sourceEvidence)) {
        droppedWeakEatEntity = true;
        return null;
      }

      const level2 = buildLevel2(category, entity);
      const intent = normalizeEntityIntent({ entity, category, level2 });
      const out = {
        category,
        name,
        entityType,
        city: normalizeLabel(entity?.city),
        state: normalizeLabel(entity?.state),
        country: normalizeLabel(entity?.country),
        locality: normalizeLabel(entity?.locality),
        tags: listTagsFromLevel2(level2),
        details: entity?.details && typeof entity.details === "object" ? entity.details : {},
        level2,
        googleMapsQuery: normalizeLabel(entity?.googleMapsQuery),
        sourceEvidence,
        confidence: toConfidence(entity?.confidence),
        intent,
      };

      if (!out.googleMapsQuery) {
        out.googleMapsQuery = buildMapsQuery(out);
      }

      return out;
    })
    .filter(Boolean) as IntelligenceOutput["entities"];

  const dedupedEntities = Array.from(
    new Map(
      entities.map((entity) => {
        const key = `${entity.category}|${entity.name.toLowerCase()}|${(entity.city || "").toLowerCase()}`;
        return [key, entity] as const;
      }),
    ).values(),
  );

  const weakMentions: Array<{ text: string; reason: string }> = [];
  for (const mention of weakMentionsRaw) {
    if (mention && typeof mention === "object") {
      const text = normalizeLabel((mention as any).text);
      const reason = normalizeLabel((mention as any).reason);
      if (text && reason) weakMentions.push({ text, reason });
      continue;
    }
    const text = String(mention || "").trim();
    if (text) weakMentions.push({ text, reason: "Generic mention inferred from source text." });
  }

  if (
    droppedWeakEatEntity ||
    (weakMentionsRaw.some((mention: unknown) => /food|restaurant|eat/i.test(String(mention || ""))) && !dedupedEntities.some((e) => e.category === "eat"))
  ) {
    if (!weakMentions.some((w) => /eat|food|restaurant/i.test(w.text))) {
      weakMentions.push({ text: "eat", reason: "Only weak food mention found." });
    }
  }

  const categoriesPresent: SupportedCategory[] = Array.from(new Set(dedupedEntities.map((entity) => entity.category)));

  const placeCollections = placeCollectionsRaw
    .map((item: any) => {
      const name = normalizeLabel(item?.name);
      if (!name) return null;
      const typeRaw = String(item?.type || "unknown").toLowerCase();
      const type = ["city", "locality", "region", "country"].includes(typeRaw) ? (typeRaw as "city" | "locality" | "region" | "country") : "unknown";
      return {
        name,
        type,
        city: normalizeLabel(item?.city),
        state: normalizeLabel(item?.state),
        country: normalizeLabel(item?.country),
        confidence: toNumericConfidence(item?.confidence),
      };
    })
    .filter(Boolean) as IntelligenceOutput["placeCollections"];

  const showIn = new Set<string>();
  const doNotShowIn = new Set<string>();

  categoriesPresent.forEach((category) => showIn.add(category));
  ALL_CATEGORIES.filter((category) => !categoriesPresent.includes(category)).forEach((category) => doNotShowIn.add(category));

  placeCollections.forEach((collection) => {
    showIn.add(collection.name);
    categoriesPresent.forEach((category) => showIn.add(`${collection.name} > ${category}`));
    ALL_CATEGORIES.filter((category) => !categoriesPresent.includes(category)).forEach((category) => doNotShowIn.add(`${collection.name} > ${category}`));
  });

  const status: IntelligenceOutput["status"] = dedupedEntities.length > 0 ? "ready" : "no_supported_entity_found";
  const structuredEntities = dedupedEntities.map((entity) => ({
    name: entity.name,
    category: entity.category,
    locality: entity.locality,
    city: entity.city,
    state: entity.state,
    country: entity.country,
    address: normalizeLabel((entity.details as any)?.address) || null,
    confidence: entity.confidence,
    googleMapsQuery: entity.googleMapsQuery,
    evidenceText: entity.sourceEvidence || null,
    intent: entity.intent,
  }));

  return {
    source: {
      url: normalizeLabel(sourceRaw?.url),
      platform: ["youtube", "instagram", "google_maps", "website"].includes(String(sourceRaw?.platform || "").toLowerCase())
        ? (String(sourceRaw?.platform).toLowerCase() as IntelligenceOutput["source"]["platform"])
        : "unknown",
      title: normalizeLabel(sourceRaw?.title),
      creator: normalizeLabel(sourceRaw?.creator),
      sourceType: [
        "travel_discovery_video",
        "restaurant_recommendation",
        "itinerary",
        "stay_recommendation",
        "activity_recommendation",
        "sightseeing_recommendation",
        "mixed_discovery",
      ].includes(String(sourceRaw?.sourceType || "").toLowerCase())
        ? (String(sourceRaw?.sourceType).toLowerCase() as IntelligenceOutput["source"]["sourceType"])
        : "unknown",
    },
    placeCollections,
    categoriesPresent,
    weakMentions,
    showIn: {
      eat: categoriesPresent.includes("eat"),
      do: categoriesPresent.includes("do"),
      stay: categoriesPresent.includes("stay"),
      see: categoriesPresent.includes("see"),
    },
    structuredEntities,
    entities: dedupedEntities,
    visibility: {
      showIn: Array.from(showIn),
      doNotShowIn: Array.from(doNotShowIn),
      reason: dedupedEntities.length > 0
        ? "Visibility derived from extracted entities and place collections."
        : "No supported entities found from current metadata.",
    },
    status,
  };
}
