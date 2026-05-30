import type { ExtractionResult } from "../extraction/types";

const MAX_COMBINED = 5000;

function trimText(input: string | null | undefined, max: number): string {
  const clean = String(input || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.slice(0, max);
}

export function buildSystemPrompt(): string {
  return `You are Wandreel's strict structured extraction engine.

Goal:
Convert saved link metadata into structured real-world discovery entities for the app Wandreel.

Supported categories:
- eat: named restaurants, cafes, food stalls, bakeries, sweets shops, food markets, named food places
- do: activities, experiences, events, amusement parks, water parks, boating, cycling, adventure, workshops
- stay: named hotels, hostels, resorts, homestays, villas, guest houses
- see: tourist attractions, landmarks, museums, monuments, temples, ghats, viewpoints, historical sites, religious places

Return JSON only in this exact shape:
{
  "status": "ready" | "needs_review" | "no_supported_entity_found",
  "entities": [
    {
      "name": string,
      "category": "eat" | "do" | "stay" | "see",
      "locality": string | null,
      "city": string | null,
      "state": string | null,
      "country": string | null,
      "address": string | null,
      "confidence": "high" | "medium" | "low",
      "googleMapsQuery": string | null,
      "evidenceText": string | null,
      "level2": object
    }
  ],
  "weakMentions": [{ "text": string, "reason": string }],
  "placeCollections": [{ "name": string, "type": "city" | "locality" | "region" | "country" | "unknown", "city": string | null, "state": string | null, "country": string | null, "confidence": "high" | "medium" | "low" }],
  "showIn": { "eat": boolean, "do": boolean, "stay": boolean, "see": boolean }
}

Hard rules:
1. A source can belong to multiple categories.
2. Do not choose a primary category.
3. Each extracted entity must have exactly one category.
4. Do not create entities from vague/general mentions.
5. Generic food mentions should go into weakMentions, not entities.
6. Never invent missing data.
7. Use null where data is unknown.
8. Return JSON only.
9. If no supported entity is found, return status = "no_supported_entity_found".
10. Create placeCollections from detected city/locality/region.
11. Generate googleMapsQuery using entity name + locality + city + state + country when available.
12. Set showIn booleans based on actual extracted entities only.
13. Never extract recipes or movies.
14. For each entity, include level2 fields based on category:
    - eat: cuisineType, mealType, dietaryTags[], vibeTags[], priceTier
    - do: activityType, timeTag, audienceTags[], vibeTags[], priceTier
    - stay: stayType, useCase, amenities[], locationTags[], priceTier
    - see: placeType, experienceTag, vibeTags[], entryFeeSignal
15. Only use conservative values from text evidence. Use null or [] when unknown.
16. Keep tags aligned to user-facing filters where possible:
    - eat vibes: Trending, Visited, Date-night, Budget, Street-style, Iconic, Veg-only, Cafe
    - do vibes: Trending, Visited, Weekend, Outdoor, Adventure, Family, Comedy, Workshop, Free, Hidden gem
    - stay vibes: Saved, Visited, Budget, Premium, Couple-friendly, Workation, Pool, Dorm, Family
    - see vibes: Trending, Visited, Heritage, Nature, Photo spots, Hidden gem, Spiritual, Iconic, Free`;
}

export function buildUserPrompt(source: ExtractionResult): string {
  const metadata = source.metadata;
  const combinedText = source.combinedTextClean || source.combinedTextRaw || "";

  const payload = {
    url: metadata.canonicalUrl || metadata.sourceUrl,
    platform: metadata.platform,
    combinedTextClean: trimText(combinedText, MAX_COMBINED),
    extractionMode: source.mode,
    quality: {
      isLowSignal: !String(combinedText || "").trim(),
    },
  };

  return `Process this extracted combined text for Wandreel. Return valid JSON only.\n\nInput:\n${JSON.stringify(payload, null, 2)}`;
}
