import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Link2, RefreshCw, Sparkles, X } from "lucide-react";
import { useUx } from "../layout/UxProvider";
import {
  ADD_DRAFT_UPDATED_EVENT,
  ADD_PROCESSING_STARTED_EVENT,
  addReadyNotification,
  categoryFallbackImage,
  clearReviewRunId,
  clearPersistedAddDraft,
  mapEntitiesToPlaces,
  peekReviewRunId,
  readPersistedAddDraft,
  removeReadyNotificationByRunId,
  writePersistedAddDraft,
  type DetectedCategory,
  type DetectedPlace,
  type IntelligenceEntity,
  type PendingDetectionJob,
} from "./addFlowState";
import { resolveEntityIntent } from "./intent";
import { upsertSavedPlace } from "./savedPlaces";
import {
  SHARED_INTENT_RECEIVED_EVENT,
  consumePendingSharedIntent,
  getSharedIntentPrefill,
} from "../../pwa/shareTarget";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
const AUTH_SESSION_UPDATED_EVENT = "wr:auth-session-updated";
const IS_DEV = import.meta.env.DEV;
const ADD_INTELLIGENCE_TIMEOUT_MS = 120000;
const MAX_PREVIEW_RETRIES = 2;
const ADD_ANALYTICS_ANONYMOUS_ID_KEY = "wr_add_analytics_anonymous_id_v1";
const LEGACY_ADD_STORAGE_KEYS = [
  "wandreel_add_url",
  "lastAnalyzedLink",
  "demoLink",
  "defaultUrl",
  "pastedUrl",
] as const;

type ExtractionApiResponse = {
  ok: boolean;
  metadata?: {
    platform?: "instagram" | "youtube" | "web";
    imageUrl?: string | null;
    canonicalUrl?: string;
    sourceUrl?: string;
    title?: string | null;
    description?: string | null;
  };
};

type ExtractionStreamEvent = {
  stage: string;
  message: string;
  elapsedMs: number;
  attemptNumber: number;
  result?: ExtractionApiResponse;
  error?: { error?: string };
};

type IntelligenceApiResponse = {
  ok: boolean;
  jobId?: string;
  output?: {
    structuredEntities?: IntelligenceEntity[];
  };
};

type PreviewCard =
  | {
      key: string;
      runId: number;
      sourceUrl: string;
      kind: "pending";
      pending: PendingDetectionJob;
      sortOrder: number;
    }
  | {
      key: string;
      runId: number;
      sourceUrl: string;
      kind: "resolved";
      place: DetectedPlace;
      sortOrder: number;
    };

const chipOrder: Array<"Auto-detect" | DetectedCategory> = ["Auto-detect", "Taste", "Activity", "Stay", "Explore"];
const STREAM_STAGE_COPY: Record<string, string> = {
  started: "Reading the link...",
  metadata_started: "Reading the link...",
  metadata_done: "Found the caption...",
  tiny_extractor_started: "Creating your card...",
  tiny_extractor_done: "Almost there...",
  accepted_description: "Found a strong match...",
  transcript_started: "Listening for place clues...",
  transcript_done: "Almost there...",
  frame_extraction_started: "Checking video frames...",
  frame_extraction_done: "Almost there...",
  ocr_started: "Reading on-screen text...",
  ocr_done: "Almost there...",
  visual_started: "Trying our best match...",
  visual_done: "Almost there...",
  completed: "Almost there...",
  failed: "Almost there...",
};

export function AddScreen() {
  const { isOffline, showToast, searchLocations } = useUx();
  const [linkInput, setLinkInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [selectedDetectedCategory, setSelectedDetectedCategory] = useState<"Auto-detect" | DetectedCategory>("Auto-detect");
  const [detectedPlaces, setDetectedPlaces] = useState<DetectedPlace[]>([]);
  const [activePreviewKey, setActivePreviewKey] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [savedPlaceIds, setSavedPlaceIds] = useState<Set<string>>(new Set());
  const [isEditing, setIsEditing] = useState(false);
  const [editingPlaceId, setEditingPlaceId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState<DetectedCategory>("Taste");
  const [editLocality, setEditLocality] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editPlaceId, setEditPlaceId] = useState<string | null>(null);
  const [editCoords, setEditCoords] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [locationSuggestions, setLocationSuggestions] = useState<Array<{ placeId: string; label: string; secondaryText: string | null; description: string | null }>>([]);
  const [isLocationSearching, setIsLocationSearching] = useState(false);
  const [pendingJobs, setPendingJobs] = useState<PendingDetectionJob[]>([]);
  const [queuedSharedLink, setQueuedSharedLink] = useState<string | null>(null);
  const [removingPlaceId, setRemovingPlaceId] = useState<string | null>(null);
  const [autoSelectFirstSuggestion, setAutoSelectFirstSuggestion] = useState(true);
  const [analysisStageCopy, setAnalysisStageCopy] = useState("Analyzing link...");
  const [analysisElapsedSeconds, setAnalysisElapsedSeconds] = useState(0);
  const analyzeRunRef = useRef(0);
  const analysisTimerRef = useRef<number | null>(null);
  const analysisStartedAtRef = useRef<number | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const locationDebounceTimerRef = useRef<number | null>(null);
  const detectedPlacesRef = useRef<DetectedPlace[]>([]);
  const pendingJobsRef = useRef<PendingDetectionJob[]>([]);
  const isResolvingFinal = pendingJobs.length > 0;
  const getAnalyticsAnonymousId = () => {
    let existing = window.localStorage.getItem(ADD_ANALYTICS_ANONYMOUS_ID_KEY);
    if (existing) return existing;
    existing = `anon-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(ADD_ANALYTICS_ANONYMOUS_ID_KEY, existing);
    return existing;
  };

  const postReelAnalyticsEvent = async (input: {
    clientRunId: string;
    attemptNumber?: number | null;
    eventName: "saved" | "edited" | "discarded";
    sourceUrl?: string | null;
    sourcePlatform?: string | null;
    entityIndex?: number | null;
    finalPlaceId?: string | null;
    payload?: Record<string, unknown>;
  }) => {
    try {
      await fetch(`${API_BASE_URL}/api/analytics/reel-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          clientRunId: input.clientRunId,
          anonymousId: getAnalyticsAnonymousId(),
          attemptNumber: input.attemptNumber ?? null,
          eventName: input.eventName,
          sourceUrl: input.sourceUrl ?? null,
          sourcePlatform: input.sourcePlatform ?? null,
          entityIndex: input.entityIndex ?? null,
          finalPlaceId: input.finalPlaceId ?? null,
          payload: input.payload ?? {},
        }),
      });
    } catch {
      // Analytics should never block the user flow.
    }
  };
  const logAddScreenState = (label: string) => {
    if (!IS_DEV) return;
    console.log(label, {
      url: linkInput,
      hasAnalyzed,
      detectedPlaces,
      source: "AddScreen",
      viewport: window.innerWidth,
      storageUrl: window.localStorage.getItem("wandreel_add_url"),
      lastAnalyzedLink: window.localStorage.getItem("lastAnalyzedLink"),
      persistedDraft: window.localStorage.getItem("wr_add_detected_draft_v2"),
    });
  };

  const clearLegacyAddStorage = () => {
    for (const key of LEGACY_ADD_STORAGE_KEYS) {
      window.localStorage.removeItem(key);
    }
  };

  const restoreDraftState = (draft: {
    detectedPlaces: DetectedPlace[];
    selectedDetectedCategory: "Auto-detect" | DetectedCategory;
    isPreviewVisible: boolean;
    linkInput: string;
      pendingJobs: PendingDetectionJob[];
  }) => {
    setLinkInput(draft.linkInput || "");
    setHasAnalyzed(draft.detectedPlaces.length > 0 || draft.pendingJobs.length > 0);
    setSelectedDetectedCategory(draft.pendingJobs.length > 0 ? "Auto-detect" : draft.selectedDetectedCategory || "Auto-detect");
    setDetectedPlaces(Array.isArray(draft.detectedPlaces) ? draft.detectedPlaces : []);
    setActivePreviewKey(
      draft.pendingJobs[0] ? `pending-${draft.pendingJobs[0].runId}` : draft.detectedPlaces[0]?.id ?? null,
    );
    setPendingJobs(Array.isArray(draft.pendingJobs) ? draft.pendingJobs : []);
    setIsAnalyzing(false);
  };

  const resetAddFlowState = (options?: { clearPersisted?: boolean }) => {
    analyzeRunRef.current = Date.now();
    if (analysisTimerRef.current) {
      window.clearInterval(analysisTimerRef.current);
      analysisTimerRef.current = null;
    }
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    analysisStartedAtRef.current = null;
    setLinkInput("");
    setIsAnalyzing(false);
    setAnalysisStageCopy("Analyzing link...");
    setAnalysisElapsedSeconds(0);
    setHasAnalyzed(false);
    setSelectedDetectedCategory("Auto-detect");
    setDetectedPlaces([]);
    setActivePreviewKey(null);
    setSaveMessage("");
    setSavedPlaceIds(new Set());
    setIsEditing(false);
    setEditingPlaceId(null);
    setEditName("");
    setEditCategory("Taste");
    setEditLocality("");
    setEditAddress("");
    setEditPlaceId(null);
    setEditCoords({ lat: null, lng: null });
    setLocationSuggestions([]);
    setIsLocationSearching(false);
    setPendingJobs([]);
    setRemovingPlaceId(null);
    setAutoSelectFirstSuggestion(true);
    if (options?.clearPersisted ?? true) {
      clearReviewRunId();
      clearPersistedAddDraft();
      clearLegacyAddStorage();
    }
  };

  const startAnalysisProgress = (message = "Reading the link...") => {
    if (analysisTimerRef.current) {
      window.clearInterval(analysisTimerRef.current);
    }
    analysisStartedAtRef.current = Date.now();
    setAnalysisStageCopy(message);
    setAnalysisElapsedSeconds(0);
    analysisTimerRef.current = window.setInterval(() => {
      const startedAt = analysisStartedAtRef.current;
      if (!startedAt) return;
      setAnalysisElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
  };

  const stopAnalysisProgress = () => {
    if (analysisTimerRef.current) {
      window.clearInterval(analysisTimerRef.current);
      analysisTimerRef.current = null;
    }
    analysisStartedAtRef.current = null;
  };

  const syncAnalysisProgressFromEvent = (event: ExtractionStreamEvent) => {
    setAnalysisStageCopy(STREAM_STAGE_COPY[event.stage] || "Analyzing link...");
    if (typeof event.elapsedMs === "number") {
      setAnalysisElapsedSeconds(Math.max(0, Math.floor(event.elapsedMs / 1000)));
    }
  };

  useEffect(() => {
    detectedPlacesRef.current = detectedPlaces;
  }, [detectedPlaces]);

  useEffect(() => {
    pendingJobsRef.current = pendingJobs;
  }, [pendingJobs]);

  useEffect(() => () => {
    stopAnalysisProgress();
    streamAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!saveMessage) return;
    const timer = window.setTimeout(() => setSaveMessage(""), 1800);
    return () => window.clearTimeout(timer);
  }, [saveMessage]);

  const categoryCounts = useMemo(() => {
    const base: Record<DetectedCategory, number> = { Taste: 0, Activity: 0, Stay: 0, Explore: 0 };
    for (const item of detectedPlaces) base[item.category] += 1;
    return { total: detectedPlaces.length, ...base };
  }, [detectedPlaces]);
  const previewCards = useMemo<PreviewCard[]>(() => {
    const resolvedCards = detectedPlaces
      .filter((item) => selectedDetectedCategory === "Auto-detect" || item.category === selectedDetectedCategory)
      .map((place, index) => ({
        key: place.id,
        runId: place.runId,
        sourceUrl: place.sourceUrl,
        kind: "resolved" as const,
        place,
        sortOrder: (place.runId * 1000) - index,
      }));

    const loadingCards =
      selectedDetectedCategory === "Auto-detect"
        ? pendingJobs.map((pending) => ({
            key: `pending-${pending.runId}`,
            runId: pending.runId,
            sourceUrl: pending.sourceUrl,
            kind: "pending" as const,
            pending,
            sortOrder: pending.runId * 1000 + 999,
          }))
        : [];

    return [...loadingCards, ...resolvedCards].sort((left, right) => right.sortOrder - left.sortOrder);
  }, [detectedPlaces, pendingJobs, selectedDetectedCategory]);

  const shouldShowDetectedSection = previewCards.length > 0 || (hasAnalyzed && !isAnalyzing);
  const autoDetectCount = detectedPlaces.length + pendingJobs.length;

  const activePreviewCard = useMemo(
    () => previewCards.find((card) => card.key === activePreviewKey) ?? previewCards[0] ?? null,
    [activePreviewKey, previewCards],
  );
  const editingPlace = useMemo(
    () => detectedPlaces.find((item) => item.id === editingPlaceId) ?? null,
    [detectedPlaces, editingPlaceId],
  );

  useEffect(() => {
    if (!previewCards.length) {
      setActivePreviewKey(null);
      return;
    }
    if (activePreviewKey === null || !previewCards.some((card) => card.key === activePreviewKey)) {
      setActivePreviewKey(previewCards[0].key);
    }
  }, [activePreviewKey, previewCards]);

  useEffect(() => {
    if (!editingPlace) return;
    if (!isEditing) {
      setEditName(editingPlace.name);
      setEditCategory(editingPlace.category);
      setEditLocality(editingPlace.locality);
      setEditAddress(editingPlace.fullAddress);
      setEditPlaceId(editingPlace.placeId ?? null);
      setEditCoords({ lat: editingPlace.lat ?? null, lng: editingPlace.lng ?? null });
    }
  }, [editingPlace, isEditing]);

  useEffect(() => {
    if (!isEditing) return;
    const query = editName.trim();
    if (query.length < 3) {
      setLocationSuggestions([]);
      return;
    }
    let cancelled = false;
    // Clear previous debounce timer
    if (locationDebounceTimerRef.current) {
      window.clearTimeout(locationDebounceTimerRef.current);
    }
    locationDebounceTimerRef.current = window.setTimeout(() => {
      setIsLocationSearching(true);
      void searchLocations(query)
        .then((items) => {
          if (!cancelled) {
            setLocationSuggestions(items.slice(0, 4));
            // Auto-select and populate the first suggestion
            if (autoSelectFirstSuggestion && items.length > 0) {
              const firstItem = items[0];
              setEditPlaceId(firstItem.placeId);
              setEditLocality(firstItem.label);
              setEditAddress(firstItem.description || firstItem.secondaryText || firstItem.label);
              // Auto-fetch coordinates if available (via resolve-place API)
              if (firstItem.placeId) {
                void fetch(`${API_BASE_URL}/api/location/resolve-place?placeId=${encodeURIComponent(firstItem.placeId)}`)
                  .then(res => res.json())
                  .then(data => {
                    const lat = data?.location?.lat;
                    const lng = data?.location?.lng;
                    if (!cancelled && typeof lat === "number" && typeof lng === "number") {
                      setEditCoords({ lat, lng });
                    }
                  })
                  .catch(() => {
                    // Ignore fetch errors
                  });
              }
              setAutoSelectFirstSuggestion(false); // Disable auto-select after first use
            }
          }
        })
        .catch(() => {
          if (!cancelled) setLocationSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setIsLocationSearching(false);
        });
    }, 400); // Reduced debounce time for better responsiveness
    return () => {
      cancelled = true;
      if (locationDebounceTimerRef.current) {
        window.clearTimeout(locationDebounceTimerRef.current);
      }
    };
  }, [autoSelectFirstSuggestion, editName, isEditing, searchLocations]);

  // Reset auto-select flag when edit modal opens
  useEffect(() => {
    if (isEditing) {
      setAutoSelectFirstSuggestion(true);
    }
  }, [isEditing]);

  useEffect(() => {
    const draft = readPersistedAddDraft();
    const shouldRestore = Boolean(draft && (draft.detectedPlaces.length > 0 || draft.pendingJobs.length > 0 || peekReviewRunId() !== null));
    if (draft && shouldRestore) {
      restoreDraftState(draft);
    } else {
      resetAddFlowState({ clearPersisted: true });
    }
    if (IS_DEV) {
      console.debug("AddScreen mounted", {
        url: shouldRestore ? draft?.linkInput || "" : "",
        hasAnalyzed: shouldRestore ? Boolean((draft?.detectedPlaces.length || 0) > 0 || (draft?.pendingJobs.length || 0) > 0) : false,
        detectedPlaces: shouldRestore ? draft?.detectedPlaces || [] : [],
        source: "AddScreen",
        viewport: window.innerWidth,
        storageUrl: window.localStorage.getItem("wandreel_add_url"),
        lastAnalyzedLink: window.localStorage.getItem("lastAnalyzedLink"),
        persistedDraft: window.localStorage.getItem("wr_add_detected_draft_v2"),
      });
    }
  }, []);

  useEffect(() => () => {
    clearReviewRunId();
    clearLegacyAddStorage();
  }, []);

  useEffect(() => {
    const syncFromStorage = () => {
      const draft = readPersistedAddDraft();
      if (!draft) return;
      const shouldApply = draft.detectedPlaces.length > 0 || draft.pendingJobs.length > 0 || pendingJobs.length > 0 || peekReviewRunId() !== null;
      if (!shouldApply) return;
      restoreDraftState(draft);
    };
    window.addEventListener(ADD_DRAFT_UPDATED_EVENT, syncFromStorage);
    return () => window.removeEventListener(ADD_DRAFT_UPDATED_EVENT, syncFromStorage);
  }, [pendingJobs.length]);

  useEffect(() => {
    const handleAuthReset = () => {
      resetAddFlowState({ clearPersisted: true });
      logAddScreenState("AddScreen auth reset");
    };
    window.addEventListener(AUTH_SESSION_UPDATED_EVENT, handleAuthReset);
    return () => window.removeEventListener(AUTH_SESSION_UPDATED_EVENT, handleAuthReset);
  }, []);

  useEffect(() => {
    if (isAnalyzing || !queuedSharedLink) return;
    const nextSharedLink = queuedSharedLink;
    setQueuedSharedLink(null);
    void runAnalysis(nextSharedLink);
  }, [isAnalyzing, queuedSharedLink]);

  const sourceLabelFromPlatform = (platform?: string) => {
    if (platform === "instagram") return "Instagram Reel";
    if (platform === "youtube") return "YouTube Video";
    return "Web Link";
  };

  const formatPreviewLocation = (place: DetectedPlace) => {
    return [place.locality, place.city].filter(Boolean).join(", ") || place.locality || "Unknown locality";
  };

  const formatConfidenceLabel = (confidence?: DetectedPlace["confidence"]) => {
    if (!confidence) return null;
    return `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)} confidence`;
  };

  const formatEvidenceText = (place: DetectedPlace) => {
    const evidence = String(place.evidenceText || "").trim();
    if (!evidence) return "Needs review before saving.";
    return evidence.length > 120 ? `${evidence.slice(0, 117)}...` : evidence;
  };

  const isNeedsManualReview = (place: DetectedPlace) => {
    const normalizedName = place.name.trim().toLowerCase();
    const normalizedLocality = place.locality.trim().toLowerCase();
    const hasEvidence = Boolean(String(place.evidenceText || "").trim());
    return (
      normalizedName === "detected place" ||
      normalizedLocality === "unknown locality" ||
      (!place.placeId && !hasEvidence)
    );
  };

  const getRetryCountLabel = (retryCount: number) => {
    if (retryCount <= 0) return null;
    return `Retry ${Math.min(retryCount, MAX_PREVIEW_RETRIES)} of ${MAX_PREVIEW_RETRIES}`;
  };

  const getCardRetryCount = (card: PreviewCard) => (
    card.kind === "pending"
      ? card.pending.retryCount
      : card.place.retryCount ?? 0
  );

  const hasRetrySlotsLeft = (retryCount: number) => retryCount < MAX_PREVIEW_RETRIES;

  const inferDraftCategory = (text: string): DetectedCategory => {
    const normalized = text.toLowerCase();
    if (/(restaurant|cafe|café|biryani|bakery|breakfast|lunch|dinner|chai|dessert|kitchen|food|eatery)/i.test(normalized)) {
      return "Taste";
    }
    if (/(hotel|resort|homestay|hostel|villa|stay|room|suite|retreat stay)/i.test(normalized)) {
      return "Stay";
    }
    if (/(event|show|concert|workshop|class|ride|karting|boating|zipline|sports arena|activity zone)/i.test(normalized)) {
      return "Activity";
    }
    if (/(hill|hills|viewpoint|fort|waterfall|lake|beach|temple|park|museum|palace|monument|trail|nature|sunrise|sunset|trek|trekking|camping|scenic|clouds|tourist|landmark)/i.test(normalized)) {
      return "Explore";
    }
    return "Explore";
  };

  const inferDraftName = (rawTitle: string, rawDesc: string) => {
    const sanitizedTitle = rawTitle.replace(/\s+/g, " ").trim();
    if (sanitizedTitle && sanitizedTitle.toLowerCase() !== "untitled" && !/(^@)|(^follow\s+@)|(@\w+)/i.test(sanitizedTitle)) {
      return sanitizedTitle.slice(0, 80);
    }

    const descHint = rawDesc
      .split(/\n|[.!?]/)
      .map((line) => line.trim())
      .find((line) => line.length > 3) || "";

    const placePrefix =
      descHint.match(/^([A-Z][A-Za-z0-9&' -]{2,60}?)(?:\s+is\b|\s+-\s+|\s+offers\b|\s+has\b)/)?.[1]?.trim() ||
      descHint.match(/^([A-Z][A-Za-z0-9&' -]{2,60})/)?.[1]?.trim() ||
      "";

    const candidateName = placePrefix || descHint || "Detected place";
    return /(^@)|(^follow\s+@)|(@\w+)/i.test(candidateName) ? "Detected place" : candidateName.slice(0, 80);
  };

  const toDraftPlace = (
    extraction: ExtractionApiResponse,
    runId: number,
    sourceUrl: string,
    retryCount = 0,
  ): DetectedPlace => {
    const platformSource = sourceLabelFromPlatform(extraction.metadata?.platform);
    const rawTitle = extraction.metadata?.title?.trim() || "";
    const rawDesc = extraction.metadata?.description?.trim() || "";
    const draftCategory = inferDraftCategory(`${rawTitle} ${rawDesc}`);
    const imageUrl = extraction.metadata?.imageUrl || categoryFallbackImage[draftCategory];
    const draftName = inferDraftName(rawTitle, rawDesc);

    return {
      id: `draft-${Date.now()}`,
      runId,
      sourceUrl,
      retryCount,
      name: draftName,
      category: draftCategory,
      locality: "Resolving locality...",
      source: platformSource,
      imageUrl,
      fullAddress: "Resolving full address...",
      videoUrl: extraction.metadata?.canonicalUrl || extraction.metadata?.sourceUrl || linkInput.trim(),
      confidence: null,
      evidenceText: null,
      intent: null,
      placeId: null,
      lat: null,
      lng: null,
      city: null,
      state: null,
      country: null,
    };
  };

  const syncDraftState = (
    nextPlaces: DetectedPlace[],
    nextPendingJobs: PendingDetectionJob[],
    nextLinkInput: string,
  ) => {
    setDetectedPlaces(nextPlaces);
    setPendingJobs(nextPendingJobs);
    setHasAnalyzed(nextPlaces.length > 0 || nextPendingJobs.length > 0);
    if (nextPlaces.length > 0 || nextPendingJobs.length > 0 || nextLinkInput.trim()) {
      writePersistedAddDraft({
        detectedPlaces: nextPlaces,
        selectedDetectedCategory: "Auto-detect",
        selectedPreviewIndex: 0,
        isPreviewVisible: true,
        linkInput: nextLinkInput,
        pendingJobs: nextPendingJobs,
      });
      return;
    }
    clearPersistedAddDraft();
  };

  const replaceRunPlaces = (places: DetectedPlace[], runId: number, replacements: DetectedPlace[] = []) => [
    ...replacements,
    ...places.filter((item) => item.runId !== runId),
  ];

  const upsertPendingJob = (jobs: PendingDetectionJob[], pendingJob: PendingDetectionJob) => [
    pendingJob,
    ...jobs.filter((item) => item.runId !== pendingJob.runId),
  ];

  const publishSavedToCategoryFeed = (place: DetectedPlace) => {
    const intent = resolveEntityIntent({
      category: place.category,
      intent: place.intent ?? null,
      title: place.name,
      evidenceText: place.evidenceText ?? null,
    });
    upsertSavedPlace({
      id: `${place.category}-${place.placeId || place.id}`.toLowerCase(),
      placeId: place.placeId || place.id,
      title: place.name,
      category: place.category,
      distanceKm: 0.1,
      metaPrimary: intent.l2,
      metaSecondary: intent.l3[0] || "",
      locality: place.locality,
      city: place.city ?? null,
      state: place.state ?? null,
      country: place.country ?? null,
      fullAddress: place.fullAddress,
      videoUrl: place.videoUrl,
      imageUrl: place.imageUrl,
      tags: ["Saved", "Visited"],
      intent,
      lat: place.lat ?? null,
      lng: place.lng ?? null,
      createdAtMs: Date.now(),
    });
  };

  const removeDetectedWithAnimation = (place: DetectedPlace) => {
    setRemovingPlaceId(place.id);
    window.setTimeout(() => {
      const nextPlaces = detectedPlacesRef.current.filter((item) => item.id !== place.id);
      const nextPendingJobs = pendingJobsRef.current.filter((job) => job.runId !== place.runId);
      const willBeEmpty = nextPlaces.length === 0 && nextPendingJobs.length === 0;
      syncDraftState(nextPlaces, nextPendingJobs, willBeEmpty ? "" : linkInput);
      removeReadyNotificationByRunId(place.runId);
      setSavedPlaceIds((prev) => {
        if (!prev.has(place.id)) return prev;
        const next = new Set(prev);
        next.delete(place.id);
        return next;
      });
      setIsEditing(false);
      setEditingPlaceId(null);
      setRemovingPlaceId(null);
      if (willBeEmpty) {
        resetAddFlowState({ clearPersisted: true });
      }
    }, 260);
  };

  const extractWithStreaming = async (input: {
    runId: number;
    normalizedSourceUrl: string;
    retryCount: number;
    isRetry: boolean;
  }): Promise<ExtractionApiResponse> => {
    const controller = new AbortController();
    streamAbortRef.current = controller;
    const response = await fetch(`${API_BASE_URL}/api/metadata/extract/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: input.normalizedSourceUrl,
        mode: "deep",
        analytics: {
          clientRunId: String(input.runId),
          anonymousId: getAnalyticsAnonymousId(),
          attemptNumber: input.retryCount + 1,
          triggerType: input.isRetry ? "retry" : "initial",
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body || !String(response.headers.get("content-type") || "").includes("text/event-stream")) {
      throw new Error("stream_unavailable");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult: ExtractionApiResponse | null = null;

    const processChunk = (chunk: string) => {
      const blocks = chunk.split("\n\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const lines = block.split(/\r?\n/);
        let eventName = "message";
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }
        if (!dataLines.length) continue;
        const payload = JSON.parse(dataLines.join("\n")) as ExtractionStreamEvent;
        if (analyzeRunRef.current !== input.runId) {
          controller.abort();
          return;
        }
        syncAnalysisProgressFromEvent(payload);
        if (eventName === "completed" || payload.stage === "completed") {
          finalResult = payload.result || null;
        }
        if (eventName === "failed" || payload.stage === "failed") {
          throw new Error(payload.error?.error || "stream_failed");
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      processChunk(decoder.decode(value, { stream: true }));
      if (finalResult) {
        break;
      }
    }

    if (!finalResult && buffer.trim()) {
      processChunk(`${buffer}\n\n`);
    }
    streamAbortRef.current = null;
    const resolvedResult = finalResult as ExtractionApiResponse | null;
    if (!resolvedResult || !resolvedResult.ok) {
      throw new Error("stream_incomplete");
    }
    return resolvedResult;
  };

  const runAnalysis = async (sourceUrl: string, options?: { runId?: number; isRetry?: boolean }) => {
    if (isAnalyzing) return;
    if (isOffline) {
      showToast({ message: "This link could not be analyzed.", variant: "error" });
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(sourceUrl.trim());
    } catch {
      showToast({ message: "This link could not be analyzed.", variant: "error" });
      return;
    }
    if (!/^https?:$/i.test(parsedUrl.protocol)) {
      showToast({ message: "This link could not be analyzed.", variant: "error" });
      return;
    }

    const normalizedSourceUrl = sourceUrl.trim();
    const existingPending = pendingJobsRef.current.find(
      (item) => item.sourceUrl === normalizedSourceUrl && item.runId !== options?.runId,
    );
    if (existingPending) {
      setActivePreviewKey(`pending-${existingPending.runId}`);
      setSelectedDetectedCategory("Auto-detect");
      showToast({ message: "This link is already being analyzed.", variant: "info" });
      return;
    }

    const runId = options?.runId ?? Date.now();
    const existingPlacesForRun = detectedPlacesRef.current.filter((item) => item.runId === runId);
    const existingPlace = existingPlacesForRun[0] ?? null;
    const existingPendingForRun = pendingJobsRef.current.find((item) => item.runId === runId) ?? null;
    const existingRetryCount = Math.max(
      existingPendingForRun?.retryCount ?? 0,
      ...existingPlacesForRun.map((item) => item.retryCount ?? 0),
      existingPlace?.retryCount ?? 0,
    );
    const retryCount = options?.isRetry ? existingRetryCount + 1 : existingRetryCount;
    if (options?.isRetry && retryCount > MAX_PREVIEW_RETRIES) {
      showToast({ message: "Please edit the details manually from here.", variant: "info" });
      return;
    }
    const fallbackPlace: DetectedPlace =
      existingPlace ?? {
        id: `fallback-${runId}`,
        runId,
        sourceUrl: normalizedSourceUrl,
        retryCount,
        name: "Detected place",
        category: inferDraftCategory(normalizedSourceUrl),
        locality: "Unknown locality",
        source: "Web Link",
        imageUrl: categoryFallbackImage.Explore,
        fullAddress: "Unknown locality",
        videoUrl: normalizedSourceUrl,
        confidence: null,
        evidenceText: null,
        intent: null,
        placeId: null,
        lat: null,
        lng: null,
        city: null,
        state: null,
        country: null,
      };
    const nextFallbackPlace = {
      ...fallbackPlace,
      sourceUrl: normalizedSourceUrl,
      retryCount,
      videoUrl: normalizedSourceUrl,
    };

    analyzeRunRef.current = runId;
    window.dispatchEvent(new CustomEvent(ADD_PROCESSING_STARTED_EVENT));
    setIsAnalyzing(true);
    startAnalysisProgress("Reading the link...");
    setSaveMessage("");
    setSelectedDetectedCategory("Auto-detect");
    setActivePreviewKey(`pending-${runId}`);
    setLinkInput(normalizedSourceUrl);

    const startedAt = Date.now();
    const pendingDraft: PendingDetectionJob = {
      runId,
      jobId: "",
      startedAtMs: startedAt,
      sourceUrl: normalizedSourceUrl,
      retryCount,
      isRetrying: Boolean(options?.isRetry),
      source: nextFallbackPlace.source,
      imageUrl: nextFallbackPlace.imageUrl,
      videoUrl: normalizedSourceUrl,
      fallbackPlace: nextFallbackPlace,
    };

    const nextDraftPlaces = replaceRunPlaces(detectedPlacesRef.current, runId);
    const nextDraftPendingJobs = upsertPendingJob(pendingJobsRef.current, pendingDraft);
    syncDraftState(nextDraftPlaces, nextDraftPendingJobs, normalizedSourceUrl);

    try {
      let extraction: ExtractionApiResponse;
      try {
        extraction = await extractWithStreaming({
          runId,
          normalizedSourceUrl,
          retryCount,
          isRetry: Boolean(options?.isRetry),
        });
      } catch {
        setAnalysisStageCopy("Almost there...");
        const extractionResponse = await fetch(`${API_BASE_URL}/api/metadata/extract`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: normalizedSourceUrl,
            mode: "deep",
            analytics: {
              clientRunId: String(runId),
              anonymousId: getAnalyticsAnonymousId(),
              attemptNumber: retryCount + 1,
              triggerType: options?.isRetry ? "retry" : "initial",
            },
          }),
        });
        extraction = (await extractionResponse.json()) as ExtractionApiResponse;
        if (!extractionResponse.ok || !extraction?.ok) throw new Error("extraction_failed");
      }

      if (analyzeRunRef.current !== runId) return;
      stopAnalysisProgress();

      const draftPlace = toDraftPlace(extraction, runId, normalizedSourceUrl, retryCount);
      const extractionPendingJob: PendingDetectionJob = {
        ...pendingDraft,
        source: sourceLabelFromPlatform(extraction.metadata?.platform),
        imageUrl: extraction.metadata?.imageUrl || categoryFallbackImage[draftPlace.category],
        videoUrl: extraction.metadata?.canonicalUrl || extraction.metadata?.sourceUrl || normalizedSourceUrl,
        fallbackPlace: draftPlace,
      };
      syncDraftState(
        replaceRunPlaces(detectedPlacesRef.current, runId),
        upsertPendingJob(pendingJobsRef.current, extractionPendingJob),
        normalizedSourceUrl,
      );

      const intelligenceResponse = await fetch(`${API_BASE_URL}/api/intelligence/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: extraction,
          mode: "draft_async",
          analytics: {
            clientRunId: String(runId),
            anonymousId: getAnalyticsAnonymousId(),
            attemptNumber: retryCount + 1,
            triggerType: options?.isRetry ? "retry" : "initial",
          },
        }),
      });
      const intelligence = (await intelligenceResponse.json()) as IntelligenceApiResponse;
      if (analyzeRunRef.current !== runId) return;
      if (!intelligenceResponse.ok || !intelligence?.ok) throw new Error("intelligence_failed");

      const entities = intelligence.output?.structuredEntities ?? [];
      const resolvedPlaces = mapEntitiesToPlaces(
        entities,
        {
          source: sourceLabelFromPlatform(extraction.metadata?.platform),
          imageUrl: extraction.metadata?.imageUrl || categoryFallbackImage[draftPlace.category],
          videoUrl: extraction.metadata?.canonicalUrl || extraction.metadata?.sourceUrl || normalizedSourceUrl,
          sourceUrl: normalizedSourceUrl,
          retryCount,
        },
        runId,
      );

      const jobId = intelligence.jobId || null;
      if (!jobId) {
        const finalizedPlaces = resolvedPlaces.length ? resolvedPlaces : [draftPlace];
        syncDraftState(
          replaceRunPlaces(detectedPlacesRef.current, runId, finalizedPlaces),
          pendingJobsRef.current.filter((item) => item.runId !== runId),
          "",
        );
        setIsAnalyzing(false);
        showToast({ message: "Link analyzed", variant: "success" });
        return;
      }

      const queuedPendingJob: PendingDetectionJob = {
        ...extractionPendingJob,
        jobId,
      };
      syncDraftState(
        replaceRunPlaces(detectedPlacesRef.current, runId),
        upsertPendingJob(pendingJobsRef.current, queuedPendingJob),
        normalizedSourceUrl,
      );
      setIsAnalyzing(false);
    } catch {
      if (analyzeRunRef.current !== runId) return;
      stopAnalysisProgress();
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      syncDraftState(
        replaceRunPlaces(detectedPlacesRef.current, runId, [fallbackPlace]),
        pendingJobsRef.current.filter((item) => item.runId !== runId),
        "",
      );
      setIsAnalyzing(false);
      showToast({ message: "This link could not be analyzed.", variant: "error" });
    }
  };

  useEffect(() => {
    let cancelled = false;
    let isPolling = false;

    const pollPendingJobs = async () => {
      if (isPolling || !pendingJobsRef.current.length) return;
      isPolling = true;

      try {
        let nextPlaces = detectedPlacesRef.current;
        let nextPendingJobs = pendingJobsRef.current;
        let didChange = false;

        for (const pending of pendingJobsRef.current) {
          if (!pending.jobId) continue;

          try {
            const response = await fetch(`${API_BASE_URL}/api/intelligence/jobs/${pending.jobId}`);
            const payload = await response.json();
            const job = payload?.job;
            if (!response.ok || !job) continue;

            if (job.status === "completed") {
              const entities = (job.result?.output?.structuredEntities || []) as IntelligenceEntity[];
              const resolvedPlaces = mapEntitiesToPlaces(
                entities,
                {
                  source: pending.source,
                  imageUrl: pending.imageUrl,
                  videoUrl: pending.videoUrl,
                  sourceUrl: pending.sourceUrl,
                  retryCount: pending.retryCount,
                },
                pending.runId,
              );
              nextPlaces = replaceRunPlaces(nextPlaces, pending.runId, resolvedPlaces.length ? resolvedPlaces : [pending.fallbackPlace]);
              nextPendingJobs = nextPendingJobs.filter((item) => item.jobId !== pending.jobId);
              didChange = true;

              const readyPlace = resolvedPlaces[0] || pending.fallbackPlace;
              addReadyNotification({
                id: `ready-${pending.jobId}`,
                runId: pending.runId,
                jobId: pending.jobId,
                placeId: readyPlace.placeId || readyPlace.id,
                placeName: readyPlace.name,
                category: readyPlace.category,
                locality: readyPlace.locality,
                source: readyPlace.source,
                imageUrl: readyPlace.imageUrl,
                createdAtMs: Date.now(),
              });
            } else if (job.status === "failed" || Date.now() - pending.startedAtMs >= ADD_INTELLIGENCE_TIMEOUT_MS) {
              nextPlaces = replaceRunPlaces(nextPlaces, pending.runId, [pending.fallbackPlace]);
              nextPendingJobs = nextPendingJobs.filter((item) => item.jobId !== pending.jobId);
              didChange = true;
            }
          } catch {
            if (Date.now() - pending.startedAtMs >= ADD_INTELLIGENCE_TIMEOUT_MS) {
              nextPlaces = replaceRunPlaces(nextPlaces, pending.runId, [pending.fallbackPlace]);
              nextPendingJobs = nextPendingJobs.filter((item) => item.jobId !== pending.jobId);
              didChange = true;
            }
          }
        }

        if (!cancelled && didChange) {
          syncDraftState(nextPlaces, nextPendingJobs, nextPendingJobs.length ? linkInput : "");
          setSelectedDetectedCategory("Auto-detect");
        }
      } finally {
        isPolling = false;
      }
    };

    void pollPendingJobs();
    const intervalId = window.setInterval(() => void pollPendingJobs(), 1800);
    const onResume = () => void pollPendingJobs();
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
    };
  }, [linkInput]);

  useEffect(() => {
    let cancelled = false;

    const consumeSharedIntentIntoAdd = async () => {
      const sharedIntent = await consumePendingSharedIntent();
      if (!sharedIntent || cancelled) return;

      const nextInput = getSharedIntentPrefill(sharedIntent);
      if (!nextInput) return;

      if (IS_DEV) {
        console.debug("[share-target] Add consumed shared intent", {
          intentId: sharedIntent.intentId,
          extractedUrl: sharedIntent.extractedUrl || null,
          prefill: nextInput,
        });
      }

      setLinkInput(nextInput);
      setSelectedDetectedCategory("Auto-detect");
      showToast({ message: "Added from share", variant: "success" });

      if (!sharedIntent.extractedUrl) {
        showToast({ message: "Couldn’t find a shareable link. Check the text before analyzing.", variant: "info" });
        return;
      }

      if (isAnalyzing) {
        setQueuedSharedLink(sharedIntent.extractedUrl);
        return;
      }

      void runAnalysis(sharedIntent.extractedUrl);
    };

    void consumeSharedIntentIntoAdd();

    const handleSharedIntent = () => {
      void consumeSharedIntentIntoAdd();
    };

    window.addEventListener(SHARED_INTENT_RECEIVED_EVENT, handleSharedIntent);
    return () => {
      cancelled = true;
      window.removeEventListener(SHARED_INTENT_RECEIVED_EVENT, handleSharedIntent);
    };
  }, [isAnalyzing, showToast]);

  const handleAnalyze = async () => {
    if (!linkInput.trim()) return;
    await runAnalysis(linkInput.trim());
  };

  const handleCategorySelect = (next: "Auto-detect" | DetectedCategory) => {
    setSelectedDetectedCategory(next);
  };

  const handleApplyEdit = () => {
    if (!editingPlace) return;
    const name = editName.trim();
    const locality = editLocality.trim();
    const fullAddress = editAddress.trim();
    if (!name || !locality) {
      showToast({ message: "Name and locality are required.", variant: "error" });
      return;
    }
    const nextPlaces = detectedPlacesRef.current.map((item) => (item.id === editingPlace.id ? {
      ...item,
      name,
      category: editCategory,
      locality,
      fullAddress: fullAddress || item.fullAddress,
      placeId: editPlaceId ?? item.placeId ?? null,
      lat: editCoords.lat ?? item.lat ?? null,
      lng: editCoords.lng ?? item.lng ?? null,
    } : item));
    syncDraftState(nextPlaces, pendingJobsRef.current, linkInput);
    void postReelAnalyticsEvent({
      clientRunId: String(editingPlace.runId),
      attemptNumber: (editingPlace.retryCount ?? 0) + 1,
      eventName: "edited",
      sourceUrl: editingPlace.sourceUrl,
      sourcePlatform: editingPlace.source,
      entityIndex: editingPlace.entityIndex ?? null,
      finalPlaceId: editPlaceId ?? editingPlace.placeId ?? null,
      payload: {
        category: editCategory,
        hasPlaceId: Boolean(editPlaceId ?? editingPlace.placeId),
        entityIndex: editingPlace.entityIndex ?? null,
      },
    });
    setIsEditing(false);
    setEditingPlaceId(null);
    showToast({ message: "Details updated", variant: "success" });
  };

  const cancelEdit = () => {
    if (editingPlace) {
      setEditName(editingPlace.name);
      setEditCategory(editingPlace.category);
      setEditLocality(editingPlace.locality);
      setEditAddress(editingPlace.fullAddress);
      setEditPlaceId(editingPlace.placeId ?? null);
      setEditCoords({ lat: editingPlace.lat ?? null, lng: editingPlace.lng ?? null });
      setLocationSuggestions([]);
    }
    setIsEditing(false);
    setEditingPlaceId(null);
  };

  const handleSaveEditedPlace = async () => {
    if (!editingPlace) return;
    const name = editName.trim();
    const locality = editLocality.trim();
    const fullAddress = editAddress.trim();
    if (!name || !locality) {
      showToast({ message: "Name and locality are required.", variant: "error" });
      return;
    }
    const editedPlace: DetectedPlace = {
      ...editingPlace,
      name,
      category: editCategory,
      locality,
      fullAddress: fullAddress || locality,
      placeId: editPlaceId ?? editingPlace.placeId ?? null,
      lat: editCoords.lat ?? editingPlace.lat ?? null,
      lng: editCoords.lng ?? editingPlace.lng ?? null,
    };
    await savePlace(editedPlace);
  };

  const savePlace = async (place: DetectedPlace) => {
    if (savedPlaceIds.has(place.id)) {
      showToast({ message: "Place already saved", variant: "info" });
      return;
    }
    try {
      const intent = resolveEntityIntent({
        category: place.category,
        intent: place.intent ?? null,
        title: place.name,
        evidenceText: place.evidenceText ?? null,
      });
      const response = await fetch(`${API_BASE_URL}/api/saved-places`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          placeId: place.placeId || place.id,
          title: place.name,
          category: place.category,
          metadata: {
            locality: place.locality,
            fullAddress: place.fullAddress,
            source: place.source,
            imageUrl: place.imageUrl,
            videoUrl: place.videoUrl,
            confidence: place.confidence ?? null,
            evidenceText: place.evidenceText ?? null,
            intent,
            metaPrimary: intent.l2,
            metaSecondary: intent.l3[0] || "",
            lat: place.lat ?? null,
            lng: place.lng ?? null,
            city: place.city ?? null,
            state: place.state ?? null,
            country: place.country ?? null,
          },
        }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          showToast({ message: "Please log in to save places.", variant: "error" });
          return;
        }
        throw new Error("save_failed");
      }
      publishSavedToCategoryFeed(place);
      void postReelAnalyticsEvent({
        clientRunId: String(place.runId),
        attemptNumber: (place.retryCount ?? 0) + 1,
        eventName: "saved",
        sourceUrl: place.sourceUrl,
        sourcePlatform: place.source,
        entityIndex: place.entityIndex ?? null,
        finalPlaceId: place.placeId ?? null,
        payload: {
          category: place.category,
          afterEdit: editingPlaceId === place.id || isEditing,
          hasPlaceId: Boolean(place.placeId),
          entityIndex: place.entityIndex ?? null,
        },
      });
      removeReadyNotificationByRunId(place.runId);
        setSavedPlaceIds((current) => new Set(current).add(place.id));
        setSaveMessage(`Saved to ${place.category}`);
        showToast({ message: `Saved to ${place.category}`, variant: "success" });
        setIsEditing(false);
        setEditingPlaceId(null);
        removeDetectedWithAnimation(place);
      } catch {
        showToast({ message: "Couldn't connect. Please try again.", variant: "error" });
      }
    };

  const handleRefreshInput = () => {
    if (activePreviewCard) {
      void runAnalysis(activePreviewCard.sourceUrl, { runId: activePreviewCard.runId, isRetry: true });
      logAddScreenState("AddScreen refresh reset");
      return;
    }
    if (!linkInput.trim()) {
      showToast({ message: "Paste a link to analyze", variant: "info" });
      return;
    }
    void runAnalysis(linkInput.trim());
    logAddScreenState("AddScreen refresh reset");
  };

  const handleRetryPreview = (card: PreviewCard) => {
    const retryCount = getCardRetryCount(card);
    if (!hasRetrySlotsLeft(retryCount)) {
      showToast({ message: "Please edit the details manually from here.", variant: "info" });
      return;
    }
    void runAnalysis(card.sourceUrl, { runId: card.runId, isRetry: true });
  };

  const handleDismissPreview = (card: PreviewCard) => {
    if (card.kind === "pending") {
      void postReelAnalyticsEvent({
        clientRunId: String(card.runId),
        attemptNumber: card.pending.retryCount + 1,
        eventName: "discarded",
        sourceUrl: card.sourceUrl,
        sourcePlatform: card.pending.source,
        entityIndex: card.pending.fallbackPlace.entityIndex ?? null,
        payload: { state: "pending", entityIndex: card.pending.fallbackPlace.entityIndex ?? null },
      });
      const nextPlaces = replaceRunPlaces(detectedPlacesRef.current, card.runId);
      const nextPendingJobs = pendingJobsRef.current.filter((item) => item.runId !== card.runId);
      syncDraftState(nextPlaces, nextPendingJobs, activePreviewKey === card.key ? "" : linkInput);
      removeReadyNotificationByRunId(card.runId);
      setIsEditing(false);
      setEditingPlaceId(null);
      showToast({ message: "Place removed", variant: "info" });
      return;
    }

    const selectedPreview = card.place;
    void postReelAnalyticsEvent({
      clientRunId: String(selectedPreview.runId),
      attemptNumber: (selectedPreview.retryCount ?? 0) + 1,
      eventName: "discarded",
      sourceUrl: selectedPreview.sourceUrl,
      sourcePlatform: selectedPreview.source,
      entityIndex: selectedPreview.entityIndex ?? null,
      finalPlaceId: selectedPreview.placeId ?? null,
      payload: { state: "resolved", category: selectedPreview.category, entityIndex: selectedPreview.entityIndex ?? null },
    });
    const nextPlaces = detectedPlacesRef.current.filter((item) => item.id !== selectedPreview.id);
    syncDraftState(nextPlaces, pendingJobsRef.current, nextPlaces.length || pendingJobsRef.current.length ? linkInput : "");
    setSavedPlaceIds((prev) => {
      if (!prev.has(selectedPreview.id)) return prev;
      const next = new Set(prev);
      next.delete(selectedPreview.id);
      return next;
    });
    removeReadyNotificationByRunId(selectedPreview.runId);
    setIsEditing(false);
    setEditingPlaceId(null);
    showToast({ message: "Place removed", variant: "info" });
  };

  const getChipCount = (chip: "Auto-detect" | DetectedCategory) => {
    if (chip === "Auto-detect") return autoDetectCount;
    return categoryCounts[chip];
  };

  return (
    <section className="wr-add-page" aria-label="Add page">
      <div className="wr-add-top-mini">
        <div className="wr-add-quick-pill"><Sparkles size={13} /><span>Quick capture</span></div>
        <button type="button" className="wr-add-notify-btn" aria-label="Notifications"><Bell size={16} /></button>
      </div>

      <div className="wr-add-title-block">
        <h2>Add a Wandreel</h2>
        <p>Save the scroll. Make it a stroll.</p>
      </div>

      <article className="wr-add-paste-card">
        <div className="wr-add-card-head">
          <div><h3>Paste your link</h3><p>Instagram, YouTube, TikToks.</p></div>
          <button type="button" className="wr-add-refresh-btn" aria-label="Refresh link input" onClick={handleRefreshInput}><RefreshCw size={15} /></button>
        </div>

        <label className="wr-add-link-input-wrap">
          <Link2 size={16} className="wr-add-link-icon" />
          <input
            type="url"
            value={linkInput}
            onChange={(event) => setLinkInput(event.target.value)}
            placeholder="Paste link here..."
            className="wr-add-link-input"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </label>

        <button type="button" className={`wr-add-analyze-btn ${isAnalyzing ? "is-loading" : ""}`} disabled={isAnalyzing || !linkInput.trim()} onClick={handleAnalyze}>
          {isAnalyzing ? (
            <>
              <span>{`Analyzing link... ${analysisElapsedSeconds}s`}</span>
              <small>{analysisStageCopy}</small>
            </>
          ) : (
            <span>Analyze link</span>
          )}
          {isAnalyzing ? <span className="wr-add-stroll-loader" aria-hidden="true"><span /><span /><span /><span /></span> : null}
        </button>
      </article>

        {shouldShowDetectedSection ? (
          <section className="wr-add-detected-wrap is-ready" aria-label="Detected places">
            <div className="wr-add-detected-head"><p>{isResolvingFinal ? "Resolving this link" : "Detected from this link"}</p><span>{previewCards.length} places</span></div>

            <div className="wr-add-chip-row">
              {chipOrder.map((chip) => {
                const count = getChipCount(chip);
                const isSelected = selectedDetectedCategory === chip;
              return (
                <button
                    type="button"
                    key={chip}
                    className={`wr-add-chip is-${chip.replace("Auto-detect", "auto").toLowerCase().replace(" ", "-")} ${isSelected ? "is-selected" : ""}`}
                    onClick={() => handleCategorySelect(chip)}
                  >
                    <span>{chip}</span><strong>{count}</strong>
                  </button>
                );
              })}
            </div>

            {previewCards.length ? (
              <div className="wr-add-preview-stack">
                {previewCards.map((card, index) => (
                  card.kind === "pending" ? (
                    (() => {
                      const retryCount = card.pending.retryCount;
                      const retryCountLabel = getRetryCountLabel(retryCount);
                      const isRetrying = card.pending.isRetrying;
                      const isRetryDisabled = true;
                      return (
                    <article
                      key={card.key}
                      className={`wr-add-preview-card wr-add-preview-card-loading ${activePreviewCard?.key === card.key ? "is-active" : ""}`}
                      onClick={() => setActivePreviewKey(card.key)}
                    >
                      <button type="button" className="wr-add-preview-close" aria-label="Close preview card" onClick={(event) => { event.stopPropagation(); handleDismissPreview(card); }}><X size={14} /></button>
                      <div className="wr-add-preview-loading-visual" aria-hidden="true">
                        <span className="wr-add-preview-loading-ring" />
                        <span className="wr-add-preview-loading-core" />
                      </div>
                      <div className="wr-add-preview-body">
                        <p className="wr-add-preview-kicker">PROCESSING PREVIEW {index + 1} OF {previewCards.length}</p>
                        <h4>Finding place details...</h4>
                        <p>{isRetrying ? "We’re taking another look with our best model." : "We're fetching the info for you."}</p>
                        <p>Keep scrolling - come back anytime to save it.</p>
                        {retryCountLabel ? <p className="wr-add-preview-retry-note">{retryCountLabel}</p> : null}
                        <div className="wr-add-preview-actions">
                          <button
                            type="button"
                            className="wr-add-preview-btn"
                            disabled={isRetryDisabled}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleRetryPreview(card);
                            }}
                          >
                            Retry
                          </button>
                        </div>
                      </div>
                    </article>
                      );
                    })()
                  ) : (
                    (() => {
                      const retryCount = card.place.retryCount ?? 0;
                      const retryCountLabel = getRetryCountLabel(retryCount);
                      const isRetryExhausted = retryCount >= MAX_PREVIEW_RETRIES && isNeedsManualReview(card.place);
                      return (
                    <article
                      key={card.key}
                      className={`wr-add-preview-card ${removingPlaceId === card.place.id ? "is-removing" : ""} ${activePreviewCard?.key === card.key ? "is-active" : ""}`}
                      onClick={() => setActivePreviewKey(card.key)}
                    >
                      <button type="button" className="wr-add-preview-close" aria-label="Close preview card" onClick={(event) => { event.stopPropagation(); handleDismissPreview(card); }}><X size={14} /></button>
                      <img src={card.place.imageUrl} alt={card.place.name} className="wr-add-preview-image" />
                      <div className="wr-add-preview-body">
                        <p className="wr-add-preview-kicker">DETECTED PREVIEW {index + 1} OF {previewCards.length}</p>
                        <h4>{card.place.name}</h4>
                        <p>{card.place.category} · {formatPreviewLocation(card.place)}</p>
                        <p className="wr-add-preview-evidence">{formatEvidenceText(card.place)}</p>
                        <div className="wr-add-preview-meta">
                          <span>From {card.place.source}</span>
                          {formatConfidenceLabel(card.place.confidence) ? <span>{formatConfidenceLabel(card.place.confidence)}</span> : null}
                          {retryCountLabel ? <span>{retryCountLabel}</span> : null}
                        </div>
                        {isRetryExhausted ? (
                          <p className="wr-add-preview-retry-limit">This one’s on us — we couldn’t extract it properly. Please edit the details manually.</p>
                        ) : null}
                        <div className="wr-add-preview-actions">
                          <button
                            type="button"
                            className="wr-add-preview-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              setActivePreviewKey(card.key);
                              setEditingPlaceId(card.place.id);
                              setIsEditing(true);
                            }}
                          >
                            Edit details
                          </button>
                          <button
                            type="button"
                            className="wr-add-preview-btn"
                            disabled={isRetryExhausted}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleRetryPreview(card);
                            }}
                          >
                            Retry
                          </button>
                          <button
                            type="button"
                            className="wr-add-preview-btn is-primary"
                            onClick={(event) => {
                              event.stopPropagation();
                              void savePlace(card.place);
                            }}
                          >
                            Save place
                          </button>
                        </div>
                      </div>
                    </article>
                      );
                    })()
                  )
                ))}
              </div>
            ) : (
              <article className="wr-add-empty-state" aria-label="No preview for selected category">
                {selectedDetectedCategory === "Auto-detect"
                  ? "No detected places are ready yet. This reel may need review."
                  : "No places in this category yet."}
              </article>
            )}

            {saveMessage ? <p className="wr-add-save-toast">{saveMessage}</p> : null}
          </section>
        ) : null}
      {isEditing && editingPlace ? (
        <div className="wr-add-edit-layer" role="presentation">
          <button type="button" className="wr-add-edit-backdrop" aria-label="Cancel edit" onClick={cancelEdit} />
          <section className="wr-add-edit-sheet" role="dialog" aria-modal="true" aria-label="Edit detected place">
            <div className="wr-add-edit-head">
              <div>
                <p>EDIT WANDREEL</p>
                <h3>Check the details</h3>
              </div>
              <button type="button" className="wr-add-edit-close" aria-label="Cancel edit" onClick={cancelEdit}>x</button>
            </div>
            <label className="wr-add-edit-field">
              <span>Title</span>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Place name" />
            </label>
            <label className="wr-add-edit-field">
              <span>Category</span>
              <select value={editCategory} onChange={(e) => setEditCategory(e.target.value as DetectedCategory)}>
                {chipOrder.filter((chip): chip is DetectedCategory => chip !== "Auto-detect").map((chip) => (
                  <option key={chip} value={chip}>{chip}</option>
                ))}
              </select>
            </label>
            <label className="wr-add-edit-field">
              <span>Location</span>
              <input value={editLocality} onChange={(e) => setEditLocality(e.target.value)} placeholder="Locality" />
            </label>
            <label className="wr-add-edit-field">
              <span>Full address</span>
              <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="Full address" />
            </label>
            <div className="wr-add-location-suggest">
              {isLocationSearching ? <p>Searching location suggestions...</p> : null}
              {locationSuggestions.map((item) => (
                <button
                  type="button"
                  key={item.placeId}
                  onClick={() => {
                    setEditPlaceId(item.placeId);
                    setEditLocality(item.label);
                    setEditAddress(item.description || item.secondaryText || item.label);
                    setLocationSuggestions([]);
                  }}
                >
                  <span>{item.label}</span>
                  {item.secondaryText || item.description ? <small>{item.secondaryText || item.description}</small> : null}
                </button>
              ))}
            </div>
            <div className="wr-add-edit-actions">
              <button type="button" className="wr-add-preview-btn" onClick={cancelEdit}>Cancel</button>
              <button type="button" className="wr-add-preview-btn" onClick={handleApplyEdit}>Update card</button>
              <button type="button" className="wr-add-preview-btn is-primary" onClick={() => void handleSaveEditedPlace()}>Save place</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
