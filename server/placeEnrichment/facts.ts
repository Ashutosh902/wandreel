import type { ExtractionResult } from "../extraction/types";
import type { IntelligencePipelineResult } from "../intelligence/types";
import type { PlaceKnowledgeFact, PlaceKnowledgeCategory } from "./types";

type CandidateSentence = {
  text: string;
  sourceSignal: PlaceKnowledgeFact["sourceSignal"];
  confidence: PlaceKnowledgeFact["confidence"];
  grounding: NonNullable<PlaceKnowledgeFact["grounding"]>;
};

type StructuredKnowledgeMatch = {
  category: PlaceKnowledgeCategory;
  kind: string;
  value: string;
  qualifiers?: Record<string, unknown>;
  evidenceText: string;
  supportType?: "direct" | "inferred";
  groundingConfidence?: number;
  factConfidenceScore?: number;
};

export type PlaceKnowledgeGroundingRejection = {
  sourceSignal: "intelligence";
  claimedEvidenceText: string;
  reason: "claimed_evidence_not_found_in_source";
  model: string | null;
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
  { category: "activities", patterns: [/\bactivity\b/i, /\btrek\b/i, /\bhike\b/i, /\bboat(?:ing|\s+ride)\b/i, /\bswim\b/i, /\bvisit\b/i, /\bexplore\b/i] },
  { category: "recommendations", patterns: [/\brecommend\b/i, /\bmust\b/i, /\bshould\b/i, /\bdon't miss\b/i, /\bfavorite\b/i] },
  { category: "tips", patterns: [/\btip\b/i, /\bpro tip\b/i, /\btry\b/i, /\bbook\b/i, /\bcarry\b/i] },
  { category: "creator_insights", patterns: [/\bi loved\b/i, /\bwe loved\b/i, /\bmy favorite\b/i, /\bi think\b/i, /\bhonestly\b/i] },
  { category: "practical_information", patterns: [/\bentry\b/i, /\bfee\b/i, /\bprice\b/i, /\bcost\b/i, /\baddress\b/i, /\blocation\b/i] },
];

function splitIntoSentences(text: string) {
  const sentences: Array<{ text: string; evidenceText: string; start: number; end: number }> = [];
  let cursor = 0;

  for (const segment of text.split(/[\n\r]+|(?<=[.!?])\s+/)) {
    const segmentStart = text.indexOf(segment, cursor);
    if (segmentStart < 0) continue;
    cursor = segmentStart + segment.length;

    const leadingWhitespace = segment.length - segment.trimStart().length;
    const evidenceText = segment.trim();
    const normalizedText = evidenceText.replace(/\s+/g, " ");
    if (normalizedText.length < 12 || normalizedText.length > 240) continue;

    const start = segmentStart + leadingWhitespace;
    sentences.push({
      text: normalizedText,
      evidenceText,
      start,
      end: start + evidenceText.length,
    });
  }

  return sentences;
}

function decodeEntity(value: string) {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  const match = /^&(?:#(x[0-9a-f]+|\d+)|([a-z]+));$/i.exec(value);
  if (!match) return value;
  if (match[1]) {
    const numeric = match[1].toLowerCase().startsWith("x")
      ? Number.parseInt(match[1].slice(1), 16)
      : Number.parseInt(match[1], 10);
    return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : value;
  }
  return named[String(match[2] || "").toLowerCase()] ?? value;
}

function normalizedWithSourceMap(value: string) {
  let normalized = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  let previousWasWhitespace = false;
  while (index < value.length) {
    const entity = value[index] === "&" ? /^&(?:#(?:x[0-9a-f]+|\d+)|[a-z]+);/i.exec(value.slice(index))?.[0] : null;
    const token = entity || value[index];
    const decoded = decodeEntity(token);
    const tokenEnd = index + token.length;
    for (const character of decoded) {
      if (/\s/.test(character)) {
        if (previousWasWhitespace || !normalized.length) continue;
        normalized += " ";
        starts.push(index);
        ends.push(tokenEnd);
        previousWasWhitespace = true;
      } else {
        normalized += character.toLowerCase();
        starts.push(index);
        ends.push(tokenEnd);
        previousWasWhitespace = false;
      }
    }
    index = tokenEnd;
  }
  if (normalized.endsWith(" ")) {
    normalized = normalized.slice(0, -1);
    starts.pop();
    ends.pop();
  }
  return { normalized, starts, ends };
}

export function locateEvidenceSpan(sourceText: string, claimedText: string) {
  const exactStart = sourceText.toLowerCase().indexOf(claimedText.trim().toLowerCase());
  if (exactStart >= 0) {
    return { start: exactStart, end: exactStart + claimedText.trim().length, method: "exact_span" as const };
  }
  const source = normalizedWithSourceMap(sourceText);
  const claim = normalizedWithSourceMap(claimedText).normalized;
  const normalizedStart = claim ? source.normalized.indexOf(claim) : -1;
  if (normalizedStart < 0) return null;
  const normalizedEnd = normalizedStart + claim.length - 1;
  return {
    start: source.starts[normalizedStart],
    end: source.ends[normalizedEnd],
    method: "normalized_span" as const,
  };
}

function pushSentences(
  target: CandidateSentence[],
  text: string,
  sourceSignal: CandidateSentence["sourceSignal"],
  confidence: CandidateSentence["confidence"],
  sourceField: string,
  sourceLocation?: NonNullable<PlaceKnowledgeFact["grounding"]>["sourceLocation"],
  frameReferences?: NonNullable<PlaceKnowledgeFact["grounding"]>["frameReferences"],
  supportType: "direct" | "inferred" = "direct",
  groundingConfidence?: number,
  validationMethod: NonNullable<PlaceKnowledgeFact["grounding"]>["validation"]["method"] = "exact_span",
) {
  for (const sentence of splitIntoSentences(text)) {
    target.push({
      text: sentence.text,
      sourceSignal,
      confidence,
      grounding: {
        supportType,
        sourceSignal,
        evidenceText: sentence.evidenceText,
        sourceField,
        groundingConfidence: groundingConfidence ?? (supportType === "direct" ? 0.98 : 0.65),
        span: { start: sentence.start, end: sentence.end, unit: "character" },
        ...(sourceLocation ? { sourceLocation } : {}),
        ...(frameReferences?.length ? { frameReferences } : {}),
        validation: { status: "validated", method: validationMethod, reason: null },
      },
    });
  }
}

function refineGrounding(candidate: CandidateSentence, evidenceText: string, supportType?: "direct" | "inferred", confidence?: number) {
  const located = locateEvidenceSpan(candidate.grounding.evidenceText, evidenceText);
  if (!located) return null;
  const resolvedSupportType = supportType ?? candidate.grounding.supportType;
  return {
    ...candidate.grounding,
    supportType: resolvedSupportType,
    evidenceText: candidate.grounding.evidenceText.slice(located.start, located.end),
    groundingConfidence: confidence ?? (supportType ? (supportType === "direct" ? 0.98 : 0.65) : candidate.grounding.groundingConfidence),
    span: {
      start: candidate.grounding.span.start + located.start,
      end: candidate.grounding.span.start + located.end,
      unit: "character" as const,
    },
    validation: {
      status: "validated" as const,
      method: candidate.grounding.validation.method === "visual_evidence_record"
        ? "visual_evidence_record" as const
        : located.method,
      reason: null,
    },
  };
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

function extractActivityMatch(text: string) {
  const match = /\b(boat ride|boating|guided tour|walking tour|trek(?:king)?|hik(?:e|ing)|kayak(?:ing)?|swim(?:ming)?|safari|snorkel(?:ling|ing)?)\b/i.exec(text);
  if (!match) return null;
  const normalized = cleanValue(match[1]);
  return { value: /^boating$/i.test(normalized) ? "boat ride" : normalized.toLowerCase(), evidenceText: match[0] };
}

function extractStructuredKnowledge(sentence: CandidateSentence, contextualActivity: string | null): StructuredKnowledgeMatch[] {
  const text = sentence.text;
  const matches: StructuredKnowledgeMatch[] = [];

  const activityMatch = extractActivityMatch(text);
  const activity = activityMatch?.value ?? null;
  if (activity) {
    matches.push({
      category: "activities",
      kind: "activity",
      value: activity,
      evidenceText: activityMatch!.evidenceText,
    });
  }

  const operatorMatch =
    /\b(?:my\s+)?(?:tour|trip|activity|experience|boat ride)\s+(?:was\s+)?(?:organised|organized|arranged|provided|operated|booked)\s+by(?:\s+my\s+stay)?\s*:?\s*([^,.;]+)/i.exec(text) ||
    /\b([^,.;]+?)\s+(?:organises|organizes|arranges|provides|operates)\s+(?:the\s+)?(?:tour|trip|activity|experience|boat ride)\b/i.exec(text);
  if (operatorMatch) {
    matches.push({
      category: "activities",
      kind: "operator",
      value: cleanValue(operatorMatch[1]),
      qualifiers: {
        relationship: "organised_by",
        activity: activity || contextualActivity || "tour",
      },
      evidenceText: operatorMatch[0],
    });
  }

  const bestTimeMatch =
    /\b(?:best time to visit is|go around|go before|visit around|visit before)\s+([^.,;]+)/i.exec(text) ||
    /\b(?:around|before)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i.exec(text);
  if (bestTimeMatch) {
    matches.push({
      category: "timing",
      kind: "best_time",
      value: cleanValue(bestTimeMatch[1]),
      evidenceText: bestTimeMatch[0],
    });
  }

  const recommendedItemMatch =
    /\b(?:order|must try|try|recommend(?:ed)?(?: the)?)\s+([^.,;]+?)(?:,|\s+(?:for|because|and|but)\b|[.!?]|$)/i.exec(text);
  if (recommendedItemMatch) {
    matches.push({
      category: "food",
      kind: "recommended_item",
      value: cleanValue(recommendedItemMatch[1]).replace(/^the\s+/i, ""),
      evidenceText: recommendedItemMatch[0],
    });
  }

  const crowdMatch =
    /\bavoid\s+([^.,;]+?)\s+because\s+it\s+gets\s+crowded\b/i.exec(text) ||
    /\b([^.,;]+?)\s+gets?\s+crowded\b/i.exec(text) ||
    /\bcrowded\s+(?:on|during)\s+([^.,;]+)/i.exec(text) ||
    /\bavoid\s+the\s+crowd\b/i.exec(text);
  if (crowdMatch) {
    const when = crowdMatch[1] ? cleanValue(crowdMatch[1]) : null;
    matches.push({
      category: "warnings",
      kind: "crowd_note",
      value: "crowded",
      qualifiers: when ? { when } : undefined,
      evidenceText: crowdMatch[0],
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
      evidenceText: seatingMatch[0],
    });
  }

  const parkingMatch = /\bparking\s+(?:is\s+)?(available|limited|not available|unavailable)\b/i.exec(text);
  if (parkingMatch) {
    matches.push({
      category: "accessibility",
      kind: "parking",
      value: cleanValue(parkingMatch[1]),
      evidenceText: parkingMatch[0],
    });
  }
  const parkingDifficultyMatch = /\bparking\s+(?:is\s+)?(difficult|hard|easy)\s+(?:on|during)\s+([^.,;]+)/i.exec(text);
  if (parkingDifficultyMatch) {
    matches.push({
      category: "accessibility",
      kind: "parking",
      value: cleanValue(parkingDifficultyMatch[1]),
      qualifiers: { when: cleanValue(parkingDifficultyMatch[2]) },
      evidenceText: parkingDifficultyMatch[0],
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
      evidenceText: pricingMatch[0],
    });
  }

  const conditionalAmbienceMatch = /\b(?:vibe is|ambience is|atmosphere is|feels)\s+([^.,;]+?)\s+(?:in|during|on|when)\s+(?:the\s+)?((?:weekday|weekend)?\s*(?:morning|afternoon|evening|night)s?)\b/i.exec(text);
  const ambienceMatch = conditionalAmbienceMatch || /\b(?:vibe is|ambience is|atmosphere is|feels)\s+([^.,;]+)/i.exec(text);
  if (ambienceMatch) {
    matches.push({
      category: "atmosphere",
      kind: "ambience",
      value: cleanValue(ambienceMatch[1]),
      qualifiers: conditionalAmbienceMatch ? { when: cleanValue(conditionalAmbienceMatch[2]) } : undefined,
      evidenceText: ambienceMatch[0],
    });
  }

  const bookingMatch = /\bbooking\s+(?:is\s+)?(not\s+)?required(?:\s+for)?\s+([^.,;]+)/i.exec(text);
  if (bookingMatch) {
    const bookingActivity = extractActivityMatch(bookingMatch[2])?.value || cleanValue(bookingMatch[2]);
    matches.push({
      category: "practical_information",
      kind: "booking_required",
      value: bookingMatch[1] ? "false" : "true",
      qualifiers: bookingActivity ? { activity: bookingActivity } : undefined,
      evidenceText: bookingMatch[0],
    });
  }

  const inferredParking = /\b(?:park(?:ed|ing)?|car)\b[^.!?]{0,80}\b(\d{2,4})\s*(metres?|meters?|m)\b[^.!?]{0,80}\bwalk(?:ed|ing)?\b/i.exec(text);
  if (inferredParking && !matches.some((match) => match.kind === "parking")) {
    matches.push({
      category: "accessibility",
      kind: "parking",
      value: "difficult",
      qualifiers: { walkingDistance: `${inferredParking[1]} ${inferredParking[2]}` },
      evidenceText: inferredParking[0],
      supportType: "inferred",
      groundingConfidence: 0.62,
      factConfidenceScore: 0.52,
    });
  }

  return matches;
}

export function extractPlaceKnowledgeResult(input: {
  extraction: ExtractionResult;
  intelligence: IntelligencePipelineResult | null;
}): { facts: PlaceKnowledgeFact[]; rejections: PlaceKnowledgeGroundingRejection[] } {
  const candidates: CandidateSentence[] = [];
  const rejections: PlaceKnowledgeGroundingRejection[] = [];
  const metadata = input.extraction.metadata;
  const comments = metadata.commentEvidence;

  pushSentences(candidates, metadata.description || "", "caption", "medium", "metadata.description");
  if (input.extraction.transcript?.segments?.length) {
    input.extraction.transcript.segments.forEach((segment, index) => {
      pushSentences(candidates, segment.text, "transcript", "high", `transcript.segments[${index}].text`, {
        startMs: segment.startMs,
        endMs: segment.endMs,
      });
    });
  } else {
    pushSentences(candidates, input.extraction.transcript?.text || "", "transcript", "high", "transcript.text");
  }
  if (input.extraction.ocr?.regions?.length) {
    input.extraction.ocr.regions.forEach((region, index) => {
      pushSentences(candidates, region.text, "ocr", "low", `ocr.regions[${index}].text`, {
        frameLabel: region.frameLabel,
        frameIndex: region.frameIndex,
        timestampSec: region.timestampSec,
        boundingBox: region.boundingBox,
      });
    });
  } else {
    pushSentences(candidates, input.extraction.ocr?.text || "", "ocr", "low", "ocr.text");
  }
  if (comments?.pinnedComment) {
    pushSentences(candidates, comments.pinnedComment, "comment", "medium", "metadata.commentEvidence.pinnedComment");
  }
  (comments?.topComments || []).forEach((comment, index) => {
    pushSentences(candidates, comment, "comment", "low", `metadata.commentEvidence.topComments[${index}]`);
  });
  (comments?.creatorReplies || []).forEach((reply, index) => {
    pushSentences(candidates, reply, "comment", "medium", `metadata.commentEvidence.creatorReplies[${index}]`);
  });

  const selectedCandidate = input.extraction.visualFallback?.selectedCandidate;
  if (selectedCandidate?.candidateName || selectedCandidate?.formattedAddress) {
    const visualText = [selectedCandidate.candidateName, selectedCandidate.formattedAddress, selectedCandidate.reason]
      .filter(Boolean)
      .join(" - ");
    const supportingLabels = new Set(selectedCandidate.supportFrameLabels || []);
    const frameReferences = (input.extraction.visualFallback?.screenshots || [])
      .filter((screenshot) => supportingLabels.has(screenshot.label))
      .map((screenshot) => ({
        label: screenshot.label,
        frameIndex: screenshot.frameIndex,
        timestampSec: screenshot.timestampSec,
      }));
    pushSentences(
      candidates,
      visualText,
      "visual",
      selectedCandidate.verificationConfidence === "high" ? "high" : "medium",
      "visualFallback.selectedCandidate",
      undefined,
      frameReferences,
      "inferred",
      selectedCandidate.verificationConfidence === "high" ? 0.82 : 0.65,
      "visual_evidence_record",
    );
  }

  for (const entity of input.intelligence?.output?.entities || []) {
    const detailParts = [
      entity.name,
      entity.locality,
      entity.city,
      entity.level2?.category === "eat" ? entity.level2.cuisineType : null,
    ].filter(Boolean);
    const evidenceText = entity.sourceEvidence?.trim();
    if (!detailParts.length || !evidenceText) continue;
    const sourceCandidate = candidates.find((candidate) => locateEvidenceSpan(candidate.grounding.evidenceText, evidenceText));
    if (!sourceCandidate) {
      rejections.push({
        sourceSignal: "intelligence",
        claimedEvidenceText: evidenceText,
        reason: "claimed_evidence_not_found_in_source",
        model: input.intelligence?.providerMeta?.model ?? null,
      });
      continue;
    }
    const located = refineGrounding(sourceCandidate, evidenceText);
    if (!located) continue;
    const normalizedEvidence = located.evidenceText.replace(/\s+/g, " ").trim();
    if (normalizedEvidence.length >= 12 && normalizedEvidence.length <= 240) {
      candidates.push({
        text: normalizedEvidence,
        sourceSignal: "intelligence",
        confidence: entity.confidence,
        grounding: located,
      });
    }
  }

  const seen = new Set<string>();
  const facts: PlaceKnowledgeFact[] = [];
  const contextualActivity = candidates
    .map((candidate) => extractActivityMatch(candidate.text)?.value)
    .find((value): value is string => Boolean(value)) || null;

  for (const candidate of candidates) {
    const normalized = normalizeFactText(candidate.text);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);

    for (const structured of extractStructuredKnowledge(candidate, contextualActivity)) {
      const grounding = refineGrounding(
        candidate,
        structured.evidenceText,
        structured.supportType,
        structured.groundingConfidence,
      );
      if (!grounding) continue;
      facts.push({
        category: structured.category,
        text: candidate.text,
        sourceSignal: candidate.sourceSignal,
        confidence: candidate.confidence,
        confidenceScore: structured.factConfidenceScore ?? (candidate.confidence === "high" ? 0.9 : candidate.confidence === "medium" ? 0.7 : 0.45),
        structured: {
          kind: structured.kind,
          value: structured.value,
          qualifiers: structured.qualifiers ?? {},
        },
        grounding,
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
        grounding: candidate.grounding,
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

  return { facts: [...deduped.values()], rejections };
}

export function extractPlaceKnowledgeFacts(input: {
  extraction: ExtractionResult;
  intelligence: IntelligencePipelineResult | null;
}): PlaceKnowledgeFact[] {
  return extractPlaceKnowledgeResult(input).facts;
}
