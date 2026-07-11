import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import {
  STROLL_INTEREST_OPTIONS,
  buildDraftStrollPayload,
  canSubmitDraftStroll,
  createDraftStroll,
  createStrollClientRequestId,
  getDefaultStrollCity,
  type DraftStrollSummary,
} from "./strollOnboarding";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";

type StrollCreateScreenProps = {
  currentLocationLabel: string;
  isLocating: boolean;
  requestCurrentLocation: () => Promise<{ ok: boolean; coords?: { lat: number; lng: number }; reason?: string }>;
  onBack: () => void;
  onCreated: (stroll: DraftStrollSummary) => void;
};

export function StrollCreateScreen({
  currentLocationLabel,
  isLocating,
  requestCurrentLocation,
  onBack,
  onCreated,
}: StrollCreateScreenProps) {
  const [city, setCity] = useState(() => getDefaultStrollCity(currentLocationLabel));
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [requestedStartTime, setRequestedStartTime] = useState("");
  const [travellerCount, setTravellerCount] = useState(2);
  const [interests, setInterests] = useState<string[]>(["Food"]);
  const [includedCoords, setIncludedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitEnabled = canSubmitDraftStroll({ city, isSubmitting });

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

  const submitDraft = async () => {
    if (!submitEnabled) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const payload = buildDraftStrollPayload({
        clientRequestId: createStrollClientRequestId(),
        city,
        startDate,
        endDate,
        requestedStartTime,
        travellerCount,
        interests,
        coords: includedCoords,
      });
      const stroll = await createDraftStroll(API_BASE_URL, payload);
      onCreated(stroll);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not create draft Stroll.");
    } finally {
      setIsSubmitting(false);
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
          <input value={city} onChange={(event) => setCity(event.target.value)} placeholder="Patna" />
        </label>

        <div className="wr-stroll-field-grid">
          <label className="wr-stroll-field">
            <span>Start date</span>
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label className="wr-stroll-field">
            <span>End date</span>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
        </div>

        <div className="wr-stroll-field-grid">
          <label className="wr-stroll-field">
            <span>Start time</span>
            <input type="time" value={requestedStartTime} onChange={(event) => setRequestedStartTime(event.target.value)} />
          </label>
          <label className="wr-stroll-field">
            <span>Travellers</span>
            <input
              type="number"
              min={1}
              max={20}
              value={travellerCount}
              onChange={(event) => setTravellerCount(Math.min(20, Math.max(1, Number(event.target.value) || 1)))}
            />
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

        <button
          type="button"
          className="wr-stroll-submit"
          disabled={!submitEnabled}
          onClick={() => void submitDraft()}
        >
          {isSubmitting ? "Saving draft..." : "Create draft Stroll"}
        </button>
      </div>
    </section>
  );
}
