import type { ExtractionResult } from "../extraction/types";
import type { IntelligenceOutput, SupportedCategory } from "./types";

function inferCategory(text: string): SupportedCategory {
  const t = text.toLowerCase();
  if (/(food|cafe|restaurant|biryani|lunch|dinner|eat|chai|kitchen)/.test(t)) return "eat";
  if (/(hotel|stay|resort|homestay|hostel|room)/.test(t)) return "stay";
  if (/(park|museum|activity|adventure|cycling|workshop|sports|do)/.test(t)) return "do";
  return "see";
}

function inferName(source: ExtractionResult): string {
  const title = String(source.metadata?.title || "").trim();
  if (title && title.toLowerCase() !== "untitled") return title.slice(0, 80);
  const description = String(source.metadata?.description || "");
  const firstLine = description.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "";
  if (firstLine) {
    const cleaned = firstLine.replace(/^location\s*:\s*/i, "").trim();
    if (cleaned) return cleaned.slice(0, 80);
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
  const locality = (source.metadata?.description || "")
    .split(",")
    .map((s) => s.trim())
    .find((s) => /road|city|nagar|karnataka|bihar|india|mangalore|patna/i.test(s)) || null;

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
