export type StrollLibraryStatus = "draft" | "queued" | "curating" | "ready" | "failed" | "archived";
export type StrollLibrarySource = "onboarding" | "hero" | "manual" | "saved_places";

export type PersistentStrollSummary = {
  id: string;
  name: string;
  description: string | null;
  city: string;
  status: StrollLibraryStatus;
  source: StrollLibrarySource;
  startDate: string | null;
  endDate: string | null;
  requestedStartTime: string | null;
  travellerCount: number | null;
  interests: string[];
  latitude: number | null;
  longitude: number | null;
  totalDistanceMeters: number | null;
  estimatedDurationMinutes: number | null;
  stopCount: number;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  updatedAt: string;
  curatedAt: string | null;
  archivedAt: string | null;
};

export type PersistentStrollStop = {
  id: string;
  placeId: string;
  placeTitle: string | null;
  placeCategory: string | null;
  placeLocality: string | null;
  placeAddress: string | null;
  placeDescription: string | null;
  placeImageUrl: string | null;
  placeVideoUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  sequence: number;
  reason: string | null;
  generatedDescription: string | null;
  descriptionGenerationMeta: unknown | null;
  estimatedVisitDurationMinutes: number | null;
  arrivalEstimate: string | null;
  departureEstimate: string | null;
  routeDistanceMeters: number | null;
  routeDurationMinutes: number | null;
  suitability: {
    weather: "indoor" | "outdoor" | "sheltered" | "unknown";
    openingHours: unknown | null;
    notes: string[];
  };
};

export type PersistentStrollDetail = PersistentStrollSummary & {
  stops: PersistentStrollStop[];
};

export type StrollLibraryLoadState = "idle" | "loading" | "ready" | "error";

export type StrollStatusPresentation = {
  label: string;
  tone: "draft" | "working" | "ready" | "failed" | "archived";
  title: string;
  description: string;
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

export function getStrollLibraryViewState(input: {
  loadState: StrollLibraryLoadState;
  strolls: PersistentStrollSummary[];
  error: string | null;
}) {
  if (input.loadState === "loading" && input.strolls.length === 0) return "loading";
  if (input.loadState === "error" && input.strolls.length === 0) return "error";
  if (input.strolls.length === 0) return "empty";
  return "ready";
}

export function isPollingStrollStatus(status: StrollLibraryStatus) {
  return status === "queued" || status === "curating";
}

export function getStrollIdsToPoll(strolls: PersistentStrollSummary[]) {
  return strolls.filter((stroll) => isPollingStrollStatus(stroll.status)).map((stroll) => stroll.id);
}

export function mergePolledStroll(strolls: PersistentStrollSummary[], updated: PersistentStrollSummary) {
  if (updated.status === "archived") {
    return strolls.filter((stroll) => stroll.id !== updated.id);
  }

  const existingIndex = strolls.findIndex((stroll) => stroll.id === updated.id);
  if (existingIndex === -1) return [updated, ...strolls];

  return strolls.map((stroll) => (stroll.id === updated.id ? updated : stroll));
}

export function getStrollStatusPresentation(status: StrollLibraryStatus): StrollStatusPresentation {
  if (status === "draft") {
    return {
      label: "Draft",
      tone: "draft",
      title: "Manual draft",
      description: "Saved but not generated yet.",
    };
  }
  if (status === "queued") {
    return {
      label: "Queued",
      tone: "working",
      title: "Waiting for curation",
      description: "Wandreel will start shaping this soon.",
    };
  }
  if (status === "curating") {
    return {
      label: "Curating",
      tone: "working",
      title: "Building your Stroll",
      description: "Checking stops and preparing the route shell.",
    };
  }
  if (status === "ready") {
    return {
      label: "Ready",
      tone: "ready",
      title: "Ready to start",
      description: "Your ordered Stroll is available.",
    };
  }
  if (status === "failed") {
    return {
      label: "Failed",
      tone: "failed",
      title: "Needs another try",
      description: "Curation did not finish. You can retry it.",
    };
  }
  return {
    label: "Archived",
    tone: "archived",
    title: "Archived",
    description: "This Stroll is no longer active.",
  };
}

export async function fetchStrollLibrary(apiBaseUrl: string, fetcher: Fetcher = fetch) {
  const response = await fetcher(`${ensureApiBaseUrl(apiBaseUrl)}/api/strolls`, {
    credentials: "include",
  });
  const payload = await parseApiPayload(response);
  return Array.isArray(payload.strolls) ? (payload.strolls as PersistentStrollSummary[]) : [];
}

export async function fetchStrollStatus(apiBaseUrl: string, strollId: string, fetcher: Fetcher = fetch) {
  const response = await fetcher(`${ensureApiBaseUrl(apiBaseUrl)}/api/strolls/${encodeURIComponent(strollId)}/status`, {
    credentials: "include",
  });
  const payload = await parseApiPayload(response);
  return payload.stroll as PersistentStrollSummary;
}

export async function fetchStrollDetail(apiBaseUrl: string, strollId: string, fetcher: Fetcher = fetch) {
  const response = await fetcher(`${ensureApiBaseUrl(apiBaseUrl)}/api/strolls/${encodeURIComponent(strollId)}`, {
    credentials: "include",
  });
  const payload = await parseApiPayload(response);
  return payload.stroll as PersistentStrollDetail;
}

export async function retryStrollCuration(apiBaseUrl: string, strollId: string, fetcher: Fetcher = fetch) {
  const response = await fetcher(`${ensureApiBaseUrl(apiBaseUrl)}/api/strolls/${encodeURIComponent(strollId)}/retry`, {
    method: "POST",
    credentials: "include",
  });
  const payload = await parseApiPayload(response);
  return payload.stroll as PersistentStrollSummary;
}
