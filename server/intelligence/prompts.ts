import type { ExtractionResult } from "../extraction/types";
import type { IntelligenceRequest } from "./types";

const MAX_COMBINED = 5000;

function trimText(input: string | null | undefined, max: number): string {
  const clean = String(input || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.slice(0, max);
}

export function buildSystemPrompt(input?: { attemptNumber?: number | null }): string {
  const attemptNumber = Number(input?.attemptNumber) || 1;
  const retryInstructions =
    attemptNumber >= 3
      ? `
17. This is the final retry / Attempt 3.
18. In Attempt 3, visual fallback / reverse-image evidence is the primary decision source.
19. Metadata, transcript, OCR, and prior attempt outputs are supporting context only. They may corroborate, disambiguate, or reject a visual candidate, but they must not override a strongly verified visual candidate.
20. Prior attempt hypotheses are never ground truth. Treat them only as candidates to verify or reject.
21. If visualFallback.selectedCandidate exists and is strongly verified by search/location evidence, prefer it unless there is clear contradiction from stronger evidence.
22. If visual evidence conflicts with a prior guess, choose the better-supported result and make the evidence clear in evidenceText.
23. If visualFallback returns multiple plausible candidates but none is uniquely verified, return status = "needs_review" with low confidence and list the best candidates in evidenceText instead of guessing.
24. If visual candidate is strongly verified + supported by metadata/OCR/location, return ready.
25. If visual candidate is plausible but not uniquely verified, return needs_review with candidate list.
26. Prefer manual-review style honesty over a specific but weakly supported place guess.
27. Do not let caption-only or prior-attempt guesses outweigh a strongly verified visual candidate in Attempt 3.
28. Do not convert an ambiguous visual match into a confident ready result.`
      : attemptNumber === 2
        ? `
17. This is Retry 1 / Attempt 2.
18. Reuse previous evidence as context.
19. Treat the previous result as a hypothesis, not final truth.
20. Use new OCR text to repair missing or weak fields when possible.
21. Do not invent details if OCR adds no useful clue.
22. Return medium or high confidence only when description, transcript, and OCR support the entity.`
        : "";

  return `You are Wandreel's strict structured extraction engine.

Goal:
Convert saved link metadata into structured real-world discovery entities for the app Wandreel.

Supported categories:
- eat: named restaurants, cafes, food stalls, bakeries, sweets shops, food markets, named food places
- do: activities, experiences, events, amusement parks, water parks, boating, cycling, adventure, workshops
- stay: named hotels, hostels, resorts, homestays, villas, guest houses
- see: tourist attractions, landmarks, museums, monuments, temples, ghats, viewpoints, historical sites, religious places

Intent L1 mapping:
- eat -> taste
- do -> activity
- stay -> stay
- see -> explore

Valid intent L2 values:
- taste: Cafe, Restaurant, Bar, Dessert, Street Food, Fine Dining, Breakfast, Bakery, Sweets, Food Market
- activity: Adventure, Workshop, Comedy, Night Out, Shopping, Wellness, Sports, Water Activity, Event, Family Activity
- stay: Hotel, Resort, Hostel, Homestay, Villa, Dorm Stay, Workation, Luxury Stay, Budget Stay, Pet Stay
- explore: Nature, Heritage, Waterfall, Viewpoint, Museum, Monument, Spiritual, Park, Beach, Local Market

Return JSON only in this exact shape:
{
  "status": "ready" | "needs_review" | "no_supported_entity_found",
  "entities": [
    {
      "name": string,
      "category": "eat" | "do" | "stay" | "see",
      "intent": {
        "l1": "taste" | "activity" | "stay" | "explore",
        "l2": string,
        "l3": string[]
      },
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
    - see vibes: Trending, Visited, Heritage, Nature, Photo spots, Hidden gem, Spiritual, Iconic, Free
17. If the evidence clearly points to a supported real-world category but does not identify a unique named entity, return status = "needs_review" with low confidence instead of pretending certainty.
18. Do not use generic names like "Detected place", "Unknown place", or "Travel spot" for ready entities. Generic descriptive names are allowed only for low-confidence needs_review outputs.
19. If visualFallback.selectedCandidate is present and has strong verification/location evidence, prefer it over vague OCR/transcript clues unless there is clear contradiction.
20. Confidence rules:
    - high: exact named entity + strong locality/city evidence
    - medium: named entity with partial but plausible location evidence
    - low: generic clue, weak place name, uncertain locality, or needs manual review
21. Confidence rules for Attempt 3:
    - high: visual candidate strongly verified, with supporting metadata/OCR/location evidence
    - medium: named visual candidate with partial but plausible verification
    - low: generic OCR text, multiple plausible visual matches, weak locality match, or manual review needed
22. Every entity must include intent.
23. intent.l1 must match category using the fixed mapping: eat->taste, do->activity, stay->stay, see->explore.
24. Choose exactly one intent.l2.
25. intent.l2 must come only from the valid L2 list for the chosen intent.l1.
26. Do not return multiple L2 values.
27. Do not put Saved or Visited into intent.l2 or intent.l3.
28. intent.l3 is extracted from metadata/caption, transcript, OCR, and visual evidence. It is not predefined.
29. intent.l3 may include up to 3 short micro-intents, each ideally 3-4 words max.
30. Do not invent intent.l3 when evidence is weak.
31. Do not use generic intent.l3 tags like "nice place", "good view", "travel spot", or "food place".
32. Use intent.l3 for nuance instead of assigning multiple L2s.
33. If no strong L2 is available but the entity is valid, choose the closest valid L2 conservatively.${retryInstructions}`;
}

export function buildUserPrompt(source: ExtractionResult, analytics?: IntelligenceRequest["analytics"]): string {
  const metadata = source.metadata;
  const combinedText = source.combinedTextClean || source.combinedTextRaw || "";
  const visualFallback = source.visualFallback;
  const attemptNumber = Number(analytics?.attemptNumber ?? source.attemptInfo?.attemptNumber ?? 1) || 1;
  const triggerType = analytics?.triggerType || source.attemptInfo?.triggerType || "initial";

  const payload = {
    url: metadata.canonicalUrl || metadata.sourceUrl,
    platform: metadata.platform,
    attemptContext: {
      attemptNumber,
      triggerType,
      stageRoute: (source.debug as any)?.orchestration?.route || null,
      acceptedAfter: (source.debug as any)?.orchestration?.acceptedAfter || null,
      stageDecisions: Array.isArray((source.debug as any)?.orchestration?.decisions)
        ? (source.debug as any).orchestration.decisions
        : [],
    },
    combinedTextClean: trimText(combinedText, MAX_COMBINED),
    extractionMode: source.mode,
    quality: {
      isLowSignal: !String(combinedText || "").trim(),
    },
    ocrEvidence: {
      chars: String(source.ocr?.text || "").trim().length,
      text: trimText(source.ocr?.text, 1200) || null,
      instruction:
        "If OCR contains a candidate venue/place line such as 'Eva cafe, Anjuna', prefer that over generic social-media titles like '{creator} on Instagram: ...'. If OCR is weak or empty, do not invent a named entity from the social title alone.",
    },
    visualFallback: visualFallback
      ? {
          triggered: visualFallback.triggered,
          confidence: visualFallback.confidence,
          needsReview: visualFallback.needsReview,
          summaryText: trimText(visualFallback.summaryText, 300),
          selectedCandidate: visualFallback.selectedCandidate
            ? {
                name: visualFallback.selectedCandidate.candidateName,
                aliases: visualFallback.selectedCandidate.aliases || [],
                query: visualFallback.selectedCandidate.query,
                categoryHint: visualFallback.selectedCandidate.categoryHint || null,
                locationHint: visualFallback.selectedCandidate.locationHint || null,
                formattedAddress: visualFallback.selectedCandidate.formattedAddress,
                locality: visualFallback.selectedCandidate.locality,
                city: visualFallback.selectedCandidate.city,
                state: visualFallback.selectedCandidate.state,
                country: visualFallback.selectedCandidate.country,
                rankingScore: visualFallback.selectedCandidate.rankingScore,
                visualScore: visualFallback.selectedCandidate.visualScore ?? null,
                textSupportScore: visualFallback.selectedCandidate.textSupportScore ?? null,
                frameAgreementScore: visualFallback.selectedCandidate.frameAgreementScore ?? null,
                searchVerificationScore: visualFallback.selectedCandidate.searchVerificationScore ?? null,
                finalConfidence: visualFallback.selectedCandidate.finalConfidence || null,
                reason: visualFallback.selectedCandidate.reason || null,
                verificationConfidence: visualFallback.selectedCandidate.verificationConfidence,
                locationVerified: visualFallback.selectedCandidate.locationVerified ?? false,
                visualEvidence: trimText(visualFallback.selectedCandidate.visualEvidence, 220),
              }
            : null,
          alternateCandidates: visualFallback.candidates.slice(0, 3).map((candidate) => ({
            name: candidate.candidateName,
            aliases: candidate.aliases || [],
            query: candidate.query,
            categoryHint: candidate.categoryHint || null,
            locationHint: candidate.locationHint || null,
            formattedAddress: candidate.formattedAddress,
            rankingScore: candidate.rankingScore,
            visualScore: candidate.visualScore ?? null,
            textSupportScore: candidate.textSupportScore ?? null,
            frameAgreementScore: candidate.frameAgreementScore ?? null,
            searchVerificationScore: candidate.searchVerificationScore ?? null,
            finalConfidence: candidate.finalConfidence || null,
            reason: candidate.reason || null,
            verificationConfidence: candidate.verificationConfidence,
            locationVerified: candidate.locationVerified ?? false,
          })),
        }
      : null,
    priorAttemptHypotheses: attemptNumber >= 2
      ? Array.isArray((source.debug as any)?.priorAttemptHypotheses)
        ? (source.debug as any).priorAttemptHypotheses
        : []
      : [],
  };

  return `Process this extracted combined text for Wandreel. Return valid JSON only.\n\nInput:\n${JSON.stringify(payload, null, 2)}`;
}

export function buildTinyCaptionSystemPrompt(): string {
  return `You extract Wandreel places from caption-only evidence.

Use only: title, caption/description, and lightweight comments.

Return JSON only:
{
  "status": "ready" | "needs_review" | "no_supported_entity_found",
  "entities": [
    {
      "name": string,
      "category": "eat" | "do" | "stay" | "see",
      "intent": {
        "l1": "taste" | "activity" | "stay" | "explore",
        "l2": string,
        "l3": string[]
      },
      "locality": string | null,
      "city": string | null,
      "state": string | null,
      "country": string | null,
      "confidence": "high" | "medium" | "low",
      "googleMapsQuery": string | null,
      "evidenceText": string | null
    }
  ],
  "weakMentions": []
}

Rules:
1. Use caption/title/comments evidence only.
2. Do not invent place names.
3. If the place is vague or ambiguous, return "needs_review" or "no_supported_entity_found".
4. Return "ready" only when a real supported entity is reasonably clear.
5. category must be one of eat, do, stay, see.
6. intent.l1 must match category: eat->taste, do->activity, stay->stay, see->explore.
7. Choose exactly one intent.l2 from:
   taste: Cafe, Restaurant, Bar, Dessert, Street Food, Fine Dining, Breakfast, Bakery, Sweets, Food Market
   activity: Adventure, Workshop, Comedy, Night Out, Shopping, Wellness, Sports, Water Activity, Event, Family Activity
   stay: Hotel, Resort, Hostel, Homestay, Villa, Dorm Stay, Workation, Luxury Stay, Budget Stay, Pet Stay
   explore: Nature, Heritage, Waterfall, Viewpoint, Museum, Monument, Spiritual, Park, Beach, Local Market
8. intent.l3 is not predefined. Extract up to 3 short tags from caption/title/comments only.
9. Never use Saved or Visited in intent.l2 or intent.l3.
10. Do not split a generic experience phrase into a separate activity entity unless it is clearly named/bookable.
11. If a short proper name appears with clear venue words and locality/city evidence, treat it as a named entity.
12. Keep generic experiences like "boat ride" in intent.l3 unless a separate operator/tour/activity is clearly named.

Examples:
- "Beige rooftop restaurant in Marathahalli Bangalore" -> ready, eat, taste, Restaurant.
- "Periyar Reserve boat ride" -> usually one see/explore entity, with "boat ride" in intent.l3.`;
}

export function buildTinyCaptionUserPrompt(source: ExtractionResult, analytics?: IntelligenceRequest["analytics"]): string {
  const comments = source.metadata.commentEvidence;
  const payload = {
    sourceUrl: source.metadata.canonicalUrl || source.metadata.sourceUrl,
    platform: source.metadata.platform,
    title: trimText(source.metadata.title, 300) || null,
    description: trimText(source.metadata.description, 2200) || null,
    comments: comments
      ? {
          pinnedComment: trimText(comments.pinnedComment, 240) || null,
          topComments: Array.isArray(comments.topComments)
            ? comments.topComments.map((item) => trimText(item, 180)).filter(Boolean).slice(0, 3)
            : [],
        }
      : {
          pinnedComment: null,
          topComments: [],
        },
    attemptNumber: Number(analytics?.attemptNumber ?? source.attemptInfo?.attemptNumber ?? 1) || 1,
  };

  return `Extract Wandreel entities from this caption evidence only. Return JSON only.\n\nInput:\n${JSON.stringify(payload, null, 2)}`;
}
