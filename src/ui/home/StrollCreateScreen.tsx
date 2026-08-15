import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import {
  STROLL_INTEREST_OPTIONS,
  buildDraftStrollPayload,
  canSubmitDraftStroll,
  createDraftStroll,
  createStrollClientRequestId,
  getDefaultStrollCity,
  type DraftStrollSeed,
  type DraftStrollSummary,
} from "./strollOnboarding";
import { curateStroll } from "./strollLibrary";

const API_BASE_URL = (() => {
  const configured = String(import.meta.env.VITE_API_BASE_URL || "").trim();
  const isLocalDevUrl = /:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured);
  if (import.meta.env.PROD) return configured && !isLocalDevUrl ? configured : "https://api.wandreel.com";
  return configured || "http://localhost:8787";
})();

type StrollCreateScreenProps = {
  currentLocationLabel: string;
  isLocating: boolean;
  searchLocations: (query: string) => Promise<LocationSuggestion[]>;
  requestCurrentLocation: () => Promise<{ ok: boolean; coords?: { lat: number; lng: number }; reason?: string }>;
  onBack: () => void;
  onCreated: (input: { stroll: DraftStrollSummary; seed: DraftStrollSeed; mode: "draft" | "generate"; curationStarted: boolean }) => void;
};

type LocationSuggestion = {
  placeId: string;
  label: string;
  secondaryText: string | null;
  description: string | null;
};

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
    // Native pickers may require a direct user gesture; focus still guides the next step.
  }
}

export function StrollCreateScreen({
  currentLocationLabel,
  isLocating,
  searchLocations,
  requestCurrentLocation,
  onBack,
  onCreated,
}: StrollCreateScreenProps) {
  const [city, setCity] = useState(() => getDefaultStrollCity(currentLocationLabel));
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [requestedStartTime, setRequestedStartTime] = useState("");
  const [travellerCount, setTravellerCount] = useState(2);
  const [radiusKm, setRadiusKm] = useState(10);
  const [interests, setInterests] = useState<string[]>(["Food"]);
  const [includedCoords, setIncludedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [submittingAction, setSubmittingAction] = useState<"draft" | "generate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCityMenuOpen, setIsCityMenuOpen] = useState(false);
  const [cityQuery, setCityQuery] = useState("");
  const [cityResults, setCityResults] = useState<LocationSuggestion[]>([]);
  const [isCitySearching, setIsCitySearching] = useState(false);
  const [citySearchUnavailable, setCitySearchUnavailable] = useState(false);
  const cityPickerRef = useRef<HTMLDivElement | null>(null);
  const endDateInputRef = useRef<HTMLInputElement | null>(null);
  const startTimeInputRef = useRef<HTMLInputElement | null>(null);
  const travellerSelectRef = useRef<HTMLSelectElement | null>(null);

  const isSubmitting = submittingAction !== null;
  const submitEnabled = canSubmitDraftStroll({ city, isSubmitting });

  useEffect(() => {
    if (!isCityMenuOpen) {
      setCityQuery(city);
    }
  }, [city, isCityMenuOpen]);

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
        setCityResults(await searchLocations(query));
      } catch {
        setCityResults([]);
        setCitySearchUnavailable(true);
      } finally {
        setIsCitySearching(false);
      }
    }, 220);
    return () => window.clearTimeout(handle);
  }, [cityQuery, isCityMenuOpen, searchLocations]);

  const toggleInterest = (interest: string) => {
    setInterests((current) => (
      current.includes(interest)
        ? current.filter((item) => item !== interest)
        : [...current, interest].slice(0, 10)
    ));
  };

  const includeCurrentLocation = async () => {
    setError(null);
    const result = await requestCurrentLocation();
    if (!result.ok || !result.coords) {
      setError(result.reason === "permission_denied" ? "Location permission was denied." : "Could not read current location.");
      return;
    }
    setIncludedCoords(result.coords);
  };

  const openCityMenu = () => {
    if (isSubmitting) return;
    setCityQuery(city || getDefaultStrollCity(currentLocationLabel));
    setIsCityMenuOpen(true);
  };

  const selectCity = (label: string) => {
    const cityName = getDefaultStrollCity(label) || label.trim();
    setCity(cityName);
    setCityQuery(cityName);
    setIsCityMenuOpen(false);
  };

  const submitDraft = async (mode: "draft" | "generate") => {
    if (!submitEnabled) return;
    setSubmittingAction(mode);
    setError(null);
    try {
      const payload = buildDraftStrollPayload({
        clientRequestId: createStrollClientRequestId(),
        city,
        startDate,
        endDate,
        requestedStartTime,
        travellerCount,
        radiusKm,
        interests,
        coords: includedCoords,
      });
      const stroll = await createDraftStroll(API_BASE_URL, payload);
      let nextStroll = stroll;
      let curationStarted = false;
      if (mode === "generate") {
        try {
          const curated = await curateStroll(API_BASE_URL, stroll.id);
          nextStroll = curated.stroll;
          curationStarted = true;
        } catch {
          curationStarted = false;
        }
      }
      onCreated({
        stroll: nextStroll,
        seed: {
          name: payload.name,
          city: payload.city,
          radiusKm: payload.radiusKm,
          startDate: payload.startDate ?? "",
          endDate: payload.endDate ?? "",
          requestedStartTime: payload.requestedStartTime ?? "",
          travellerCount: payload.travellerCount ?? 2,
          interests: payload.interests,
          latitude: payload.latitude ?? null,
          longitude: payload.longitude ?? null,
          placeIds: payload.placeIds,
        },
        mode,
        curationStarted,
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not create draft Stroll.");
    } finally {
      setSubmittingAction(null);
    }
  };

  return (
    <section className="wr-stroll-create-screen" aria-label="Create a new Stroll">
      <header className="wr-stroll-create-header">
        <button type="button" className="wr-header-back" aria-label="Back" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <p>Create Stroll</p>
          <h2>Start with a simple draft</h2>
        </div>
      </header>

      <div className="wr-stroll-form-card">
        <label className="wr-stroll-field">
          <span>City</span>
          <div className="wr-stroll-city-picker" ref={cityPickerRef}>
            <input
              value={isCityMenuOpen ? cityQuery : city}
              autoComplete="off"
              aria-expanded={isCityMenuOpen}
              aria-controls="wr-stroll-create-city-menu"
              onFocus={openCityMenu}
              onClick={openCityMenu}
              onChange={(event) => {
                setCityQuery(event.target.value);
                setCity(event.target.value);
                setIsCityMenuOpen(true);
              }}
              placeholder="Patna"
            />
            {isCityMenuOpen ? (
              <div className="wr-stroll-city-menu" id="wr-stroll-create-city-menu" role="listbox">
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
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
                focusAndOpenPicker(endDateInputRef.current);
              }}
            />
          </label>
          <label className="wr-stroll-field">
            <span>End date</span>
            <input
              ref={endDateInputRef}
              type="date"
              value={endDate}
              onChange={(event) => {
                setEndDate(event.target.value);
                focusAndOpenPicker(startTimeInputRef.current);
              }}
            />
          </label>
        </div>

        <label className="wr-stroll-field">
          <span>Distance radius</span>
          <div className="wr-stroll-radius-field">
            <div className="wr-stroll-radius-copy">
              <strong>{radiusKm} km</strong>
              <p>We will look for saved places around your selected start area within this radius.</p>
            </div>
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={radiusKm}
              onChange={(event) => setRadiusKm(Math.max(1, Math.min(100, Number(event.target.value) || 10)))}
              className="wr-stroll-radius-slider"
              aria-label="Stroll distance radius in kilometers"
            />
            <div className="wr-stroll-radius-scale" aria-hidden="true">
              <span>1 km</span>
              <span>100 km</span>
            </div>
          </div>
        </label>

        <div className="wr-stroll-field-grid">
          <label className="wr-stroll-field">
            <span>Start time</span>
            <input
              ref={startTimeInputRef}
              type="time"
              value={requestedStartTime}
              onChange={(event) => {
                setRequestedStartTime(event.target.value);
                focusAndOpenPicker(travellerSelectRef.current);
              }}
            />
          </label>
          <label className="wr-stroll-field">
            <span>Travellers</span>
            <select
              ref={travellerSelectRef}
              value={travellerCount}
              onChange={(event) => setTravellerCount(Math.min(10, Math.max(1, Number(event.target.value) || 1)))}
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
                className={`wr-stroll-interest-chip ${interests.includes(interest) ? "is-selected" : ""}`}
                onClick={() => toggleInterest(interest)}
              >
                {interest}
              </button>
            ))}
          </div>
          <p className="wr-stroll-interest-note" aria-live="polite">
            {interests.length
              ? `Your curated Stroll will consider ${formatInterestList(interests)} while suggesting stops.`
              : "Choose at least one interest so Wandreel can shape the suggestions."}
          </p>
        </div>

        <div className="wr-stroll-location-opt">
          <div>
            <strong>Current location</strong>
            <span>
              {includedCoords
                ? `Included (${includedCoords.lat.toFixed(4)}, ${includedCoords.lng.toFixed(4)})`
                : "Only added if you request it."}
            </span>
          </div>
          {includedCoords ? (
            <button type="button" onClick={() => setIncludedCoords(null)}>Remove</button>
          ) : (
            <button type="button" disabled={isLocating} onClick={() => void includeCurrentLocation()}>
              {isLocating ? "Locating..." : "Use location"}
            </button>
          )}
        </div>

        {error ? <p className="wr-stroll-error" role="alert">{error}</p> : null}

        <div className="wr-stroll-create-actions">
          <button
            type="button"
            className="wr-stroll-submit-secondary"
            disabled={!submitEnabled}
            onClick={() => void submitDraft("draft")}
          >
            {submittingAction === "draft" ? "Saving..." : "Save Draft"}
          </button>
          <button
            type="button"
            className="wr-stroll-submit"
            disabled={!submitEnabled}
            onClick={() => void submitDraft("generate")}
          >
            {submittingAction === "generate" ? "Starting..." : "Save & Generate"}
          </button>
        </div>
      </div>
    </section>
  );
}
