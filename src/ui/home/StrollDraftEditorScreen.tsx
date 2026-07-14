import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, LoaderCircle, Play, RefreshCw, Trash2 } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { useDialogFocus } from "./useDialogFocus";
import { getDefaultStrollCity, STROLL_INTEREST_OPTIONS, type DraftStrollSeed, type DraftStrollSummary } from "./strollOnboarding";
import {
  getStrollDraftAutosaveLabel,
  getStrollDraftProgressCopy,
  STROLL_DRAFT_AUTOSAVE_DEBOUNCE_MS,
  STROLL_DRAFT_AUTOSAVE_STICKY_MS,
  type StrollDraftAutosaveStatus,
} from "./strollDraftLifecycle";
import {
  archiveStroll,
  curateStroll,
  fetchStrollDetail,
  fetchStrollStatus,
  updateDraftStroll,
  type PersistentStrollDetail,
  type PersistentStrollSummary,
} from "./strollLibrary";

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "http://localhost:8787";

type DraftStrollEditorScreenProps = {
  strollId: string;
  seed?: DraftStrollSeed | null;
  initialStrollSummary?: DraftStrollSummary | null;
  currentLocationLabel: string;
  searchLocations: (query: string) => Promise<LocationSuggestion[]>;
  onBack: () => void;
  onStartStroll: (stroll: PersistentStrollSummary) => void;
  onArchiveComplete: () => void;
};

type LocationSuggestion = {
  placeId: string;
  label: string;
  secondaryText: string | null;
  description: string | null;
};

type DraftState = {
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
  updatedAt: string | null;
};

function toDraftState(detail: PersistentStrollDetail | null | undefined): DraftState {
  const placeIds = detail && "stops" in detail && Array.isArray(detail.stops)
    ? detail.stops.map((stop) => stop.placeId).filter((placeId): placeId is string => Boolean(placeId))
    : [];
  return {
    name: detail?.name || "Stroll",
    city: detail?.city || "",
    startDate: detail?.startDate || "",
    endDate: detail?.endDate || "",
    requestedStartTime: detail?.requestedStartTime || "",
    travellerCount: detail?.travellerCount ?? 2,
    interests: Array.isArray(detail?.interests) ? detail.interests : [],
    latitude: detail?.latitude ?? null,
    longitude: detail?.longitude ?? null,
    placeIds,
    updatedAt: detail?.updatedAt || null,
  };
}

function toSeedState(seed: DraftStrollSeed | null | undefined): DraftState {
  return {
    name: seed?.name || "Stroll",
    city: seed?.city || "",
    startDate: seed?.startDate || "",
    endDate: seed?.endDate || "",
    requestedStartTime: seed?.requestedStartTime || "",
    travellerCount: seed?.travellerCount ?? 2,
    interests: seed?.interests?.length ? seed.interests : ["Food"],
    latitude: seed?.latitude ?? null,
    longitude: seed?.longitude ?? null,
    placeIds: seed?.placeIds ?? [],
    updatedAt: null,
  };
}

function toSummaryDetail(summary: DraftStrollSummary | null | undefined): PersistentStrollSummary | null {
  if (!summary) return null;
  return {
    id: summary.id,
    name: summary.name,
    description: null,
    city: summary.city,
    status: summary.status,
    source: summary.source,
    startDate: null,
    endDate: null,
    requestedStartTime: null,
    travellerCount: null,
    interests: [],
    latitude: null,
    longitude: null,
    totalDistanceMeters: null,
    estimatedDurationMinutes: null,
    stopCount: summary.stopCount,
    failureCode: null,
    failureMessage: null,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    curatedAt: null,
    archivedAt: null,
  };
}

function isEditableStatus(status: PersistentStrollSummary["status"]) {
  return status === "draft" || status === "failed";
}

function isProgressStatus(status: PersistentStrollSummary["status"]) {
  return status === "queued" || status === "curating";
}

function statusLabel(status: PersistentStrollSummary["status"]) {
  if (status === "queued") return "Queued";
  if (status === "curating") return "Curating";
  if (status === "ready") return "Ready";
  if (status === "failed") return "Failed";
  return "Draft";
}

function statusTone(status: PersistentStrollSummary["status"]) {
  if (status === "queued" || status === "curating") return "working";
  if (status === "ready") return "ready";
  if (status === "failed") return "failed";
  return "draft";
}

function draftFingerprint(draft: DraftState) {
  return JSON.stringify({
    name: draft.name,
    city: draft.city,
    startDate: draft.startDate,
    endDate: draft.endDate,
    requestedStartTime: draft.requestedStartTime,
    travellerCount: draft.travellerCount,
    interests: draft.interests,
    latitude: draft.latitude,
    longitude: draft.longitude,
    placeIds: draft.placeIds,
  });
}

function formatInterestList(interests: string[]) {
  if (interests.length <= 1) return interests[0] ?? "";
  if (interests.length === 2) return `${interests[0]} and ${interests[1]}`;
  return `${interests.slice(0, -1).join(", ")}, and ${interests[interests.length - 1]}`;
}

function focusAndOpenPicker(element: HTMLInputElement | HTMLSelectElement | null) {
  if (!element) return;
  element.focus();
  try {
    (element as (HTMLInputElement | HTMLSelectElement) & { showPicker?: () => void }).showPicker?.();
  } catch {
    // Some browsers only allow native pickers during a direct user gesture; focus still advances the flow.
  }
}

export function StrollDraftEditorScreen({
  strollId,
  seed,
  initialStrollSummary,
  currentLocationLabel,
  searchLocations,
  onBack,
  onStartStroll,
  onArchiveComplete,
}: DraftStrollEditorScreenProps) {
  const prefersReducedMotion = useReducedMotion();
  const [stroll, setStroll] = useState<PersistentStrollDetail | PersistentStrollSummary | null>(() => toSummaryDetail(initialStrollSummary));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(() => toSeedState(seed));
  const [autosaveStatus, setAutosaveStatus] = useState<StrollDraftAutosaveStatus>("idle");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pollingTick, setPollingTick] = useState(0);
  const [isCityMenuOpen, setIsCityMenuOpen] = useState(false);
  const [cityQuery, setCityQuery] = useState("");
  const [cityResults, setCityResults] = useState<LocationSuggestion[]>([]);
  const [isCitySearching, setIsCitySearching] = useState(false);
  const [citySearchUnavailable, setCitySearchUnavailable] = useState(false);
  const dialogRef = useDialogFocus<HTMLElement>(true, onBack);
  const cityPickerRef = useRef<HTMLDivElement | null>(null);
  const endDateInputRef = useRef<HTMLInputElement | null>(null);
  const startTimeInputRef = useRef<HTMLInputElement | null>(null);
  const travellerSelectRef = useRef<HTMLSelectElement | null>(null);
  const dirtyRef = useRef(false);
  const draftRef = useRef(draft);
  const strollRef = useRef<PersistentStrollDetail | PersistentStrollSummary | null>(stroll);
  const savedFingerprintRef = useRef(draftFingerprint(draft));
  const autosaveTimerRef = useRef<number | null>(null);
  const autosaveResetTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef<Promise<PersistentStrollSummary | null> | null>(null);
  const pendingAutosaveRef = useRef(false);
  const lastSavedSummaryRef = useRef<PersistentStrollSummary | null>(toSummaryDetail(initialStrollSummary));
  const saveLatestDraftRef = useRef<(mode: "autosave" | "generate") => Promise<PersistentStrollSummary | null>>(() => Promise.resolve(null));

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    strollRef.current = stroll;
  }, [stroll]);

  useEffect(() => {
    if (!isCityMenuOpen) {
      setCityQuery(draft.city);
    }
  }, [draft.city, isCityMenuOpen]);

  useEffect(() => {
    if (!isCityMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!cityPickerRef.current?.contains(event.target as Node)) {
        setIsCityMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isCityMenuOpen]);

  useEffect(() => {
    if (!isCityMenuOpen) return;
    const handle = window.setTimeout(async () => {
      const query = cityQuery.trim();
      if (query.length < 2) {
        setCityResults([]);
        setCitySearchUnavailable(false);
        return;
      }
      setIsCitySearching(true);
      setCitySearchUnavailable(false);
      try {
        const nextResults = await searchLocations(query);
        setCityResults(nextResults);
      } catch {
        setCityResults([]);
        setCitySearchUnavailable(true);
      } finally {
        setIsCitySearching(false);
      }
    }, 220);
    return () => window.clearTimeout(handle);
  }, [cityQuery, isCityMenuOpen, searchLocations]);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    fetchStrollDetail(API_BASE_URL, strollId)
      .then((detail) => {
        if (cancelled) return;
        setStroll(detail);
        if (!dirtyRef.current) {
          const loadedDraft = toDraftState(detail);
          setDraft(loadedDraft);
          lastSavedSummaryRef.current = detail;
          savedFingerprintRef.current = draftFingerprint(loadedDraft);
          setDirty(false);
          setAutosaveStatus("idle");
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Could not load this Stroll.");
      });
    return () => {
      cancelled = true;
    };
  }, [strollId]);

  useEffect(() => {
    if (!stroll || !isProgressStatus(stroll.status)) return;
    const intervalId = window.setInterval(() => setPollingTick((current) => current + 1), prefersReducedMotion ? 3000 : 2500);
    return () => window.clearInterval(intervalId);
  }, [prefersReducedMotion, stroll]);

  useEffect(() => {
    if (!stroll || !isProgressStatus(stroll.status)) return;
    let cancelled = false;
    fetchStrollStatus(API_BASE_URL, strollId)
      .then((summary) => {
        if (cancelled) return;
        setStroll(summary);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pollingTick, stroll, strollId]);

  useEffect(() => () => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    if (autosaveResetTimerRef.current !== null) {
      window.clearTimeout(autosaveResetTimerRef.current);
    }
  }, []);

  const currentStatus = stroll?.status ?? "draft";
  const canEdit = isEditableStatus(currentStatus);
  const canGenerate = Boolean(dirty || canEdit);
  const autosaveLabel = getStrollDraftAutosaveLabel(autosaveStatus);
  const pageTitle = useMemo(() => {
    if (!stroll) return "Stroll";
    if (currentStatus === "ready") return stroll.name;
    if (currentStatus === "queued" || currentStatus === "curating") return statusLabel(currentStatus);
    return draft.name || stroll.name;
  }, [currentStatus, draft.name, stroll]);
  const progressCopy = useMemo(() => getStrollDraftProgressCopy(currentStatus), [currentStatus]);

  const toggleInterest = (interest: string) => {
    if (!canEdit) return;
    setDraft((current) => ({
      ...current,
      interests: current.interests.includes(interest)
        ? current.interests.filter((item) => item !== interest)
        : [...current.interests, interest].slice(0, 10),
    }));
    setDirty(true);
  };

  const updateDraft = (patch: Partial<DraftState>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  };

  const openCityMenu = () => {
    if (!canEdit) return;
    setCityQuery(draft.city || getDefaultStrollCity(currentLocationLabel));
    setIsCityMenuOpen(true);
  };

  const selectCity = (label: string) => {
    const cityName = getDefaultStrollCity(label) || label.trim();
    updateDraft({ city: cityName });
    setCityQuery(cityName);
    setIsCityMenuOpen(false);
  };

  const saveLatestDraft = async (mode: "autosave" | "generate"): Promise<PersistentStrollSummary | null> => {
    const activeStroll = strollRef.current;
    if (!activeStroll || !canEdit) return null;

    const currentDraft = draftRef.current;
    const currentFingerprint = draftFingerprint(currentDraft);
    if (currentFingerprint === savedFingerprintRef.current) {
      return lastSavedSummaryRef.current ?? (activeStroll as PersistentStrollSummary);
    }

    if (!currentDraft.city.trim()) {
      if (mode === "generate") {
        setActionError("City is required before generation.");
      }
      return null;
    }

    if (saveInFlightRef.current) {
      if (mode === "autosave") {
        pendingAutosaveRef.current = true;
        return lastSavedSummaryRef.current;
      }
      await saveInFlightRef.current;
      if (draftFingerprint(draftRef.current) !== savedFingerprintRef.current) {
        return saveLatestDraft(mode);
      }
      return lastSavedSummaryRef.current;
    }

    const requestPayload = {
      updatedAt: currentDraft.updatedAt ?? activeStroll.updatedAt,
      name: currentDraft.name.trim() || undefined,
      city: currentDraft.city.trim(),
      startDate: currentDraft.startDate || null,
      endDate: currentDraft.endDate || null,
      requestedStartTime: currentDraft.requestedStartTime || null,
      travellerCount: currentDraft.travellerCount,
      interests: currentDraft.interests,
      latitude: currentDraft.latitude,
      longitude: currentDraft.longitude,
      placeIds: currentDraft.placeIds,
    };

    const request = updateDraftStroll(API_BASE_URL, activeStroll.id, requestPayload);
    saveInFlightRef.current = request;
    if (mode === "autosave") {
      setActionError(null);
      setAutosaveStatus("saving");
    }

    try {
      const saved = await request;
      if (saved) {
        const savedSnapshot = currentFingerprint;
        savedFingerprintRef.current = savedSnapshot;
        lastSavedSummaryRef.current = saved;
        setStroll(saved);
        setDraft((current) => {
          const currentSnapshot = draftFingerprint(current);
          if (currentSnapshot === savedSnapshot) {
            return { ...current, updatedAt: saved.updatedAt, name: saved.name, city: saved.city };
          }
          return { ...current, updatedAt: saved.updatedAt };
        });
        const stillDirty = draftFingerprint(draftRef.current) !== savedSnapshot;
        setDirty(stillDirty);
        if (mode === "autosave") {
          setAutosaveStatus("saved");
          if (autosaveResetTimerRef.current !== null) {
            window.clearTimeout(autosaveResetTimerRef.current);
          }
          autosaveResetTimerRef.current = window.setTimeout(() => {
            if (!dirtyRef.current) {
              setAutosaveStatus("idle");
            }
          }, STROLL_DRAFT_AUTOSAVE_STICKY_MS);
        }
      }
      return saved;
    } catch (error) {
      if (mode === "autosave") {
        setAutosaveStatus("error");
      } else {
        setActionError(error instanceof Error ? error.message : "Could not generate this Stroll.");
      }
      return null;
    } finally {
      saveInFlightRef.current = null;
      if (pendingAutosaveRef.current && dirtyRef.current) {
        pendingAutosaveRef.current = false;
        window.setTimeout(() => {
          void saveLatestDraftRef.current("autosave");
        }, 0);
      } else {
        pendingAutosaveRef.current = false;
      }
    }
  };

  saveLatestDraftRef.current = saveLatestDraft;

  const generateDraft = async () => {
    if (!stroll || !canGenerate || isGenerating || isArchiving) return;
    setIsGenerating(true);
    setActionError(null);
    try {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      pendingAutosaveRef.current = false;
      let saved = await saveLatestDraftRef.current("generate");
      if (!saved) return;
      if (draftFingerprint(draftRef.current) !== savedFingerprintRef.current) {
        saved = await saveLatestDraftRef.current("generate");
      }
      if (!saved) return;
      const result = await curateStroll(API_BASE_URL, saved.id);
      setStroll(result.stroll);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not generate this Stroll.");
    } finally {
      setIsGenerating(false);
    }
  };

  const archiveDraft = async () => {
    if (!stroll || isArchiving) return;
    const confirmed = window.confirm("Delete this draft Stroll?");
    if (!confirmed) return;
    setIsArchiving(true);
    setActionError(null);
    try {
      const archived = await archiveStroll(API_BASE_URL, stroll.id);
      if (archived) {
        onArchiveComplete();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not archive this draft.");
    } finally {
      setIsArchiving(false);
    }
  };

  useEffect(() => {
    if (!canEdit) {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      return;
    }
    if (saveInFlightRef.current) {
      pendingAutosaveRef.current = true;
      return;
    }
    if (!dirty) {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      return;
    }
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    if (autosaveResetTimerRef.current !== null) {
      window.clearTimeout(autosaveResetTimerRef.current);
      autosaveResetTimerRef.current = null;
    }
    setAutosaveStatus("pending");
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void saveLatestDraftRef.current("autosave");
    }, STROLL_DRAFT_AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [canEdit, dirty, draft]);

  const startStroll = () => {
    if (!stroll) return;
    onStartStroll(stroll as PersistentStrollSummary);
  };

  const footerActions = (
    <div className="wr-stroll-draft-actions">
      {canEdit ? (
        <>
          <button type="button" className="wr-stroll-draft-generate" disabled={isGenerating || isArchiving || !canGenerate} onClick={() => void generateDraft()}>
            {isGenerating ? "Working..." : "Generate My Stroll"}
          </button>
        </>
      ) : null}
      {currentStatus === "ready" ? (
        <button type="button" className="wr-stroll-draft-generate" onClick={startStroll}>
          <Play size={14} /> Start Stroll
        </button>
      ) : null}
      {currentStatus === "queued" || currentStatus === "curating" ? (
        <button type="button" className="wr-stroll-draft-generate" onClick={() => setPollingTick((current) => current + 1)}>
          <RefreshCw size={14} /> View Progress
        </button>
      ) : null}
      {currentStatus === "draft" || currentStatus === "failed" ? (
        <button type="button" className="wr-stroll-draft-delete" disabled={isArchiving || isGenerating} onClick={() => void archiveDraft()}>
          <Trash2 size={14} /> Delete Draft
        </button>
      ) : null}
    </div>
  );

  return (
    <section className={`wr-stroll-draft-screen ${prefersReducedMotion ? "is-reduced-motion" : ""}`} aria-label={`${pageTitle} Stroll`}>
      <header className="wr-stroll-draft-header">
        <button type="button" className="wr-header-back" aria-label="Back" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <p>Stroll Draft</p>
          <h2>{pageTitle}</h2>
        </div>
      </header>

      <article className="wr-stroll-draft-status-card" ref={dialogRef}>
        {loadError ? <p className="wr-stroll-error" role="alert">{loadError}</p> : null}
        {actionError ? <p className="wr-stroll-error" role="alert">{actionError}</p> : null}
        {autosaveLabel ? <p className="wr-stroll-status-note" aria-live="polite">{autosaveLabel}</p> : null}
        {currentStatus ? <span className={`wr-stroll-status-badge is-${statusTone(currentStatus)}`}>{statusLabel(currentStatus)}</span> : null}
        <p className="wr-stroll-draft-summary">{progressCopy}</p>
      </article>

      {canEdit ? (
        <div className="wr-stroll-form-card">
          <label className="wr-stroll-field">
            <span>City</span>
            <div className="wr-stroll-city-picker" ref={cityPickerRef}>
              <input
                value={isCityMenuOpen ? cityQuery : draft.city}
                autoComplete="off"
                aria-expanded={isCityMenuOpen}
                aria-controls="wr-stroll-city-menu"
                onFocus={openCityMenu}
                onClick={openCityMenu}
                onChange={(event) => {
                  setCityQuery(event.target.value);
                  updateDraft({ city: event.target.value });
                  setIsCityMenuOpen(true);
                }}
              />
              {isCityMenuOpen ? (
                <div className="wr-stroll-city-menu" id="wr-stroll-city-menu" role="listbox">
                  <button type="button" className="wr-stroll-city-option is-current" onClick={() => selectCity(currentLocationLabel)}>
                    <strong>Current city</strong>
                    <span>{currentLocationLabel}</span>
                  </button>
                  {isCitySearching ? <p className="wr-stroll-city-helper">Finding cities...</p> : null}
                  {!isCitySearching && cityResults.length > 0 ? cityResults.map((result) => (
                    <button type="button" className="wr-stroll-city-option" key={result.placeId} onClick={() => selectCity(result.label)}>
                      <strong>{result.label}</strong>
                      {result.secondaryText || result.description ? <span>{result.secondaryText || result.description}</span> : null}
                    </button>
                  )) : null}
                  {!isCitySearching && citySearchUnavailable ? <p className="wr-stroll-city-helper">City suggestions are unavailable. You can still type the city.</p> : null}
                  {!isCitySearching && !citySearchUnavailable && cityQuery.trim().length >= 2 && cityResults.length === 0 ? (
                    <p className="wr-stroll-city-helper">Keep typing or use the city as entered.</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </label>

          <div className="wr-stroll-field-grid">
            <label className="wr-stroll-field">
              <span>Start date</span>
              <input
                type="date"
                value={draft.startDate}
                onChange={(event) => {
                  updateDraft({ startDate: event.target.value });
                  focusAndOpenPicker(endDateInputRef.current);
                }}
              />
            </label>
            <label className="wr-stroll-field">
              <span>End date</span>
              <input
                ref={endDateInputRef}
                type="date"
                value={draft.endDate}
                onChange={(event) => {
                  updateDraft({ endDate: event.target.value });
                  focusAndOpenPicker(startTimeInputRef.current);
                }}
              />
            </label>
          </div>

          <div className="wr-stroll-field-grid">
            <label className="wr-stroll-field">
              <span>Start time</span>
              <input
                ref={startTimeInputRef}
                type="time"
                value={draft.requestedStartTime}
                onChange={(event) => {
                  updateDraft({ requestedStartTime: event.target.value });
                  focusAndOpenPicker(travellerSelectRef.current);
                }}
              />
            </label>
            <label className="wr-stroll-field">
              <span>Travellers</span>
              <select
                ref={travellerSelectRef}
                value={draft.travellerCount}
                onChange={(event) => {
                  updateDraft({ travellerCount: Math.min(10, Math.max(1, Number(event.target.value) || 1)) });
                }}
              >
                {Array.from({ length: 10 }, (_, index) => index + 1).map((count) => (
                  <option key={count} value={count}>{count} {count === 1 ? "traveller" : "travellers"}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="wr-stroll-field">
            <span>Interests</span>
            <div className="wr-stroll-interest-grid">
              {STROLL_INTEREST_OPTIONS.map((interest) => (
                <button
                  type="button"
                  key={interest}
                  className={`wr-stroll-interest-chip ${draft.interests.includes(interest) ? "is-selected" : ""}`}
                  onClick={() => toggleInterest(interest)}
                >
                  {interest}
                </button>
              ))}
            </div>
            <p className="wr-stroll-interest-note" aria-live="polite">
              {draft.interests.length
                ? `Your curated Stroll will consider ${formatInterestList(draft.interests)} while suggesting stops.`
                : "Choose at least one interest so Wandreel can shape the suggestions."}
            </p>
          </div>

          <div className="wr-stroll-location-opt">
            <div>
              <strong>Current location</strong>
              <span>
                {draft.latitude !== null && draft.longitude !== null
                  ? `Included (${draft.latitude.toFixed(4)}, ${draft.longitude.toFixed(4)})`
                  : "Not included."}
              </span>
            </div>
          </div>
          {footerActions}
        </div>
      ) : (
        <div className="wr-stroll-draft-progress">
          <div className="wr-stroll-draft-progress-icon" aria-hidden="true">
            {currentStatus === "ready" ? <CheckCircle2 size={22} /> : <LoaderCircle size={22} />}
          </div>
          <h3>{currentStatus === "ready" ? "Ready to start" : "Preparing your Stroll"}</h3>
          <p>{progressCopy}</p>
          {footerActions}
        </div>
      )}
    </section>
  );
}
