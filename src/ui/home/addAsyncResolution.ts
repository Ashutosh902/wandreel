import type { DetectedPlace } from "./addFlowState";
import { isPlaceNeedsManualReview } from "./addDraftVisibility";
import { isValidDetectedPlaceName } from "./addEntitySanitizer";

export function summarizePlacesForLog(places: DetectedPlace[]) {
  return places.map((place) => ({
    name: place.name,
    locality: place.locality,
    category: place.category,
    confidence: place.confidence ?? null,
  }));
}

export function isPlaceholderLikePlace(place: DetectedPlace) {
  return place.confidence === "low" || isPlaceNeedsManualReview(place) || !isValidDetectedPlaceName(place.name);
}

export function shouldApplyResolvedPlacesUpdate(
  currentRunPlaces: DetectedPlace[],
  incomingResolvedPlaces: DetectedPlace[],
): { apply: boolean; reason: string } {
  if (incomingResolvedPlaces.length === 0) {
    const currentHasOnlyJunk = currentRunPlaces.length > 0 && currentRunPlaces.every((place) => !isValidDetectedPlaceName(place.name));
    if (currentHasOnlyJunk) {
      return { apply: true, reason: "incoming_empty_replace_junk_with_placeholder" };
    }
    return { apply: false, reason: "incoming_empty_preserve_current" };
  }
  if (currentRunPlaces.length === 0) {
    return { apply: true, reason: "no_current_run_places" };
  }
  const currentIsPlaceholderOnly = currentRunPlaces.every(isPlaceholderLikePlace);
  const incomingHasBetterEntity = incomingResolvedPlaces.some((place) => !isPlaceholderLikePlace(place));
  if (currentIsPlaceholderOnly && incomingHasBetterEntity) {
    return { apply: true, reason: "incoming_better_than_placeholder" };
  }
  return { apply: true, reason: "incoming_resolved_entities" };
}
