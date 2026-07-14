import { CheckCircle2, ChevronDown, GitPullRequestArrow, Info, Shuffle, X } from "lucide-react";
import { useState } from "react";
import {
  formatAdaptationEvidence,
  getAdaptationViewState,
  type StrollAdaptationLoadState,
  type StrollAdaptationRecommendation,
} from "./strollAdaptation";
import { useDialogFocus } from "./useDialogFocus";

function StrollRouteDetailsSheet({
  recommendation,
  confidenceLabel,
  onClose,
}: {
  recommendation: StrollAdaptationRecommendation;
  confidenceLabel: string;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);
  const hasEvidence = recommendation.evidence.length > 0;
  const hasLimitations = recommendation.limitations.length > 0;

  return (
    <div className="wr-stroll-detail-sheet-layer" role="presentation">
      <article
        ref={dialogRef}
        className="wr-stroll-detail-sheet wr-stroll-route-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wr-stroll-route-sheet-title"
        tabIndex={-1}
      >
        <button type="button" className="wr-stroll-detail-sheet-close" aria-label="Close route details" onClick={onClose}>
          <X size={16} />
        </button>
        <span className="wr-stroll-detail-stop-kicker">Route details</span>
        <h3 id="wr-stroll-route-sheet-title">What we checked</h3>
        <p>{confidenceLabel}. {recommendation.reason}</p>
        <div className="wr-stroll-route-detail-grid">
          <div>
            <strong>Checked for this Stroll</strong>
            {hasEvidence ? (
              recommendation.evidence.slice(0, 5).map((item, index) => (
                <span key={`${item.type}-${index}`}>{formatAdaptationEvidence(item)}</span>
              ))
            ) : (
              <span>No verified live checks were available for this route.</span>
            )}
          </div>
          <div>
            <strong>Still not included</strong>
            {hasLimitations ? (
              recommendation.limitations.map((item) => <span key={item}>{item}</span>)
            ) : (
              <span>No additional route limitations were reported.</span>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}

export function StrollAdaptationPanel({
  loadState,
  recommendation,
  error,
  dismissed,
  accepting,
  onAccept,
  onDismiss,
  onDetailsOpen,
}: {
  loadState: StrollAdaptationLoadState;
  recommendation: StrollAdaptationRecommendation | null;
  error: string | null;
  dismissed: boolean;
  accepting: boolean;
  onAccept: (stopIds: string[]) => void;
  onDismiss: () => void;
  onDetailsOpen?: (recommendation: StrollAdaptationRecommendation) => void;
}) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const viewState = getAdaptationViewState({ loadState, recommendation, dismissed });
  if (viewState === "dismissed" || viewState === "idle") return null;
  const hasTechnicalDetails = Boolean(recommendation?.evidence.length || recommendation?.limitations.length);
  const confidenceLabel = recommendation?.confidence === "high"
    ? "High confidence"
    : recommendation?.confidence === "medium"
      ? "Moderate confidence"
      : "Limited live information";

  return (
    <section className={`wr-stroll-adapt-card is-${viewState}`} aria-label="Route status" aria-live="polite">
      <div className="wr-stroll-adapt-head">
        <span>
          <Shuffle size={15} />
          Route status
        </span>
        {recommendation ? <small>{confidenceLabel}</small> : null}
      </div>

      {viewState === "loading" ? <p>Checking whether this route still feels like the best way to begin...</p> : null}
      {viewState === "error" ? (
        <p>{error || "Your route is still available. Check local conditions before heading out."}</p>
      ) : null}

      {recommendation && viewState !== "loading" && viewState !== "error" ? (
        <>
          <p>
            {recommendation.status === "recommended"
              ? recommendation.reason
              : "No weather changes needed. The route order looks good."}
          </p>

          <div className="wr-stroll-route-status-grid">
            <span>
              <CheckCircle2 size={14} />
              {recommendation.status === "recommended" ? "Weather change found" : "No weather changes needed"}
            </span>
            <span>
              <CheckCircle2 size={14} />
              {recommendation.status === "recommended" ? "Suggested order available" : "Route order looks good"}
            </span>
            <span>
              <Info size={14} />
              Traffic and venue closures not yet included
            </span>
          </div>

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

          {hasTechnicalDetails ? (
            <button
              type="button"
              className="wr-stroll-adapt-details-toggle"
              aria-haspopup="dialog"
              onClick={() => {
                onDetailsOpen?.(recommendation);
                setIsDetailsOpen(true);
              }}
            >
              View route details
              <ChevronDown size={14} />
            </button>
          ) : null}

          {hasTechnicalDetails && isDetailsOpen ? (
            <StrollRouteDetailsSheet
              recommendation={recommendation}
              confidenceLabel={confidenceLabel}
              onClose={() => setIsDetailsOpen(false)}
            />
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
