import type { CategoryLevel2Metadata, EntityConfidence, IntelligenceOutput, SupportedCategory } from "./types";

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
