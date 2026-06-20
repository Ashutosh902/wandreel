import type { DetectedPlace } from "./addFlowState";
import { isInstagramMetadataBoilerplateText } from "./addEntitySanitizer";

const ENGAGEMENT_NAME_PATTERNS = [
  /\blikes?\b/i,
  /\bcomments?\b/i,
  /\bon instagram:/i,
  /^@\w[\w.]*\b/i,
  /^(?:[\w.]{2,30}\s*(?:\||-|\u00b7)\s*)?(?:\d+\s*(?:d|day|days|w|week|weeks|mo|month|months|y|year|years)\s+ago|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?)\b/i,
  /^\d[\d,\s.]*\s+likes?\b/i,
];

export function isEngagementBoilerplateName(name: string): boolean {
  const normalized = name.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return ENGAGEMENT_NAME_PATTERNS.some((pattern) => pattern.test(normalized)) || isInstagramMetadataBoilerplateText(normalized);
}

export function isPlaceNeedsManualReview(place: DetectedPlace): boolean {
  const normalizedName = place.name.trim().toLowerCase();
  const normalizedLocality = place.locality.trim().toLowerCase();
  const hasEvidence = Boolean(String(place.evidenceText || "").trim());
  return (
    normalizedName === "detected place" ||
    normalizedLocality === "unknown locality" ||
    isEngagementBoilerplateName(place.name) ||
    (!place.placeId && !hasEvidence)
  );
}

export function shouldShowImmediateDraftPlaces(
  places: DetectedPlace[],
  status?: "ready" | "needs_review" | "no_supported_entity_found" | null,
): DetectedPlace[] {
  if (status !== "ready") return [];
  return places.filter((place) => place.confidence !== "low" && !isPlaceNeedsManualReview(place));
}
