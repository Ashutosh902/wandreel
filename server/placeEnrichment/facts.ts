import type { ExtractionResult } from "../extraction/types";
import type { IntelligencePipelineResult } from "../intelligence/types";
import type { PlaceKnowledgeFact, PlaceKnowledgeCategory } from "./types";

type CandidateSentence = {
  text: string;
  sourceSignal: PlaceKnowledgeFact["sourceSignal"];
  confidence: PlaceKnowledgeFact["confidence"];
};

type StructuredKnowledgeMatch = {
  category: PlaceKnowledgeCategory;
  kind: string;
  value: string;
  qualifiers?: Record<string, unknown>;
};

const CATEGORY_RULES: Array<{
  category: PlaceKnowledgeCategory;
  patterns: RegExp[];
}> = [
  { category: "warnings", patterns: [/\bavoid\b/i, /\bcrowd(?:ed)?\b/i, /\bqueue\b/i, /\bwait\b/i, /\bscam\b/i, /\bcareful\b/i] },
  { category: "timing", patterns: [/\bbest time\b/i, /\bmorning\b/i, /\bevening\b/i, /\bsunset\b/i, /\bsunrise\b/i, /\bopen\b/i, /\bhours?\b/i, /\btiming\b/i] },
  { category: "food", patterns: [/\bmust try\b/i, /\border\b/i, /\bdish\b/i, /\bfood\b/i, /\bcafe\b/i, /\brestaurant\b/i, /\bmenu\b/i, /\bcuisine\b/i] },
  { category: "atmosphere", patterns: [/\bvibe\b/i, /\bambience\b/i, /\bcozy\b/i, /\bromantic\b/i, /\blively\b/i, /\bpeaceful\b/i] },
  { category: "accessibility", patterns: [/\bwheelchair\b/i, /\bstairs?\b/i, /\blift\b/i, /\baccessible\b/i, /\bparking\b/i] },
  { category: "transport", patterns: [/\bmetro\b/i, /\bcab\b/i, /\bauto\b/i, /\bbus\b/i, /\bwalk(?:able)?\b/i, /\bparking\b/i] },
  { category: "seasonal_notes", patterns: [/\bmonsoon\b/i, /\bwinter\b/i, /\bsummer\b/i, /\brainy\b/i, /\bseason\b/i] },
  { category: "nearby_places", patterns: [/\bnear\b/i, /\bnext to\b/i, /\bclose to\b/i, /\bnearby\b/i, /\baround\b/i] },
  { category: "shopping", patterns: [/\bmarket\b/i, /\bshop(?:ping)?\b/i, /\bboutique\b/i, /\bmall\b/i] },
  { category: "activities", patterns: [/\bactivity\b/i, /\btrek\b/i, /\bhike\b/i, /\bboating\b/i, /\bswim\b/i, /\bvisit\b/i, /\bexplore\b/i] },
  { category: "recommendations", patterns: [/\brecommend\b/i, /\bmust\b/i, /\bshould\b/i, /\bdon't miss\b/i, /\bfavorite\b/i] },
  { category: "tips", patterns: [/\btip\b/i, /\bpro tip\b/i, /\btry\b/i, /\bbook\b/i, /\bcarry\b/i] },
  { category: "creator_insights", patterns: [/\bi loved\b/i, /\bwe loved\b/i, /\bmy favorite\b/i, /\bi think\b/i, /\bhonestly\b/i] },
  { category: "practical_information", patterns: [/\bentry\b/i, /\bfee\b/i, /\bprice\b/i, /\bcost\b/i, /\baddress\b/i, /\blocation\b/i] },
];

function splitIntoSentences(text: string): string[] {
  return text
    .split(/[\n\r]+|(?<=[.!?])\s+/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 12 && item.length <= 240);
}

function pushSentences(target: CandidateSentence[], text: string, sourceSignal: CandidateSentence["sourceSignal"], confidence: CandidateSentence["confidence"]) {
  for (const sentence of splitIntoSentences(text)) {
    target.push({ text: sentence, sourceSignal, confidence });
  }
}

function normalizeFactText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classifySentence(sentence: CandidateSentence): PlaceKnowledgeCategory[] {
  const matches = CATEGORY_RULES
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(sentence.text)))
    .map((rule) => rule.category);
  return matches.length ? matches : [];
}

function cleanValue(value: string) {
  return value.replace(/\s+/g, " ").replace(/^[,.;:\-\s]+|[,.;:\-\s]+$/g, "").trim();
}

function extractStructuredKnowledge(sentence: CandidateSentence): StructuredKnowledgeMatch[] {
  const text = sentence.text;
  const matches: StructuredKnowledgeMatch[] = [];

  const bestTimeMatch =
    /\b(?:best time to visit is|go around|go before|visit around|visit before)\s+([^.,;]+)/i.exec(text) ||
    /\b(?:around|before)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i.exec(text);
  if (bestTimeMatch) {
    matches.push({
      category: "timing",
      kind: "best_time",
      value: cleanValue(bestTimeMatch[1]),
    });
  }

  const recommendedItemMatch =
    /\b(?:order|must try|try|recommend(?:ed)?(?: the)?)\s+([^.,;]+?)(?:,|\s+(?:for|because|and|but)\b|[.!?]|$)/i.exec(text);
  if (recommendedItemMatch) {
    matches.push({
      category: "food",
      kind: "recommended_item",
      value: cleanValue(recommendedItemMatch[1]),
    });
  }

  const crowdMatch =
    /\bavoid\s+([^.,;]+?)\s+because\s+it\s+gets\s+crowded\b/i.exec(text) ||
    /\b([^.,;]+?)\s+gets\s+crowded\b/i.exec(text) ||
    /\bavoid\s+the\s+crowd\b/i.exec(text);
  if (crowdMatch) {
    const value = crowdMatch[1]
      ? `${cleanValue(crowdMatch[1])} gets crowded`
      : "avoid the crowd";
    matches.push({
      category: "warnings",
      kind: "crowd_note",
      value,
      qualifiers: crowdMatch[1] ? { crowdedAt: cleanValue(crowdMatch[1]) } : undefined,
    });
  }

  const seatingMatch =
    /\b(?:sit|seat yourself|choose)\s+([^.,;]+?)\s+(?:for|to get)\s+([^.,;]+)\b/i.exec(text) ||
    /\b(upstairs|terrace|balcony|window seat)\s+(?:has|gives|offers)\s+([^.,;]+)\b/i.exec(text);
  if (seatingMatch) {
    const seatArea = cleanValue(seatingMatch[1]);
    const benefit = cleanValue(seatingMatch[2]);
    matches.push({
      category: "tips",
      kind: "seating_tip",
      value: seatArea,
      qualifiers: { benefit },
    });
  }

  const parkingMatch = /\bparking\s+(?:is\s+)?(available|limited|not available|unavailable)\b/i.exec(text);
  if (parkingMatch) {
    matches.push({
      category: "accessibility",
      kind: "parking",
      value: cleanValue(parkingMatch[1]),
    });
  }
  const parkingDifficultyMatch = /\bparking\s+(?:is\s+)?(difficult|hard|easy)\s+(?:on|during)\s+([^.,;]+)/i.exec(text);
  if (parkingDifficultyMatch) {
    matches.push({
      category: "accessibility",
      kind: "parking",
      value: cleanValue(parkingDifficultyMatch[1]),
      qualifiers: { when: cleanValue(parkingDifficultyMatch[2]) },
    });
  }

  const pricingMatch =
    /\b(?:price|cost|entry fee|fee)\s+(?:is\s+)?([^.,;]+)/i.exec(text) ||
    /\b(?:mains?|meal|dishes?)\s+(?:are|is)?\s*around\s+((?:rs\.?\s*)?\d[\d,]*)/i.exec(text) ||
    /\baround\s+(rs\.?\s*\d[\d,]*)\b/i.exec(text);
  if (pricingMatch) {
    matches.push({
      category: "practical_information",
      kind: "pricing",
      value: cleanValue(pricingMatch[1]),
    });
  }

  const ambienceMatch = /\b(?:vibe is|ambience is|atmosphere is|feels)\s+([^.,;]+)/i.exec(text);
  if (ambienceMatch) {
    matches.push({
      category: "atmosphere",
      kind: "ambience",
      value: cleanValue(ambienceMatch[1]),
    });
  }

  return matches;
}

export function extractPlaceKnowledgeFacts(input: {
  extraction: ExtractionResult;
  intelligence: IntelligencePipelineResult | null;
}): PlaceKnowledgeFact[] {
  const candidates: CandidateSentence[] = [];
  const metadata = input.extraction.metadata;
  const comments = metadata.commentEvidence;

  pushSentences(candidates, metadata.description || "", "caption", "medium");
  pushSentences(candidates, input.extraction.transcript?.text || "", "transcript", "high");
  pushSentences(candidates, input.extraction.ocr?.text || "", "ocr", "low");
  if (comments?.pinnedComment) pushSentences(candidates, comments.pinnedComment, "comment", "medium");
  for (const comment of comments?.topComments || []) pushSentences(candidates, comment, "comment", "low");
  for (const reply of comments?.creatorReplies || []) pushSentences(candidates, reply, "comment", "medium");

  const selectedCandidate = input.extraction.visualFallback?.selectedCandidate;
  if (selectedCandidate?.candidateName || selectedCandidate?.formattedAddress) {
    candidates.push({
      text: [selectedCandidate.candidateName, selectedCandidate.formattedAddress, selectedCandidate.reason].filter(Boolean).join(" - "),
      sourceSignal: "visual",
      confidence: selectedCandidate.verificationConfidence === "high" ? "high" : "medium",
    });
  }

  for (const entity of input.intelligence?.output?.entities || []) {
    const detailParts = [
      entity.name,
      entity.locality,
      entity.city,
      entity.level2?.category === "eat" ? entity.level2.cuisineType : null,
    ].filter(Boolean);
    if (detailParts.length) {
      candidates.push({
        text: detailParts.join(" - "),
        sourceSignal: "intelligence",
        confidence: entity.confidence,
      });
    }
  }

  const seen = new Set<string>();
  const facts: PlaceKnowledgeFact[] = [];

  for (const candidate of candidates) {
    const normalized = normalizeFactText(candidate.text);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);

    for (const structured of extractStructuredKnowledge(candidate)) {
      facts.push({
        category: structured.category,
        text: candidate.text,
        sourceSignal: candidate.sourceSignal,
        confidence: candidate.confidence,
        confidenceScore: candidate.confidence === "high" ? 0.9 : candidate.confidence === "medium" ? 0.7 : 0.45,
        structured: {
          kind: structured.kind,
          value: structured.value,
          qualifiers: structured.qualifiers ?? {},
        },
        attributes: {
          structuredKind: structured.kind,
          structuredValue: structured.value,
          ...(structured.qualifiers ? { qualifiers: structured.qualifiers } : {}),
        },
      });
    }

    for (const category of classifySentence(candidate)) {
      facts.push({
        category,
        text: candidate.text,
        sourceSignal: candidate.sourceSignal,
        confidence: candidate.confidence,
        confidenceScore: candidate.confidence === "high" ? 0.9 : candidate.confidence === "medium" ? 0.7 : 0.45,
      });
    }
  }

  const deduped = new Map<string, PlaceKnowledgeFact>();
  for (const fact of facts) {
    const key = JSON.stringify({
      category: fact.category,
      text: normalizeFactText(fact.text),
      structuredKind: fact.structured?.kind ?? null,
      structuredValue: normalizeFactText(fact.structured?.value ?? ""),
    });
    if (!deduped.has(key)) {
      deduped.set(key, fact);
    }
  }

  return [...deduped.values()];
}
