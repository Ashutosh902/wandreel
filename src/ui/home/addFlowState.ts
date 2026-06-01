export type DetectedCategory = "Taste" | "Activity" | "Stay" | "Explore";

export type DetectedPlace = {
  id: string;
  runId: number;
  name: string;
  category: DetectedCategory;
  locality: string;
  source: string;
  imageUrl: string;
  fullAddress: string;
  videoUrl: string;
  placeId?: string | null;
  lat?: number | null;
  lng?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
};

export type IntelligenceEntity = {
  name?: string;
  category?: "eat" | "do" | "stay" | "see";
  locality?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  address?: string | null;
  placeId?: string | null;
  photoUrl?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export type PendingDetectionJob = {
  runId: number;
  jobId: string;
  startedAtMs: number;
  source: string;
  imageUrl: string;
  videoUrl: string;
};

export type PersistedAddDraft = {
  detectedPlaces: DetectedPlace[];
  selectedDetectedCategory: "Auto-detect" | DetectedCategory;
  selectedPreviewIndex: number;
  isPreviewVisible: boolean;
  linkInput: string;
  pendingJobs: PendingDetectionJob[];
};

export type AddReadyNotification = {
  id: string;
  runId: number;
  jobId: string;
  placeId: string;
  placeName: string;
  category: DetectedCategory;
  locality: string;
  source: string;
  imageUrl: string;
  createdAtMs: number;
};

export const ADD_DRAFT_STORAGE_KEY = "wr_add_detected_draft_v2";
export const CATEGORY_FEED_CACHE_KEY = "wr_category_saved_feed_v1";
export const ADD_READY_NOTIFICATIONS_KEY = "wr_add_ready_notifications_v1";
export const ADD_REVIEW_RUN_KEY = "wr_add_review_run_id_v1";
export const ADD_DRAFT_UPDATED_EVENT = "wr:add-draft-updated";
export const ADD_READY_UPDATED_EVENT = "wr:add-ready-updated";
export const ADD_PROCESSING_STARTED_EVENT = "wr:add-processing-started";

export const categoryFallbackImage: Record<DetectedCategory, string> = {
  Taste: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=1200",
  Activity: "https://images.unsplash.com/photo-1541625602330-2277a4c46182?auto=format&fit=crop&q=80&w=1200",
  Stay: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&q=80&w=1200",
  Explore: "https://images.unsplash.com/photo-1527631746610-bca00a040d60?auto=format&fit=crop&q=80&w=1200",
};

export function readPersistedAddDraft(): PersistedAddDraft | null {
  try {
    const raw = window.localStorage.getItem(ADD_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedAddDraft;
    return {
      detectedPlaces: Array.isArray(parsed.detectedPlaces) ? parsed.detectedPlaces : [],
      selectedDetectedCategory: parsed.selectedDetectedCategory || "Auto-detect",
      selectedPreviewIndex: parsed.selectedPreviewIndex || 0,
      isPreviewVisible: parsed.isPreviewVisible ?? true,
      linkInput: parsed.linkInput || "",
      pendingJobs: Array.isArray(parsed.pendingJobs) ? parsed.pendingJobs : [],
    };
  } catch {
    return null;
  }
}

export function writePersistedAddDraft(payload: PersistedAddDraft) {
  window.localStorage.setItem(ADD_DRAFT_STORAGE_KEY, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent(ADD_DRAFT_UPDATED_EVENT));
}

export function clearPersistedAddDraft() {
  window.localStorage.removeItem(ADD_DRAFT_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(ADD_DRAFT_UPDATED_EVENT));
}

export function readReadyNotifications(): AddReadyNotification[] {
  try {
    const raw = window.localStorage.getItem(ADD_READY_NOTIFICATIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeReadyNotifications(items: AddReadyNotification[]) {
  window.localStorage.setItem(ADD_READY_NOTIFICATIONS_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(ADD_READY_UPDATED_EVENT));
}

export function addReadyNotification(item: AddReadyNotification) {
  const current = readReadyNotifications();
  const withoutDup = current.filter((existing) => existing.id !== item.id && existing.runId !== item.runId);
  writeReadyNotifications([item, ...withoutDup].slice(0, 20));
}

export function removeReadyNotificationByRunId(runId: number) {
  writeReadyNotifications(readReadyNotifications().filter((item) => item.runId !== runId));
}

export function setReviewRunId(runId: number) {
  window.localStorage.setItem(ADD_REVIEW_RUN_KEY, String(runId));
  window.dispatchEvent(new CustomEvent(ADD_READY_UPDATED_EVENT));
}

export function consumeReviewRunId(): number | null {
  const raw = window.localStorage.getItem(ADD_REVIEW_RUN_KEY);
  window.localStorage.removeItem(ADD_REVIEW_RUN_KEY);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function peekReviewRunId(): number | null {
  const raw = window.localStorage.getItem(ADD_REVIEW_RUN_KEY);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function clearReviewRunId() {
  window.localStorage.removeItem(ADD_REVIEW_RUN_KEY);
}

export function mapCategory(category: IntelligenceEntity["category"]): DetectedCategory | null {
  if (category === "eat") return "Taste";
  if (category === "do") return "Activity";
  if (category === "stay") return "Stay";
  if (category === "see") return "Explore";
  return null;
}

export function mapEntitiesToPlaces(
  entities: IntelligenceEntity[],
  defaults: { source: string; imageUrl: string; videoUrl: string },
  runId: number,
): DetectedPlace[] {
  return entities
    .map<DetectedPlace | null>((entity, index) => {
      const mapped = mapCategory(entity.category);
      if (!mapped || !entity.name) return null;
      const locality = entity.locality || entity.city || entity.state || "Unknown locality";
      const fullAddress = entity.address || [entity.locality, entity.city, entity.state, entity.country].filter(Boolean).join(", ") || locality;
      return {
        id: `${mapped}-${entity.name}-${index}`.toLowerCase().replace(/\s+/g, "-"),
        runId,
        name: entity.name,
        category: mapped,
        locality,
        source: defaults.source,
        imageUrl: entity.photoUrl || defaults.imageUrl || categoryFallbackImage[mapped],
        fullAddress,
        videoUrl: defaults.videoUrl,
        placeId: entity.placeId ?? null,
        lat: entity.lat ?? null,
        lng: entity.lng ?? null,
        city: entity.city ?? null,
        state: entity.state ?? null,
        country: entity.country ?? null,
      };
    })
    .filter((value): value is DetectedPlace => value !== null);
}
