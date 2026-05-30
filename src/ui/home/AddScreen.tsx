import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Link2, RefreshCw, Sparkles, X } from "lucide-react";
import { useUx } from "../layout/UxProvider";

type DetectedCategory = "Taste" | "Activity" | "Stay" | "Explore";

type DetectedPlace = {
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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
const ADD_DRAFT_STORAGE_KEY = "wr_add_detected_draft_v2";
const CATEGORY_FEED_CACHE_KEY = "wr_category_saved_feed_v1";

const categoryFallbackImage: Record<DetectedCategory, string> = {
  Taste: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=1200",
  Activity: "https://images.unsplash.com/photo-1541625602330-2277a4c46182?auto=format&fit=crop&q=80&w=1200",
  Stay: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&q=80&w=1200",
  Explore: "https://images.unsplash.com/photo-1527631746610-bca00a040d60?auto=format&fit=crop&q=80&w=1200",
};

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

type IntelligenceEntity = {
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

type IntelligenceApiResponse = {
  ok: boolean;
  jobId?: string;
  output?: {
    structuredEntities?: IntelligenceEntity[];
  };
};

type PersistedAddDraft = {
  detectedPlaces: DetectedPlace[];
  selectedDetectedCategory: "Auto-detect" | DetectedCategory;
  selectedPreviewIndex: number;
  isPreviewVisible: boolean;
  linkInput: string;
  pendingJobs: PendingDetectionJob[];
};

type PendingDetectionJob = {
  runId: number;
  jobId: string;
  startedAtMs: number;
  source: string;
  imageUrl: string;
  videoUrl: string;
};

const chipOrder: Array<"Auto-detect" | DetectedCategory> = ["Auto-detect", "Taste", "Activity", "Stay", "Explore"];

export function AddScreen() {
  const { isOffline, showToast } = useUx();
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
  const [editLocality, setEditLocality] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [pendingJobs, setPendingJobs] = useState<PendingDetectionJob[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [removingPlaceId, setRemovingPlaceId] = useState<string | null>(null);
  const analyzeRunRef = useRef(0);
  const isResolvingFinal = pendingJobs.length > 0;

  useEffect(() => {
    if (!saveMessage) return;
    const timer = window.setTimeout(() => setSaveMessage(""), 1800);
    return () => window.clearTimeout(timer);
  }, [saveMessage]);

  useEffect(() => {
    if (!isResolvingFinal || pendingJobs.length === 0) return;
    const latestStartedAtMs = pendingJobs[0]?.startedAtMs || Date.now();
    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - latestStartedAtMs) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [isResolvingFinal, pendingJobs]);

  const categoryCounts = useMemo(() => {
    const base: Record<DetectedCategory, number> = { Taste: 0, Activity: 0, Stay: 0, Explore: 0 };
    for (const item of detectedPlaces) base[item.category] += 1;
    return { total: detectedPlaces.length, ...base };
  }, [detectedPlaces]);

  const visibleDetectedPlaces = useMemo(() => {
    if (selectedDetectedCategory === "Auto-detect") return detectedPlaces;
    return detectedPlaces.filter((item) => item.category === selectedDetectedCategory);
  }, [detectedPlaces, selectedDetectedCategory]);

  const selectedPreview = visibleDetectedPlaces[selectedPreviewIndex] ?? null;

  useEffect(() => {
    if (!selectedPreview) return;
    setEditName(selectedPreview.name);
    setEditLocality(selectedPreview.locality);
    setEditAddress(selectedPreview.fullAddress);
    setIsEditing(false);
  }, [selectedPreview]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ADD_DRAFT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedAddDraft;
      setDetectedPlaces(Array.isArray(parsed.detectedPlaces) ? parsed.detectedPlaces : []);
      setHasAnalyzed(true);
      setSelectedDetectedCategory(parsed.selectedDetectedCategory || "Auto-detect");
      setSelectedPreviewIndex(parsed.selectedPreviewIndex || 0);
      setIsPreviewVisible(parsed.isPreviewVisible ?? true);
      setLinkInput(parsed.linkInput || "");
      setPendingJobs(Array.isArray(parsed.pendingJobs) ? parsed.pendingJobs : []);
    } catch {
      clearPersistedDraftState();
    }
  }, []);

  useEffect(() => {
    if (!hasAnalyzed) return;
    persistDraftState({
      detectedPlaces,
      selectedDetectedCategory,
      selectedPreviewIndex,
      isPreviewVisible,
      linkInput: linkInput.trim(),
      pendingJobs,
    });
  }, [
    hasAnalyzed,
    detectedPlaces,
    selectedDetectedCategory,
    selectedPreviewIndex,
    isPreviewVisible,
    linkInput,
    pendingJobs,
  ]);

  useEffect(() => {
    if (!pendingJobs.length) return;
    const timer = window.setInterval(() => {
      void (async () => {
        const jobsSnapshot = [...pendingJobs];
        for (const pending of jobsSnapshot) {
          try {
            const jobResponse = await fetch(`${API_BASE_URL}/api/intelligence/jobs/${pending.jobId}`);
            const jobPayload = await jobResponse.json();
            const job = jobPayload?.job;
            if (!jobResponse.ok || !job) continue;
            if (job.status === "completed") {
              const entities = (job.result?.output?.structuredEntities || []) as IntelligenceEntity[];
              const resolvedPlaces = mapEntitiesToPlaces(
                entities,
                { source: pending.source, imageUrl: pending.imageUrl, videoUrl: pending.videoUrl },
                pending.runId,
              );
              setDetectedPlaces((prev) => {
                const withoutRun = prev.filter((item) => item.runId !== pending.runId);
                return resolvedPlaces.length ? [...resolvedPlaces, ...withoutRun] : withoutRun;
              });
              setPendingJobs((prev) => prev.filter((item) => item.jobId !== pending.jobId));
              showToast({ message: "Link analyzed", variant: "success" });
            } else if (job.status === "failed") {
              setPendingJobs((prev) => prev.filter((item) => item.jobId !== pending.jobId));
            }
          } catch {
            // Ignore transient polling errors.
          }
        }
      })();
    }, 1800);
    return () => window.clearInterval(timer);
  }, [pendingJobs, showToast]);

  const mapCategory = (category: IntelligenceEntity["category"]): DetectedCategory | null => {
    if (category === "eat") return "Taste";
    if (category === "do") return "Activity";
    if (category === "stay") return "Stay";
    if (category === "see") return "Explore";
    return null;
  };

  const sourceLabelFromPlatform = (platform?: string) => {
    if (platform === "instagram") return "Instagram Reel";
    if (platform === "youtube") return "YouTube Video";
    return "Web Link";
  };

  const mapEntitiesToPlaces = (
    entities: IntelligenceEntity[],
    defaults: { source: string; imageUrl: string; videoUrl: string },
    runId: number,
  ): DetectedPlace[] =>
    entities
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

  const toDraftPlace = (extraction: ExtractionApiResponse, runId: number): DetectedPlace => {
    const platformSource = sourceLabelFromPlatform(extraction.metadata?.platform);
    const imageUrl = extraction.metadata?.imageUrl || categoryFallbackImage.Taste;
    const rawTitle = extraction.metadata?.title?.trim() || "";
    const rawDesc = extraction.metadata?.description?.trim() || "";
    const descHint = rawDesc
      .split(/\n|[.!?]/)
      .map((line) => line.trim())
      .find((line) => line.length > 3 && line.length < 80) || "";
    const candidateName = rawTitle && rawTitle.toLowerCase() !== "untitled" ? rawTitle : descHint || "Detected place";
    const draftName = /(^@)|(^follow\s+@)|(@\w+)/i.test(candidateName) ? "Detected place" : candidateName;

    return {
      id: `draft-${Date.now()}`,
      runId,
      name: draftName,
      category: "Taste",
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

  const persistDraftState = (payload: PersistedAddDraft) => {
    try {
      window.localStorage.setItem(ADD_DRAFT_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore localStorage failures.
    }
  };

  const clearPersistedDraftState = () => {
    try {
      window.localStorage.removeItem(ADD_DRAFT_STORAGE_KEY);
    } catch {
      // Ignore localStorage failures.
    }
  };

  const publishSavedToCategoryFeed = (place: DetectedPlace) => {
    const payload = {
      id: `${place.category}-${place.placeId || place.id}`.toLowerCase(),
      title: place.name,
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
    };
    try {
      const raw = window.localStorage.getItem(CATEGORY_FEED_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const byCategory = Array.isArray(parsed?.[place.category]) ? parsed[place.category] : [];
      const withoutDup = byCategory.filter((item: { id?: string; title?: string; locality?: string }) => {
        if (item?.id && item.id === payload.id) return false;
        return !(item?.title === payload.title && item?.locality === payload.locality);
      });
      const next = { ...parsed, [place.category]: [payload, ...withoutDup].slice(0, 100) };
      window.localStorage.setItem(CATEGORY_FEED_CACHE_KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent("wr:category-saved-updated", { detail: { category: place.category } }));
    } catch {
      // Ignore cache errors.
    }
  };

  const removeDetectedWithAnimation = (place: DetectedPlace) => {
    setRemovingPlaceId(place.id);
    window.setTimeout(() => {
      setDetectedPlaces((prev) => {
        const next = prev.filter((item) => item.id !== place.id);
        if (!next.length) clearPersistedDraftState();
        return next;
      });
      setPendingJobs((prev) => prev.filter((job) => job.runId !== place.runId));
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
      setIsAnalyzing(false);
      const startedAt = Date.now();
      setElapsedSeconds(0);
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
        showToast({ message: "Link analyzed", variant: "success" });
        return;
      }
      setPendingJobs((prev) => [
        {
          runId,
          jobId,
          startedAtMs: startedAt,
          source: sourceLabelFromPlatform(extraction.metadata?.platform),
          imageUrl: extraction.metadata?.imageUrl || categoryFallbackImage.Taste,
          videoUrl: extraction.metadata?.canonicalUrl || extraction.metadata?.sourceUrl || linkInput.trim(),
        },
        ...prev.filter((item) => item.runId !== runId),
      ]);
    } catch {
      if (analyzeRunRef.current !== runId) return;
      setIsAnalyzing(false);
      setSelectedDetectedCategory("Auto-detect");
      setSelectedPreviewIndex(0);
      setIsPreviewVisible(true);
      showToast({ message: "This link could not be analyzed.", variant: "error" });
    }
  };

  const handleCategorySelect = (next: "Auto-detect" | DetectedCategory) => {
    setSelectedDetectedCategory(next);
    setSelectedPreviewIndex(0);
    setIsPreviewVisible(true);
  };

  const handleSavePlace = async () => {
    if (!selectedPreview) return;
    if (savedPlaceIds.has(selectedPreview.id)) {
      showToast({ message: "Place already saved", variant: "info" });
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/saved-places`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          placeId: selectedPreview.placeId || selectedPreview.id,
          title: selectedPreview.name,
          category: selectedPreview.category,
          metadata: {
            locality: selectedPreview.locality,
            fullAddress: selectedPreview.fullAddress,
            source: selectedPreview.source,
            imageUrl: selectedPreview.imageUrl,
            videoUrl: selectedPreview.videoUrl,
            lat: selectedPreview.lat ?? null,
            lng: selectedPreview.lng ?? null,
            city: selectedPreview.city ?? null,
            state: selectedPreview.state ?? null,
            country: selectedPreview.country ?? null,
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
      publishSavedToCategoryFeed(selectedPreview);
      setSavedPlaceIds((current) => new Set(current).add(selectedPreview.id));
      setSaveMessage(`Saved to ${selectedPreview.category}`);
      showToast({ message: `Saved to ${selectedPreview.category}`, variant: "success" });
      removeDetectedWithAnimation(selectedPreview);
    } catch {
      showToast({ message: "Couldn’t connect. Please try again.", variant: "error" });
    }
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
    setDetectedPlaces((prev) => prev.map((item) => (item.id === selectedPreview.id ? { ...item, name, locality, fullAddress: fullAddress || item.fullAddress } : item)));
    setIsEditing(false);
    showToast({ message: "Details updated", variant: "success" });
  };

  const handleRefreshInput = () => {
    analyzeRunRef.current = Date.now();
    setLinkInput("");
    setIsAnalyzing(false);
    setElapsedSeconds(0);
    setHasAnalyzed(false);
    setDetectedPlaces([]);
    setPendingJobs([]);
    setSelectedDetectedCategory("Auto-detect");
    setSelectedPreviewIndex(0);
    setIsPreviewVisible(true);
    setSaveMessage("");
    setSavedPlaceIds(new Set());
    setIsEditing(false);
    clearPersistedDraftState();
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
    setSelectedPreviewIndex(0);
    setIsPreviewVisible(true);
    setIsEditing(false);
    showToast({ message: "Place removed", variant: "info" });
  };

  const getChipCount = (chip: "Auto-detect" | DetectedCategory) => {
    if (chip === "Auto-detect") return categoryCounts.total;
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
          <input type="url" value={linkInput} onChange={(event) => setLinkInput(event.target.value)} placeholder="Paste link here..." className="wr-add-link-input" />
        </label>

        <button type="button" className={`wr-add-analyze-btn ${isAnalyzing ? "is-loading" : ""}`} disabled={isAnalyzing || !linkInput.trim()} onClick={handleAnalyze}>
          <span>{isAnalyzing ? "Turning scroll into stroll..." : "Analyze link"}</span>
          {isAnalyzing ? <span className="wr-add-stroll-loader" aria-hidden="true"><span /><span /><span /><span /></span> : null}
        </button>
      </article>

      {hasAnalyzed ? (
        <section className="wr-add-detected-wrap is-ready" aria-label="Detected places">
          <div className="wr-add-detected-head"><p>{isResolvingFinal ? "Detected draft (resolving...)" : "Detected from this link"}</p><span>{categoryCounts.total} places</span></div>

          <div className="wr-add-chip-row">
            {chipOrder.map((chip) => {
              const count = getChipCount(chip);
              const isSelected = selectedDetectedCategory === chip;
              return (
                <button type="button" key={chip} className={`wr-add-chip is-${chip.replace("Auto-detect", "auto").toLowerCase().replace(" ", "-")} ${isSelected ? "is-selected" : ""}`} onClick={() => handleCategorySelect(chip)}>
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
                {isEditing ? (
                  <>
                    <input className="wr-add-edit-input" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Place name" />
                    <input className="wr-add-edit-input" value={editLocality} onChange={(e) => setEditLocality(e.target.value)} placeholder="Locality" />
                    <input className="wr-add-edit-input" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="Full address" />
                    <div className="wr-add-preview-actions">
                      <button type="button" className="wr-add-preview-btn" onClick={() => setIsEditing(false)}>Cancel</button>
                      <button type="button" className="wr-add-preview-btn is-primary" onClick={handleApplyEdit}>Apply</button>
                    </div>
                  </>
                ) : (
                  <>
                    <h4>{selectedPreview.name}</h4>
                    {isResolvingFinal ? (
                      <>
                        <p>Detecting and navigating for you...</p>
                        <p>You can continue scrolling · {elapsedSeconds}s</p>
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
                  </>
                )}
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
      ) : (
        <section className="wr-add-empty-state" aria-label="Detected preview empty state">Your detected place will appear here.</section>
      )}
    </section>
  );
}


