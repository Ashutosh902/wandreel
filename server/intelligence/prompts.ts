import type { ExtractionResult } from "../extraction/types";

const MAX_TITLE = 180;
const MAX_DESCRIPTION = 1200;
const MAX_TRANSCRIPT = 3000;
const MAX_OCR = 1200;

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
12. Put a source in showIn based on actual extracted entities only.
13. Never extract recipes or movies.`;
}

export function buildUserPrompt(source: ExtractionResult): string {
  const metadata = source.metadata;
  const transcript = source.transcript?.text || "";
  const ocr = source.ocr?.text || "";

  const payload = {
    url: metadata.canonicalUrl || metadata.sourceUrl,
    platform: metadata.platform,
    title: trimText(metadata.title, MAX_TITLE),
    creator: null,
    description: trimText(metadata.description, MAX_DESCRIPTION),
    transcript: trimText(transcript, MAX_TRANSCRIPT),
    hashtags: [],
    thumbnail: metadata.imageUrl,
    ocrText: trimText(ocr, MAX_OCR),
    extractionMode: source.mode,
  };

  return `Process this extracted metadata for Wandreel. Return valid JSON only.\n\nInput:\n${JSON.stringify(payload, null, 2)}`;
}
