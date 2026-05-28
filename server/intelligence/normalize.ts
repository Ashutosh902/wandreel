import type { IntelligenceOutput, SupportedCategory } from "./types";

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

function asCategory(input: unknown): SupportedCategory | null {
  const key = String(input || "").trim().toLowerCase();
  return CATEGORY_ALIAS[key] || null;
}

function clampConfidence(input: unknown): number {
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

      const out = {
        category,
        name,
        entityType,
        city: normalizeLabel(entity?.city),
        state: normalizeLabel(entity?.state),
        country: normalizeLabel(entity?.country),
        locality: normalizeLabel(entity?.locality),
        tags: Array.isArray(entity?.tags) ? entity.tags.map((tag: unknown) => String(tag)).filter(Boolean) : [],
        details: entity?.details && typeof entity.details === "object" ? entity.details : {},
        googleMapsQuery: normalizeLabel(entity?.googleMapsQuery),
        sourceEvidence,
        confidence: clampConfidence(entity?.confidence),
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

  const weakMentions: SupportedCategory[] = Array.from(
    new Set(
      weakMentionsRaw
        .map((mention: unknown) => asCategory(mention))
        .filter((mention: SupportedCategory | null): mention is SupportedCategory => Boolean(mention)),
    ),
  );

  if (
    droppedWeakEatEntity ||
    (weakMentionsRaw.some((mention: unknown) => /food|restaurant|eat/i.test(String(mention || ""))) && !dedupedEntities.some((e) => e.category === "eat"))
  ) {
    if (!weakMentions.includes("eat")) weakMentions.push("eat");
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
        confidence: clampConfidence(item?.confidence),
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
