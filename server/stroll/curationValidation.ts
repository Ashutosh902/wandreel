import type { StrollStop } from "./types";

export type StrollReadyValidationFailureCode =
  | "missing_stops"
  | "duplicate_stop_sequence"
  | "duplicate_stop_place"
  | "invalid_stop_ownership";

export class StrollReadyValidationError extends Error {
  code: StrollReadyValidationFailureCode;

  constructor(code: StrollReadyValidationFailureCode, message: string) {
    super(message);
    this.name = "StrollReadyValidationError";
    this.code = code;
  }
}

export function validateStrollStopsForReady(stops: Pick<StrollStop, "placeId" | "sequence">[], ownedPlaceIds: string[]) {
  if (stops.length === 0) {
    throw new StrollReadyValidationError("missing_stops", "Stroll must include at least one ordered stop.");
  }

  const owned = new Set(ownedPlaceIds);
  const seenSequences = new Set<number>();
  const seenPlaces = new Set<string>();

  for (const stop of stops) {
    if (seenSequences.has(stop.sequence)) {
      throw new StrollReadyValidationError("duplicate_stop_sequence", "Stroll stops must not repeat a sequence.");
    }
    seenSequences.add(stop.sequence);

    if (seenPlaces.has(stop.placeId)) {
      throw new StrollReadyValidationError("duplicate_stop_place", "Stroll stops must not repeat a saved place.");
    }
    seenPlaces.add(stop.placeId);

    if (!owned.has(stop.placeId)) {
      throw new StrollReadyValidationError(
        "invalid_stop_ownership",
        "Every Stroll stop must reference a place saved by the current user.",
      );
    }
  }
}
