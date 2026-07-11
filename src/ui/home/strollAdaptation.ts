import type { PersistentStrollDetail } from "./strollLibrary";

export type StrollAdaptationEvidence =
  | {
      type: "live_condition";
      provider: string;
      conditionType: string;
      severity: string;
      sourceTimestamp: string;
      expiryTimestamp: string;
      message: string;
    }
  | {
      type: "stop_suitability";
      stopId: string;
      stopTitle: string;
      weather: string;
      openingHoursAvailable: boolean;
    }
  | {
      type: "route_metric";
      stopId: string;
      routeDistanceMeters: number | null;
      routeDurationMinutes: number | null;
    }
  | {
      type: "time_context";
      currentTime: string;
      requestedStartTime: string | null;
    }
  | {
      type: "current_location";
      latitude: number;
      longitude: number;
    };

export type StrollAdaptationRecommendation =
  | {
      status: "recommended";
      originalStopIds: string[];
      proposedStopIds: string[];
      proposedSequence: Array<{
        stopId: string;
        placeId: string;
        title: string;
        fromSequence: number;
        toSequence: number;
      }>;
      reason: string;
      evidence: StrollAdaptationEvidence[];
      confidence: "low" | "medium" | "high";
      limitations: string[];
    }
  | {
      status: "none";
      originalStopIds: string[];
      proposedStopIds: string[];
      reason: string;
      evidence: StrollAdaptationEvidence[];
      confidence: "low";
      limitations: string[];
    };

export type StrollAdaptationLoadState = "idle" | "loading" | "ready" | "error";

type Fetcher = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

function ensureApiBaseUrl(apiBaseUrl: string) {
  return apiBaseUrl.replace(/\/$/, "");
}

async function parseApiPayload(response: Awaited<ReturnType<Fetcher>>) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !(payload as { ok?: boolean })?.ok) {
    throw new Error(String((payload as { error?: string })?.error || `Request failed (${response.status})`));
  }
  return payload as Record<string, unknown>;
}

export function getAdaptationViewState(input: {
  loadState: StrollAdaptationLoadState;
  recommendation: StrollAdaptationRecommendation | null;
  dismissed: boolean;
}) {
  if (input.dismissed) return "dismissed";
  if (input.loadState === "loading") return "loading";
  if (input.loadState === "error") return "error";
  if (!input.recommendation) return "idle";
  return input.recommendation.status === "recommended" ? "recommended" : "none";
}

export function formatAdaptationEvidence(evidence: StrollAdaptationEvidence) {
  if (evidence.type === "live_condition") {
    return `${evidence.severity} ${evidence.conditionType} from ${evidence.provider}: ${evidence.message}`;
  }
  if (evidence.type === "stop_suitability") {
    return `${evidence.stopTitle}: ${evidence.weather} weather suitability`;
  }
  if (evidence.type === "route_metric") {
    const distance = evidence.routeDistanceMeters == null ? "unknown distance" : `${Math.round(evidence.routeDistanceMeters / 100) / 10} km`;
    const duration = evidence.routeDurationMinutes == null ? "unknown duration" : `${evidence.routeDurationMinutes} min`;
    return `Route into stop: ${distance}, ${duration}`;
  }
  if (evidence.type === "current_location") {
    return `Current location available (${evidence.latitude.toFixed(4)}, ${evidence.longitude.toFixed(4)})`;
  }
  return `Current time ${evidence.currentTime}${evidence.requestedStartTime ? `, requested start ${evidence.requestedStartTime}` : ""}`;
}

export async function fetchStrollAdaptationRecommendation(
  apiBaseUrl: string,
  strollId: string,
  currentLocation?: { lat: number; lng: number } | null,
  fetcher: Fetcher = fetch,
) {
  const url = new URL(`${ensureApiBaseUrl(apiBaseUrl)}/api/strolls/${encodeURIComponent(strollId)}/adaptation-recommendation`);
  if (currentLocation) {
    url.searchParams.set("currentLat", String(currentLocation.lat));
    url.searchParams.set("currentLng", String(currentLocation.lng));
  }
  const response = await fetcher(url.toString(), { credentials: "include" });
  const payload = await parseApiPayload(response);
  return payload.recommendation as StrollAdaptationRecommendation;
}

export async function acceptStrollAdaptation(
  apiBaseUrl: string,
  strollId: string,
  stopIds: string[],
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(`${ensureApiBaseUrl(apiBaseUrl)}/api/strolls/${encodeURIComponent(strollId)}/reorder`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stopIds }),
  });
  const payload = await parseApiPayload(response);
  return payload.stroll as PersistentStrollDetail;
}
