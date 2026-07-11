import { AlertTriangle, CloudSun } from "lucide-react";
import {
  filterCurrentLiveConditions,
  formatLiveConditionType,
  formatLiveFreshness,
  formatLiveProviderName,
  getLiveConditionsViewState,
  type LiveConditionsLoadState,
  type PersistentStrollLiveConditions,
} from "./strollLiveConditions";

export function StrollLiveConditionsPanel({
  loadState,
  live,
  error,
  now = new Date(),
}: {
  loadState: LiveConditionsLoadState;
  live: PersistentStrollLiveConditions | null;
  error: string | null;
  now?: Date;
}) {
  const currentConditions = filterCurrentLiveConditions(live?.conditions ?? [], now);
  const viewState = getLiveConditionsViewState({
    loadState,
    live,
    currentConditionCount: currentConditions.length,
  });
  const providerSummary = live?.providers.map((provider) => {
    const freshness = formatLiveFreshness(provider.fetchedTimestamp, now);
    return `${formatLiveProviderName(provider.provider)} ${provider.status === "success" ? freshness : "unavailable"}`;
  }).join(" - ");

  return (
    <section className={`wr-stroll-live-card is-${viewState}`} aria-label="Live Stroll conditions" aria-live="polite">
      <div className="wr-stroll-live-head">
        <span>
          <CloudSun size={15} />
          Live conditions
        </span>
        {providerSummary ? <small>{providerSummary}</small> : null}
      </div>

      {viewState === "loading" ? (
        <p>Checking verified live sources...</p>
      ) : null}

      {viewState === "unavailable" ? (
        <p>
          {error || live?.providers.find((provider) => provider.errorMessage)?.errorMessage ||
            "Live condition providers are unavailable right now. Your saved Stroll still works."}
        </p>
      ) : null}

      {viewState === "no-alerts" ? (
        <p>No current verified alerts from configured live providers.</p>
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
    </section>
  );
}
