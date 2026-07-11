import { GitPullRequestArrow, Shuffle } from "lucide-react";
import {
  formatAdaptationEvidence,
  getAdaptationViewState,
  type StrollAdaptationLoadState,
  type StrollAdaptationRecommendation,
} from "./strollAdaptation";

export function StrollAdaptationPanel({
  loadState,
  recommendation,
  error,
  dismissed,
  accepting,
  onAccept,
  onDismiss,
}: {
  loadState: StrollAdaptationLoadState;
  recommendation: StrollAdaptationRecommendation | null;
  error: string | null;
  dismissed: boolean;
  accepting: boolean;
  onAccept: (stopIds: string[]) => void;
  onDismiss: () => void;
}) {
  const viewState = getAdaptationViewState({ loadState, recommendation, dismissed });
  if (viewState === "dismissed" || viewState === "idle") return null;

  return (
    <section className={`wr-stroll-adapt-card is-${viewState}`} aria-label="Dynamic Stroll adaptation" aria-live="polite">
      <div className="wr-stroll-adapt-head">
        <span>
          <Shuffle size={15} />
          Dynamic order check
        </span>
        {recommendation ? <small>Confidence: {recommendation.confidence}</small> : null}
      </div>

      {viewState === "loading" ? <p>Checking verified inputs for a safer order...</p> : null}
      {viewState === "error" ? (
        <p>{error || "No reliable adaptation is available right now. Keep your current order."}</p>
      ) : null}

      {recommendation && viewState !== "loading" && viewState !== "error" ? (
        <>
          <p>{recommendation.reason}</p>

          {recommendation.status === "recommended" ? (
            <ol className="wr-stroll-adapt-sequence">
              {recommendation.proposedSequence.map((stop) => (
                <li key={stop.stopId}>
                  <strong>{stop.toSequence}. {stop.title}</strong>
                  <span>Was stop {stop.fromSequence}</span>
                </li>
              ))}
            </ol>
          ) : null}

          <div className="wr-stroll-adapt-evidence">
            <strong>Evidence used</strong>
            {recommendation.evidence.slice(0, 5).map((item, index) => (
              <span key={`${item.type}-${index}`}>{formatAdaptationEvidence(item)}</span>
            ))}
          </div>

          {recommendation.limitations.length ? (
            <div className="wr-stroll-adapt-limitations">
              <strong>Limitations</strong>
              {recommendation.limitations.map((item) => <span key={item}>{item}</span>)}
            </div>
          ) : null}

          <div className="wr-stroll-adapt-actions">
            <button
              type="button"
              className="wr-stroll-adapt-secondary"
              aria-label="Keep the current Stroll order"
              onClick={onDismiss}
            >
              Keep current order
            </button>
            {recommendation.status === "recommended" ? (
              <button
                type="button"
                className="wr-stroll-adapt-primary"
                disabled={accepting}
                aria-label="Accept the proposed Stroll stop order"
                onClick={() => onAccept(recommendation.proposedStopIds)}
              >
                <GitPullRequestArrow size={14} />
                {accepting ? "Applying..." : "Accept new order"}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
