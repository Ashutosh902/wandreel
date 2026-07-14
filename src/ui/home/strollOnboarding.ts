import type { CategoryLabel, NavLabel } from "./home.data";
import type { PlannerRoute } from "./homeNavigation";

export type StrollOnboardingDecision = "unseen" | "accepted" | "declined";
export type StrollSource = "onboarding" | "hero" | "manual" | "saved_places";

export type StrollOnboardingPreference = {
  decision: StrollOnboardingDecision;
  decisionAt: string | null;
  defaultTravellerCount: number | null;
  defaultInterests: string[];
  defaultStartTime: string | null;
};

export type DraftStrollPayload = {
  clientRequestId: string;
  source: StrollSource;
  name: string;
  city: string;
  startDate?: string;
  endDate?: string;
  requestedStartTime?: string;
  travellerCount?: number;
  interests: string[];
  latitude?: number;
  longitude?: number;
  placeIds: string[];
};

export type DraftStrollSeed = {
  name: string;
  city: string;
  startDate: string;
  endDate: string;
  requestedStartTime: string;
  travellerCount: number;
  interests: string[];
  latitude: number | null;
  longitude: number | null;
  placeIds: string[];
};

export type DraftStrollSummary = {
  id: string;
  name: string;
  city: string;
  status: "draft" | "queued" | "curating" | "ready" | "failed" | "archived";
  source: StrollSource;
  stopCount: number;
  createdAt: string;
  updatedAt: string;
};

export const STROLL_INTEREST_OPTIONS = [
  "Food",
  "Heritage",
  "Nature",
  "Art",
  "Shopping",
  "Nightlife",
  "Family",
  "Hidden gems",
] as const;

type Fetcher = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export function shouldShowStrollOnboardingPrompt(input: {
  isAuthenticated: boolean;
  decision: StrollOnboardingDecision | null;
  activeTab: NavLabel;
  activeCategory: CategoryLabel | null;
  plannerRoute: PlannerRoute;
  isReadySheetOpen: boolean;
  isPromptDismissed: boolean;
}) {
  return (
    input.isAuthenticated &&
    input.decision === "unseen" &&
    input.activeTab === "Discover" &&
    input.activeCategory === null &&
    input.plannerRoute === "home" &&
    !input.isReadySheetOpen &&
    !input.isPromptDismissed
  );
}

export function canShowManualStrollEntry(input: {
  isAuthenticated: boolean;
  activeTab: NavLabel;
  activeCategory: CategoryLabel | null;
}) {
  return input.isAuthenticated && input.activeTab === "Discover" && input.activeCategory === null;
}

export function canSubmitDraftStroll(input: { city: string; isSubmitting: boolean }) {
  return input.city.trim().length > 0 && !input.isSubmitting;
}

export function getDefaultStrollCity(locationLabel: string) {
  return locationLabel.split(",")[0]?.trim() || "";
}

export function createStrollClientRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `stroll-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildDraftStrollPayload(input: {
  clientRequestId: string;
  source?: StrollSource;
  city: string;
  startDate?: string;
  endDate?: string;
  requestedStartTime?: string;
  travellerCount: number;
  interests: string[];
  coords?: { lat: number; lng: number } | null;
}): DraftStrollPayload {
  const city = input.city.trim();
  const payload: DraftStrollPayload = {
    clientRequestId: input.clientRequestId,
    source: input.source ?? "manual",
    name: `${city} Stroll`,
    city,
    travellerCount: input.travellerCount,
    interests: input.interests.slice(0, 10),
    placeIds: [],
  };

  if (input.startDate?.trim()) payload.startDate = input.startDate.trim();
  if (input.endDate?.trim()) payload.endDate = input.endDate.trim();
  if (input.requestedStartTime?.trim()) payload.requestedStartTime = input.requestedStartTime.trim();
  if (input.coords && Number.isFinite(input.coords.lat) && Number.isFinite(input.coords.lng)) {
    payload.latitude = input.coords.lat;
    payload.longitude = input.coords.lng;
  }

  return payload;
}

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

export async function fetchStrollOnboarding(apiBaseUrl: string, fetcher: Fetcher = fetch) {
  const response = await fetcher(`${ensureApiBaseUrl(apiBaseUrl)}/api/stroll/onboarding`, {
    credentials: "include",
  });
  const payload = await parseApiPayload(response);
  return payload.onboarding as StrollOnboardingPreference;
}

export async function updateStrollOnboardingDecision(
  apiBaseUrl: string,
  decision: Exclude<StrollOnboardingDecision, "unseen">,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(`${ensureApiBaseUrl(apiBaseUrl)}/api/stroll/onboarding`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  const payload = await parseApiPayload(response);
  return payload.onboarding as StrollOnboardingPreference;
}

export async function createDraftStroll(apiBaseUrl: string, draft: DraftStrollPayload, fetcher: Fetcher = fetch) {
  const response = await fetcher(`${ensureApiBaseUrl(apiBaseUrl)}/api/strolls`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  const payload = await parseApiPayload(response);
  return payload.stroll as DraftStrollSummary;
}
