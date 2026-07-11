export type LiveConditionType =
  | "weather"
  | "traffic"
  | "closure"
  | "civic_alert"
  | "waterlogging"
  | "venue_access";

export type LiveConditionSeverity = "info" | "moderate" | "high" | "critical";
export type LiveProviderStatus = "success" | "unavailable" | "failed";
export type LiveConditionsLoadState = "idle" | "loading" | "ready" | "unavailable" | "error";

export type PersistentLiveCondition = {
  id: string;
  provider: string;
  conditionType: LiveConditionType;
  severity: LiveConditionSeverity;
  confidence: number | null;
  sourceTimestamp: string;
  fetchedTimestamp: string;
  expiryTimestamp: string;
  message: string;
  payload: Record<string, unknown>;
};

export type PersistentLiveProviderResult = {
  provider: string;
  conditionType: LiveConditionType;
  status: LiveProviderStatus;
  fetchedTimestamp: string;
  expiryTimestamp: string | null;
  conditions: PersistentLiveCondition[];
  errorCode?: string;
  errorMessage?: string;
};

export type PersistentStrollLiveConditions = {
  strollId: string;
  status: "available" | "unavailable";
  fetchedTimestamp: string;
  expiryTimestamp: string | null;
  conditions: PersistentLiveCondition[];
  providers: PersistentLiveProviderResult[];
};

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

export function isLiveConditionCurrent(condition: PersistentLiveCondition, now = new Date()) {
  const expiryMs = Date.parse(condition.expiryTimestamp);
  return Number.isFinite(expiryMs) && expiryMs > now.getTime();
}

export function filterCurrentLiveConditions(conditions: PersistentLiveCondition[], now = new Date()) {
  return conditions.filter((condition) => isLiveConditionCurrent(condition, now));
}

export function getLiveConditionsViewState(input: {
  loadState: LiveConditionsLoadState;
  live: PersistentStrollLiveConditions | null;
  currentConditionCount: number;
}) {
  if (input.loadState === "loading") return "loading";
  if (input.loadState === "error" || input.loadState === "unavailable") return "unavailable";
  if (!input.live) return "idle";
  if (input.live.status === "unavailable") return "unavailable";
  if (input.currentConditionCount === 0) return "no-alerts";
  return "alerts";
}

export function formatLiveProviderName(provider: string) {
  if (provider === "open_meteo") return "Open-Meteo";
  return provider
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatLiveConditionType(type: LiveConditionType) {
  return type.replace("_", " ");
}

export function formatLiveFreshness(timestamp: string, now = new Date()) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return "freshness unavailable";
  const diffMinutes = Math.max(0, Math.round((now.getTime() - parsed) / 60_000));
  if (diffMinutes < 1) return "updated just now";
  if (diffMinutes === 1) return "updated 1 min ago";
  return `updated ${diffMinutes} min ago`;
}

export async function fetchStrollLiveConditions(apiBaseUrl: string, strollId: string, fetcher: Fetcher = fetch) {
  const response = await fetcher(`${ensureApiBaseUrl(apiBaseUrl)}/api/strolls/${encodeURIComponent(strollId)}/live-conditions`, {
    credentials: "include",
  });
  const payload = await parseApiPayload(response);
  return payload.live as PersistentStrollLiveConditions;
}
