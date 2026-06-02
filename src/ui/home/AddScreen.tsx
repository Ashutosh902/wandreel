import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Link2, RefreshCw, Sparkles, X } from "lucide-react";
import { useUx } from "../layout/UxProvider";
import {
  ADD_DRAFT_UPDATED_EVENT,
  ADD_PROCESSING_STARTED_EVENT,
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
import { upsertSavedPlace } from "./savedPlaces";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
const AUTH_SESSION_UPDATED_EVENT = "wr:auth-session-updated";
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

type IntelligenceApiResponse = {
  ok: boolean;
  jobId?: string;
  output?: {
    structuredEntities?: IntelligenceEntity[];
  };
};

const chipOrder: Array<"Auto-detect" | DetectedCategory> = ["Auto-detect", "Taste", "Activity", "Stay", "Explore"];

export function AddScreen() {
  const { isOffline, showToast, searchLocations } = useUx();
  const [linkInput, setLinkInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [selectedDetectedCategory, setSelectedDetectedCategory] = useState<"Auto-detect" | DetectedCategory>("Auto-detect");
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(0);
  const [detectedPlaces, setDetectedPlaces] = useState<DetectedPlace[]>([]);
  const [isPreviewVisible, setIsPreviewVisible] = useState(true);
  const [saveMessage, setSaveMessage] = useState("");
  const [savedPlaceIds, setSavedPlaceIds] = useState<Set<string>>(new Set());
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState<DetectedCategory>("Taste");
  const [editLocality, setEditLocality] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editPlaceId, setEditPlaceId] = useState<string | null>(null);
  const [editCoords, setEditCoords] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [locationSuggestions, setLocationSuggestions] = useState<Array<{ placeId: string; label: string; secondaryText: string | null; description: string | null }>>([]);
  const [isLocationSearching, setIsLocationSearching] = useState(false);
  const [pendingJobs, setPendingJobs] = useState<PendingDetectionJob[]>([]);
  const [removingPlaceId, setRemovingPlaceId] = useState<string | null>(null);
  const [autoSelectFirstSuggestion, setAutoSelectFirstSuggestion] = useState(true);
  const analyzeRunRef = useRef(0);
  const locationDebounceTimerRef = useRef<number | null>(null);
  const isResolvingFinal = pendingJobs.length > 0;
  const logAddScreenState = (label: string) => {
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
    selectedPreviewIndex: number;
    isPreviewVisible: boolean;
    linkInput: string;
    pendingJobs: PendingDetectionJob[];
  }) => {
    setLinkInput(draft.linkInput || "");
    setHasAnalyzed(draft.detectedPlaces.length > 0 || draft.pendingJobs.length > 0);
    setSelectedDetectedCategory(draft.pendingJobs.length > 0 ? "Auto-detect" : draft.selectedDetectedCategory || "Auto-detect");
    setSelectedPreviewIndex(draft.selectedPreviewIndex || 0);
    setDetectedPlaces(Array.isArray(draft.detectedPlaces) ? draft.detectedPlaces : []);
    setIsPreviewVisible(draft.isPreviewVisible ?? true);
    setPendingJobs(Array.isArray(draft.pendingJobs) ? draft.pendingJobs : []);
    setIsAnalyzing(false);
  };

  const resetAddFlowState = (options?: { clearPersisted?: boolean }) => {
    analyzeRunRef.current = Date.now();
    setLinkInput("");
    setIsAnalyzing(false);
    setHasAnalyzed(false);
    setSelectedDetectedCategory("Auto-detect");
    setSelectedPreviewIndex(0);
    setDetectedPlaces([]);
    setIsPreviewVisible(true);
    setSaveMessage("");
    setSavedPlaceIds(new Set());
    setIsEditing(false);
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
  const displayedCategoryCounts = useMemo(() => {
    if (!isResolvingFinal) return categoryCounts;
    return {
      total: detectedPlaces.length,
      Taste: 0,
      Activity: 0,
      Stay: 0,
      Explore: 0,
    };
  }, [categoryCounts, detectedPlaces.length, isResolvingFinal]);
  const shouldShowDetectedSection = hasAnalyzed && (categoryCounts.total > 0 || isResolvingFinal);

  const visibleDetectedPlaces = useMemo(() => {
    if (selectedDetectedCategory === "Auto-detect") return detectedPlaces;
    return detectedPlaces.filter((item) => item.category === selectedDetectedCategory);
  }, [detectedPlaces, selectedDetectedCategory]);

  const selectedPreview = visibleDetectedPlaces[selectedPreviewIndex] ?? null;

  useEffect(() => {
    if (!selectedPreview) return;
    // Only update form fields if not currently editing to preserve user changes
    if (!isEditing) {
      setEditName(selectedPreview.name);
      setEditCategory(selectedPreview.category);
      setEditLocality(selectedPreview.locality);
      setEditAddress(selectedPreview.fullAddress);
      setEditPlaceId(selectedPreview.placeId ?? null);
      setEditCoords({ lat: selectedPreview.lat ?? null, lng: selectedPreview.lng ?? null });
    }
  }, [selectedPreview, isEditing]);

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
    const shouldRestore = Boolean(draft && (draft.pendingJobs.length > 0 || peekReviewRunId() !== null));
    if (draft && shouldRestore) {
      restoreDraftState(draft);
    } else {
      resetAddFlowState({ clearPersisted: true });
    }
    console.log("AddScreen mounted", {
      url: shouldRestore ? draft?.linkInput || "" : "",
      hasAnalyzed: shouldRestore ? Boolean((draft?.detectedPlaces.length || 0) > 0 || (draft?.pendingJobs.length || 0) > 0) : false,
      detectedPlaces: shouldRestore ? draft?.detectedPlaces || [] : [],
      source: "AddScreen",
      viewport: window.innerWidth,
      storageUrl: window.localStorage.getItem("wandreel_add_url"),
      lastAnalyzedLink: window.localStorage.getItem("lastAnalyzedLink"),
      persistedDraft: window.localStorage.getItem("wr_add_detected_draft_v2"),
    });
  }, []);

  useEffect(() => () => {
    clearReviewRunId();
    clearLegacyAddStorage();
  }, []);

  useEffect(() => {
    const syncFromStorage = () => {
      const draft = readPersistedAddDraft();
      if (!draft) return;
      const shouldApply = draft.pendingJobs.length > 0 || pendingJobs.length > 0 || peekReviewRunId() !== null;
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

  const sourceLabelFromPlatform = (platform?: string) => {
    if (platform === "instagram") return "Instagram Reel";
    if (platform === "youtube") return "YouTube Video";
    return "Web Link";
  };

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

  const toDraftPlace = (extraction: ExtractionApiResponse, runId: number): DetectedPlace => {
    const platformSource = sourceLabelFromPlatform(extraction.metadata?.platform);
    const rawTitle = extraction.metadata?.title?.trim() || "";
    const rawDesc = extraction.metadata?.description?.trim() || "";
    const draftCategory = inferDraftCategory(`${rawTitle} ${rawDesc}`);
    const imageUrl = extraction.metadata?.imageUrl || categoryFallbackImage[draftCategory];
    const draftName = inferDraftName(rawTitle, rawDesc);

    return {
      id: `draft-${Date.now()}`,
      runId,
      name: draftName,
      category: draftCategory,
      locality: "Resolving locality...",
      source: platformSource,
      imageUrl,
      fullAddress: "Resolving full address...",
      videoUrl: extraction.metadata?.canonicalUrl || extraction.metadata?.sourceUrl || linkInput.trim(),
      placeId: null,
      lat: null,
      lng: null,
      city: null,
      state: null,
      country: null,
    };
  };

  const clearPersistedDraftState = () => {
    try {
      resetAddFlowState({ clearPersisted: true });
    } catch {
      // Ignore localStorage failures.
    }
  };

  const publishSavedToCategoryFeed = (place: DetectedPlace) => {
    upsertSavedPlace({
      id: `${place.category}-${place.placeId || place.id}`.toLowerCase(),
      placeId: place.placeId || place.id,
      title: place.name,
      category: place.category,
      distanceKm: 0.1,
      metaPrimary: place.category,
      metaSecondary: "Saved",
      locality: place.locality,
      fullAddress: place.fullAddress,
      videoUrl: place.videoUrl,
      imageUrl: place.imageUrl,
      tags: ["Saved", "Visited"],
      lat: place.lat ?? null,
      lng: place.lng ?? null,
      createdAtMs: Date.now(),
    });
  };

  const removeDetectedWithAnimation = (place: DetectedPlace) => {
    setRemovingPlaceId(place.id);
    window.setTimeout(() => {
      const willBeEmpty = detectedPlaces.filter((item) => item.id !== place.id).length === 0;
      setDetectedPlaces((prev) => {
        const next = prev.filter((item) => item.id !== place.id);
        if (!next.length) clearPersistedDraftState();
        return next;
      });
      setPendingJobs((prev) => prev.filter((job) => job.runId !== place.runId));
      removeReadyNotificationByRunId(place.runId);
      setSavedPlaceIds((prev) => {
        if (!prev.has(place.id)) return prev;
        const next = new Set(prev);
        next.delete(place.id);
        return next;
      });
      setSelectedPreviewIndex(0);
      setIsPreviewVisible(true);
      setIsEditing(false);
      setRemovingPlaceId(null);
      if (willBeEmpty) {
        resetAddFlowState({ clearPersisted: true });
      }
    }, 260);
  };

  const handleAnalyze = async () => {
    if (!linkInput.trim() || isAnalyzing) return;
    if (isOffline) {
      showToast({ message: "This link could not be analyzed.", variant: "error" });
      return;
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(linkInput.trim());
    } catch {
      showToast({ message: "This link could not be analyzed.", variant: "error" });
      return;
    }
    if (!/^https?:$/i.test(parsedUrl.protocol)) {
      showToast({ message: "This link could not be analyzed.", variant: "error" });
      return;
    }

    const runId = Date.now();
    analyzeRunRef.current = runId;
    window.dispatchEvent(new CustomEvent(ADD_PROCESSING_STARTED_EVENT));
    setIsAnalyzing(true);
    setHasAnalyzed(true);
    setIsPreviewVisible(true);
    setSaveMessage("");
    setSelectedDetectedCategory("Auto-detect");
    setSelectedPreviewIndex(0);

    try {
      const extractionResponse = await fetch(`${API_BASE_URL}/api/metadata/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: linkInput.trim(), mode: "deep" }),
      });
      const extraction = (await extractionResponse.json()) as ExtractionApiResponse;
      if (!extractionResponse.ok || !extraction?.ok) throw new Error("extraction_failed");

      if (analyzeRunRef.current !== runId) return;
      const draftPlace = toDraftPlace(extraction, runId);
      setDetectedPlaces((prev) => [draftPlace, ...prev.filter((item) => item.runId !== runId)]);
      writePersistedAddDraft({
        detectedPlaces: [draftPlace],
        selectedDetectedCategory: "Auto-detect",
        selectedPreviewIndex: 0,
        isPreviewVisible: true,
        linkInput: linkInput.trim(),
        pendingJobs: [],
      });
      setIsAnalyzing(false);
      const startedAt = Date.now();
      setSelectedDetectedCategory("Auto-detect");
      setSelectedPreviewIndex(0);
      setIsPreviewVisible(true);

      const intelligenceResponse = await fetch(`${API_BASE_URL}/api/intelligence/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: extraction, mode: "draft_async" }),
      });
      const intelligence = (await intelligenceResponse.json()) as IntelligenceApiResponse;
      if (analyzeRunRef.current !== runId) return;
      if (!intelligenceResponse.ok || !intelligence?.ok) throw new Error("intelligence_failed");
      const entities = intelligence.output?.structuredEntities ?? [];
      const draftFromApi = mapEntitiesToPlaces(
        entities,
        {
          source: sourceLabelFromPlatform(extraction.metadata?.platform),
          imageUrl: extraction.metadata?.imageUrl || categoryFallbackImage.Taste,
          videoUrl: extraction.metadata?.canonicalUrl || extraction.metadata?.sourceUrl || linkInput.trim(),
        },
        runId,
      );
      const shownDraft = draftFromApi.length ? draftFromApi : [draftPlace];
      setDetectedPlaces((prev) => [...shownDraft, ...prev.filter((item) => item.runId !== runId)]);

      const jobId = intelligence.jobId || null;
      if (!jobId) {
        clearPersistedAddDraft();
        showToast({ message: "Link analyzed", variant: "success" });
        return;
      }
      const pendingJob = {
        runId,
        jobId,
        startedAtMs: startedAt,
        source: sourceLabelFromPlatform(extraction.metadata?.platform),
        imageUrl: extraction.metadata?.imageUrl || categoryFallbackImage.Taste,
        videoUrl: extraction.metadata?.canonicalUrl || extraction.metadata?.sourceUrl || linkInput.trim(),
      };
      setPendingJobs((prev) => [
        pendingJob,
        ...prev.filter((item) => item.runId !== runId),
      ]);
      writePersistedAddDraft({
        detectedPlaces: shownDraft,
        selectedDetectedCategory: "Auto-detect",
        selectedPreviewIndex: 0,
        isPreviewVisible: true,
        linkInput: linkInput.trim(),
        pendingJobs: [pendingJob],
      });
    } catch {
      if (analyzeRunRef.current !== runId) return;
      setIsAnalyzing(false);
      setSelectedDetectedCategory("Auto-detect");
      setSelectedPreviewIndex(0);
      setIsPreviewVisible(true);
      clearPersistedAddDraft();
      showToast({ message: "This link could not be analyzed.", variant: "error" });
    }
  };

  const handleCategorySelect = (next: "Auto-detect" | DetectedCategory) => {
    if (isResolvingFinal && next !== "Auto-detect") return;
    setSelectedDetectedCategory(next);
    setSelectedPreviewIndex(0);
    setIsPreviewVisible(true);
  };

  const handleSavePlace = async () => {
    if (!selectedPreview) return;
    await savePlace(selectedPreview);
  };

  const handleApplyEdit = () => {
    if (!selectedPreview) return;
    const name = editName.trim();
    const locality = editLocality.trim();
    const fullAddress = editAddress.trim();
    if (!name || !locality) {
      showToast({ message: "Name and locality are required.", variant: "error" });
      return;
    }
    setDetectedPlaces((prev) => prev.map((item) => (item.id === selectedPreview.id ? {
      ...item,
      name,
      category: editCategory,
      locality,
      fullAddress: fullAddress || item.fullAddress,
      placeId: editPlaceId ?? item.placeId ?? null,
      lat: editCoords.lat ?? item.lat ?? null,
      lng: editCoords.lng ?? item.lng ?? null,
    } : item)));
    setIsEditing(false);
    showToast({ message: "Details updated", variant: "success" });
  };

  const cancelEdit = () => {
    if (selectedPreview) {
      setEditName(selectedPreview.name);
      setEditCategory(selectedPreview.category);
      setEditLocality(selectedPreview.locality);
      setEditAddress(selectedPreview.fullAddress);
      setEditPlaceId(selectedPreview.placeId ?? null);
      setEditCoords({ lat: selectedPreview.lat ?? null, lng: selectedPreview.lng ?? null });
      setLocationSuggestions([]);
    }
    setIsEditing(false);
  };

  const handleSaveEditedPlace = async () => {
    if (!selectedPreview) return;
    const name = editName.trim();
    const locality = editLocality.trim();
    const fullAddress = editAddress.trim();
    if (!name || !locality) {
      showToast({ message: "Name and locality are required.", variant: "error" });
      return;
    }
    const editedPlace: DetectedPlace = {
      ...selectedPreview,
      name,
      category: editCategory,
      locality,
      fullAddress: fullAddress || locality,
      placeId: editPlaceId ?? selectedPreview.placeId ?? null,
      lat: editCoords.lat ?? selectedPreview.lat ?? null,
      lng: editCoords.lng ?? selectedPreview.lng ?? null,
    };
    await savePlace(editedPlace);
  };

  const savePlace = async (place: DetectedPlace) => {
    if (savedPlaceIds.has(place.id)) {
      showToast({ message: "Place already saved", variant: "info" });
      return;
    }
    try {
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
      removeReadyNotificationByRunId(place.runId);
      setSavedPlaceIds((current) => new Set(current).add(place.id));
      setSaveMessage(`Saved to ${place.category}`);
      showToast({ message: `Saved to ${place.category}`, variant: "success" });
      setIsEditing(false);
      removeDetectedWithAnimation(place);
    } catch {
      showToast({ message: "Couldn't connect. Please try again.", variant: "error" });
    }
  };

  const handleRefreshInput = () => {
    resetAddFlowState({ clearPersisted: true });
    logAddScreenState("AddScreen refresh reset");
  };

  const handleDismissPreview = () => {
    if (!selectedPreview) {
      setIsPreviewVisible(false);
      return;
    }

    setDetectedPlaces((prev) => {
      const next = prev.filter((item) => item.id !== selectedPreview.id);
      if (!next.length) {
        clearPersistedDraftState();
      }
      return next;
    });
    setSavedPlaceIds((prev) => {
      if (!prev.has(selectedPreview.id)) return prev;
      const next = new Set(prev);
      next.delete(selectedPreview.id);
      return next;
    });
    removeReadyNotificationByRunId(selectedPreview.runId);
    setSelectedPreviewIndex(0);
    setIsPreviewVisible(true);
    setIsEditing(false);
    showToast({ message: "Place removed", variant: "info" });
  };

  const getChipCount = (chip: "Auto-detect" | DetectedCategory) => {
    if (chip === "Auto-detect") return displayedCategoryCounts.total;
    return displayedCategoryCounts[chip];
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
          <span>{isAnalyzing ? "Turning scroll into stroll..." : "Analyze link"}</span>
          {isAnalyzing ? <span className="wr-add-stroll-loader" aria-hidden="true"><span /><span /><span /><span /></span> : null}
        </button>
      </article>

      {shouldShowDetectedSection ? (
        <section className="wr-add-detected-wrap is-ready" aria-label="Detected places">
          <div className="wr-add-detected-head"><p>{isResolvingFinal ? "Resolving this link" : "Detected from this link"}</p><span>{categoryCounts.total} places</span></div>

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
                  disabled={isResolvingFinal && chip !== "Auto-detect"}
                >
                  <span>{chip}</span><strong>{count}</strong>
                </button>
              );
            })}
          </div>

          {isPreviewVisible && selectedPreview ? (
            <article className={`wr-add-preview-card ${removingPlaceId === selectedPreview.id ? "is-removing" : ""}`}>
              <button type="button" className="wr-add-preview-close" aria-label="Close preview card" onClick={handleDismissPreview}><X size={14} /></button>
              <img src={selectedPreview.imageUrl} alt={selectedPreview.name} className="wr-add-preview-image" />
              <div className="wr-add-preview-body">
                <p className="wr-add-preview-kicker">DETECTED PREVIEW {selectedPreviewIndex + 1} OF {visibleDetectedPlaces.length || 1}</p>
                <h4>{isResolvingFinal ? "Finding place details..." : selectedPreview.name}</h4>
                {isResolvingFinal ? (
                  <>
                    <p>We're fetching the info for you.</p>
                    <p>Keep scrolling - come back anytime to save it.</p>
                  </>
                ) : (
                  <>
                    <p>{selectedPreview.category} · {selectedPreview.locality}</p>
                    <p>From {selectedPreview.source}</p>
                  </>
                )}
                <div className="wr-add-preview-actions">
                  <button type="button" className="wr-add-preview-btn" onClick={() => setIsEditing(true)} disabled={isResolvingFinal}>Edit details</button>
                  <button type="button" className="wr-add-preview-btn is-primary" onClick={handleSavePlace} disabled={isResolvingFinal}>Save place</button>
                </div>
              </div>
            </article>
          ) : (
            <article className="wr-add-empty-state" aria-label="No preview for selected category">No places in this category yet.</article>
          )}

          {saveMessage ? <p className="wr-add-save-toast">{saveMessage}</p> : null}
        </section>
      ) : isAnalyzing ? (
        <section className="wr-add-detected-wrap is-skeleton" aria-label="Detected places loading">
          <div className="wr-add-detected-skeleton head" />
          <div className="wr-add-detected-skeleton chips" />
          <div className="wr-add-detected-skeleton card" />
        </section>
      ) : null}
      {isEditing && selectedPreview ? (
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
