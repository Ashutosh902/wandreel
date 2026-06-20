import type { DetectedPlace } from "./addFlowState";

const MONTH_PATTERN = "january|february|march|april|may|june|july|august|september|october|november|december";

export function isInstagramMetadataBoilerplateText(input: string): boolean {
  const raw = String(input || "").replace(/\s+/g, " ").trim();
  if (!raw) return false;
  const normalized = raw.toLowerCase();
  const htmlEntityCount = (raw.match(/&[a-z#0-9]+;/gi) || []).length;
  const commaCount = (raw.match(/,/g) || []).length;

  if (/\blikes?\b/.test(normalized)) return true;
  if (/\bcomments?\b/.test(normalized)) return true;
  if (/\bview all comments\b/.test(normalized)) return true;
  if (/\badd a comment\b/.test(normalized)) return true;
  if (/\bfollow\b/.test(normalized)) return true;
  if (/\binstagram\b/.test(normalized)) return true;
  if (new RegExp(`\\bon\\s+(${MONTH_PATTERN})\\b`, "i").test(normalized)) return true;
  if (new RegExp(`\\b[a-z0-9._]{3,}\\s+on\\s+(${MONTH_PATTERN})\\b`, "i").test(normalized)) return true;
  if (/#\w+/.test(raw)) return true;
  if (/^\s*[\d,]+\b/.test(raw)) return true;
  if (/&quot;|&#0*39;|&amp;|&#064;|&[a-z#0-9]+;/i.test(raw) && htmlEntityCount >= 1) return true;
  if (/:\s*["“”']/.test(raw) && new RegExp(`\\bon\\s+(${MONTH_PATTERN})\\b`, "i").test(normalized)) return true;
  if (raw.length > 80 && (commaCount >= 1 || htmlEntityCount >= 1)) return true;

  return false;
}

export function isValidDetectedPlaceName(name: string): boolean {
  const normalized = String(name || "").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return !isInstagramMetadataBoilerplateText(normalized);
}

export function sanitizeDetectedPlace(place: DetectedPlace): {
  place: DetectedPlace;
  sanitized: boolean;
  reason: "instagram_metadata_boilerplate" | null;
} {
  if (isValidDetectedPlaceName(place.name)) {
    return {
      place,
      sanitized: false,
      reason: null,
    };
  }

  return {
    place: {
      ...place,
      name: "Detected place",
      confidence: "low",
    },
    sanitized: true,
    reason: "instagram_metadata_boilerplate",
  };
}

export function sanitizeDetectedPlaces(places: DetectedPlace[]): {
  places: DetectedPlace[];
  sanitizedCount: number;
} {
  let sanitizedCount = 0;
  const nextPlaces = places.map((place) => {
    const sanitized = sanitizeDetectedPlace(place);
    if (sanitized.sanitized) {
      sanitizedCount += 1;
    }
    return sanitized.place;
  });
  return {
    places: nextPlaces,
    sanitizedCount,
  };
}
