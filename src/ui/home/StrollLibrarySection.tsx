import type { KeyboardEvent } from "react";
import { getStrollLibraryViewState, getStrollStatusPresentation, type PersistentStrollSummary, type StrollLibraryLoadState } from "./strollLibrary";

type StrollLibrarySectionProps = {
  strolls: PersistentStrollSummary[];
  loadState: StrollLibraryLoadState;
  error: string | null;
  retryingStrollId: string | null;
  archivingStrollId: string | null;
  onCreateStroll: () => void;
  onRetryStroll: (strollId: string) => void;
  onArchiveStroll: (strollId: string) => void;
  onOpenStroll: (stroll: PersistentStrollSummary) => void;
  onStartStroll: (stroll: PersistentStrollSummary) => void;
};

function formatStrollMeta(stroll: PersistentStrollSummary) {
  const parts = [
    stroll.city,
    stroll.stopCount ? `${stroll.stopCount} stop${stroll.stopCount === 1 ? "" : "s"}` : null,
    stroll.startDate,
  ].filter(Boolean);
  return parts.join(" - ");
}

export function StrollLibrarySection({
  strolls,
  loadState,
  error,
  retryingStrollId,
  archivingStrollId,
  onCreateStroll,
  onRetryStroll,
  onArchiveStroll,
  onOpenStroll,
  onStartStroll,
}: StrollLibrarySectionProps) {
  const viewState = getStrollLibraryViewState({ loadState, strolls, error });

  const handleDraftCardKeyDown = (event: KeyboardEvent<HTMLElement>, stroll: PersistentStrollSummary) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onOpenStroll(stroll);
  };

  return (
    <section className="wr-stroll-library" aria-label="Your Strolls" aria-live="polite">
      <div className="wr-stroll-library-head">
        <div>
          <p>STROLLS</p>
          <h3>Your walking plans</h3>
        </div>
        {loadState === "loading" && strolls.length ? <span>Syncing...</span> : null}
      </div>

      <div className="wr-stroll-card-row">
        <button
          type="button"
          className="wr-stroll-plus-card"
          aria-label="Create a new Stroll draft"
          onClick={onCreateStroll}
        >
          <span aria-hidden="true">+</span>
          <strong>Create a New Stroll</strong>
          <small>Start another manual draft.</small>
        </button>

        {viewState === "loading" ? (
          <article className="wr-stroll-card is-loading" aria-label="Loading Strolls">
            <span className="wr-stroll-card-skeleton title" />
            <span className="wr-stroll-card-skeleton line" />
            <span className="wr-stroll-card-skeleton button" />
          </article>
        ) : null}

        {viewState === "error" ? (
          <article className="wr-stroll-card is-error" role="status">
            <span className="wr-stroll-status-badge is-failed">Offline</span>
            <strong>Could not load Strolls</strong>
            <small>{error || "Pull to refresh or try again later."}</small>
          </article>
        ) : null}

        {viewState === "empty" ? (
          <article className="wr-stroll-card is-empty">
            <span className="wr-stroll-status-badge is-draft">Empty</span>
            <strong>No Strolls yet</strong>
            <small>Create your first draft from saved places.</small>
          </article>
        ) : null}

        {strolls.map((stroll) => {
          const presentation = getStrollStatusPresentation(stroll.status);
          const isRetrying = retryingStrollId === stroll.id;
          const isArchiving = archivingStrollId === stroll.id;
          const isDraft = stroll.status === "draft";
          return (
            <article
              className={`wr-stroll-card is-${presentation.tone} ${isDraft ? "is-activatable" : ""}`}
              key={stroll.id}
              role={isDraft ? "button" : undefined}
              tabIndex={isDraft ? 0 : undefined}
              aria-label={isDraft ? `Open draft ${stroll.name} for editing` : undefined}
              onClick={isDraft ? () => onOpenStroll(stroll) : undefined}
              onKeyDown={isDraft ? (event) => handleDraftCardKeyDown(event, stroll) : undefined}
            >
              <div className="wr-stroll-card-top">
                <span className={`wr-stroll-status-badge is-${presentation.tone}`}>{presentation.label}</span>
                {stroll.source === "manual" || stroll.status === "draft" ? <span className="wr-stroll-source-pill">Manual</span> : null}
              </div>
              <strong>{stroll.name}</strong>
              <small>{formatStrollMeta(stroll) || presentation.title}</small>
              <p>{stroll.failureMessage || presentation.description}</p>
              <div className="wr-stroll-card-actions">
                {stroll.status === "draft" ? (
                  <>
                    <button
                      type="button"
                      className="wr-stroll-card-primary"
                      aria-label={`Continue editing ${stroll.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenStroll(stroll);
                      }}
                    >
                      Continue Editing
                    </button>
                    <button
                      type="button"
                      className="wr-stroll-card-secondary"
                      disabled={isArchiving}
                      aria-label={`Delete draft ${stroll.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onArchiveStroll(stroll.id);
                      }}
                    >
                      {isArchiving ? "Deleting..." : "Delete Draft"}
                    </button>
                  </>
                ) : null}
                {(stroll.status === "queued" || stroll.status === "curating") ? (
                  <button
                    type="button"
                    className="wr-stroll-card-primary"
                    aria-label={`View progress for ${stroll.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenStroll(stroll);
                    }}
                  >
                    View Progress
                  </button>
                ) : null}
                {stroll.status === "ready" ? (
                  <button
                    type="button"
                    className="wr-stroll-card-primary"
                    aria-label={`Start or view ${stroll.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onStartStroll(stroll);
                    }}
                  >
                    Start Stroll
                  </button>
                ) : null}
                {stroll.status === "failed" ? (
                  <>
                    <button
                      type="button"
                      className="wr-stroll-card-primary"
                      disabled={isRetrying}
                      aria-label={`Retry curation for ${stroll.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRetryStroll(stroll.id);
                      }}
                    >
                      {isRetrying ? "Retrying..." : "Retry"}
                    </button>
                    <button
                      type="button"
                      className="wr-stroll-card-secondary"
                      aria-label={`Edit inputs for ${stroll.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenStroll(stroll);
                      }}
                    >
                      Edit Inputs
                    </button>
                  </>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
