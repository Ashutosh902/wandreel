import { useState } from "react";
import { AlertTriangle, CloudSun, X } from "lucide-react";
import {
  filterCurrentLiveConditions,
  formatLiveConditionType,
  formatLiveFreshness,
  formatLiveProviderName,
  getLiveConditionsViewState,
  type LiveConditionsLoadState,
  type PersistentStrollLiveConditions,
} from "./strollLiveConditions";
import { useDialogFocus } from "./useDialogFocus";

function StrollWeatherDetailsSheet({
  live,
  error,
  currentConditionCount,
  providerSummary,
  updatedSummary,
  onClose,
}: {
  live: PersistentStrollLiveConditions | null;
  error: string | null;
  currentConditionCount: number;
  providerSummary: string | null;
  updatedSummary: string | null;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);
  const firstProvider = live?.providers[0] ?? null;
  const providerStatus = firstProvider
    ? `${formatLiveProviderName(firstProvider.provider)} ${firstProvider.status === "success" ? "checked" : "unavailable"}`
    : "Weather source unavailable";
  const rainSummary = currentConditionCount > 0
    ? "Possible disruption near this route."
    : "Low chance of disruption from verified weather checks.";

  return (
    <div className="wr-stroll-detail-sheet-layer" role="presentation">
      <article
        ref={dialogRef}
        className="wr-stroll-detail-sheet wr-stroll-weather-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wr-stroll-weather-sheet-title"
        tabIndex={-1}
      >
        <button type="button" className="wr-stroll-detail-sheet-close" aria-label="Close weather details" onClick={onClose}>
          <X size={16} />
        </button>
        <span className="wr-stroll-detail-stop-kicker">Weather details</span>
        <h3 id="wr-stroll-weather-sheet-title">
          {currentConditionCount > 0 ? "Weather may affect this Stroll" : "Good weather for this Stroll"}
        </h3>
        <div className="wr-stroll-weather-detail-grid">
          <div>
            <strong>Current conditions</strong>
            <span>{error || live?.conditions[0]?.message || "No verified weather issues are affecting this journey."}</span>
          </div>
          <div>
            <strong>Rain risk</strong>
            <span>{rainSummary}</span>
          </div>
          <div>
            <strong>Last updated</strong>
            <span>{updatedSummary || "Update unavailable"}</span>
          </div>
          <div>
            <strong>Source</strong>
            <span>{providerSummary || providerStatus}</span>
          </div>
        </div>
      </article>
    </div>
  );
}

export function StrollLiveConditionsPanel({
  loadState,
  live,
  error,
  onDetailsOpen,
  now = new Date(),
}: {
  loadState: LiveConditionsLoadState;
  live: PersistentStrollLiveConditions | null;
  error: string | null;
  onDetailsOpen?: () => void;
  now?: Date;
}) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const currentConditions = filterCurrentLiveConditions(live?.conditions ?? [], now);
  const viewState = getLiveConditionsViewState({
    loadState,
    live,
    currentConditionCount: currentConditions.length,
  });
  const providerSummary = live?.providers.map((provider) => {
    const freshness = formatLiveFreshness(provider.fetchedTimestamp, now);
    return `${formatLiveProviderName(provider.provider)} ${provider.status === "success" ? freshness : "unavailable"}`;
  }).join(" • ") || null;
  const successfulProvider = live?.providers.find((provider) => provider.status === "success") ?? null;
  const updatedSummary = successfulProvider ? formatLiveFreshness(successfulProvider.fetchedTimestamp, now) : null;

  return (
    <section className={`wr-stroll-live-card is-${viewState}`} aria-label="Weather summary" aria-live="polite">
      <div className="wr-stroll-live-head">
        <span>
          <CloudSun size={15} />
          {viewState === "alerts" ? "Weather may affect this Stroll" : "Good weather for this Stroll"}
        </span>
        {viewState !== "alerts" && updatedSummary ? <small>Low chance of disruption • Updated {updatedSummary}</small> : null}
      </div>

      {viewState === "loading" ? (
        <p>Checking for anything that may affect the route right now...</p>
      ) : null}

      {viewState === "unavailable" ? (
        <p>
          {error || live?.providers.find((provider) => provider.errorMessage)?.errorMessage ||
            "Weather update unavailable. Your Stroll is still available."}
        </p>
      ) : null}

      {viewState === "no-alerts" ? (
        <p>No current verified issues are affecting this journey.</p>
      ) : null}

      {viewState === "alerts" ? (
        <div className="wr-stroll-live-alerts" role="list">
          {currentConditions.map((condition) => (
            <article key={condition.id} className={`wr-stroll-live-alert is-${condition.severity}`} role="listitem">
              <div>
                <AlertTriangle size={15} />
                <strong>{condition.message}</strong>
              </div>
              <span>
                {formatLiveConditionType(condition.conditionType)} - {formatLiveProviderName(condition.provider)} - {formatLiveFreshness(condition.sourceTimestamp, now)}
              </span>
            </article>
          ))}
        </div>
      ) : null}
      {viewState === "alerts" && providerSummary ? <small className="wr-stroll-live-source">{providerSummary}</small> : null}
      {viewState !== "loading" ? (
        <button
          type="button"
          className="wr-stroll-live-details-button"
          onClick={() => {
            onDetailsOpen?.();
            setIsDetailsOpen(true);
          }}
        >
          Weather details
        </button>
      ) : null}
      {isDetailsOpen ? (
        <StrollWeatherDetailsSheet
          live={live}
          error={error || live?.providers.find((provider) => provider.errorMessage)?.errorMessage || null}
          currentConditionCount={currentConditions.length}
          providerSummary={providerSummary}
          updatedSummary={updatedSummary}
          onClose={() => setIsDetailsOpen(false)}
        />
      ) : null}
    </section>
  );
}
