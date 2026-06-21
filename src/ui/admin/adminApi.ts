const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

type AdminApiBase = {
  ok: boolean;
  status: number;
  error?: string;
};

export type AdminOverviewResponse = AdminApiBase & {
  totals?: {
    submittedLinks?: number | null;
    runs?: number | null;
    attempts?: number | null;
    savedRuns?: number | null;
    editedRuns?: number | null;
    discardedRuns?: number | null;
  };
  rates?: {
    saveRate?: number | null;
    editRate?: number | null;
    discardRate?: number | null;
  };
  averages?: {
    attemptCount?: number | null;
    extractionTimeMs?: number | null;
  };
  estimates?: {
    cacheReuseCount?: number | null;
    duplicateSavedPlaceCount?: number | null;
    cacheReuseIsEstimated?: boolean;
    duplicateSavedPlaceIsEstimated?: boolean;
  };
};

export type AdminLinkRow = {
  submittedLinkId: string;
  canonicalUrl: string;
  platform: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  runCount: number;
  attemptCount: number;
  latestStatus: string | null;
  latestAcceptedAfter: string | null;
  latestRoute: string | null;
  cacheReuseCount: number;
  finalSelectedPlaceId: string | null;
  finalUserAction: string | null;
};

export type AdminLinksResponse = AdminApiBase & {
  rows?: AdminLinkRow[];
  pagination?: {
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
  };
};

export type AdminLinkDetailAttempt = {
  id: string;
  attemptNumber: number | null;
  status: string | null;
  triggerType: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  providerLatencyMs: number | null;
  totalLatencyMs: number | null;
  entityCount: number | null;
  intelligenceStatus: string | null;
  validationErrorCount: number | null;
  failureReason: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  acceptedAfter: string | null;
  route: string | null;
  extractionResultSummary: string | null;
  intelligenceResultSummary: string | null;
  stages?: Array<{
    id: string;
    stage: string;
    status: string | null;
    attemptNumber: number | null;
    latencyMs: number | null;
    errorText: string | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  }>;
  evidence?: Array<{
    id: string;
    evidenceType: string;
    position: number | null;
    summaryText: string | null;
    sourceRef: string | null;
    createdAt: string;
  }>;
  entities?: Array<{
    id: string;
    entityIndex: number | null;
    entityType: string | null;
    title: string | null;
    subtitle: string | null;
    placeCandidateId: string | null;
    finalPlaceId: string | null;
    confidence: number | null;
    wasSaved: boolean;
    wasEdited: boolean;
    wasDiscarded: boolean;
    createdAt: string;
  }>;
  edits?: Array<{
    id: string;
    attemptNumber: number | null;
    entityId: string | null;
    entityIndex: number | null;
    fieldName: string;
    editedByUserId: string | null;
    createdAt: string;
  }>;
};

export type AdminLinkDetailRun = {
  id: string;
  clientRunId: string | null;
  userId: string | null;
  anonymousId: string | null;
  sourceUrl: string;
  sourcePlatform: string | null;
  latestOutcome: string | null;
  latestAttemptNumber: number | null;
  firstSavedAttemptNumber: number | null;
  firstEditedAttemptNumber: number | null;
  firstDiscardedAttemptNumber: number | null;
  createdAt: string;
  updatedAt: string;
  attempts?: AdminLinkDetailAttempt[];
  events?: Array<{
    id: string;
    attemptNumber: number | null;
    eventName: string;
    createdAt: string;
  }>;
};

export type AdminLinkDetailResponse = AdminApiBase & {
  submittedLink?: {
    id: string;
    canonicalUrl: string;
    platform: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
  } | null;
  runs?: AdminLinkDetailRun[];
};

export async function fetchAdminOverview(): Promise<AdminOverviewResponse> {
  const res = await fetch(`${API_BASE}/api/admin/observability/overview`, { credentials: "include" });
  const body = await safeJson(res);
  return { ok: res.ok, status: res.status, ...body };
}

export async function fetchAdminLinks(params: Record<string, string | number | undefined> = {}): Promise<AdminLinksResponse> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== "") query.set(k, String(v));
  });
  const res = await fetch(`${API_BASE}/api/admin/observability/links?${query.toString()}`, { credentials: "include" });
  const body = await safeJson(res);
  return { ok: res.ok, status: res.status, ...body };
}

export async function fetchAdminLinkDetail(submittedLinkId: string): Promise<AdminLinkDetailResponse> {
  const res = await fetch(`${API_BASE}/api/admin/observability/links/${encodeURIComponent(submittedLinkId)}?includeRaw=false`, {
    credentials: "include",
  });
  const body = await safeJson(res);
  return { ok: res.ok, status: res.status, ...body };
}

export default {};
