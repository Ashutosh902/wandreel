import { motion, useMotionValue, useReducedMotion, useTransform, animate, type PanInfo } from "framer-motion";
import { ChevronLeft, ChevronRight, Clock3, MapPinned, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import activityArt from "../assets/categories/activity.png";
import exploreArt from "../assets/categories/explore.png";
import stayArt from "../assets/categories/stay.png";
import tasteArt from "../assets/categories/taste.png";
import golgharPatna from "../assets/hero/golghar-patna.jpeg";
import { getStrollStatusPresentation, type PersistentStrollSummary, type StrollLibraryLoadState } from "./strollLibrary";

type StrollHeroDeckProps = {
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

type DeckItem =
  | { kind: "create"; key: string }
  | { kind: "stroll"; key: string; stroll: PersistentStrollSummary };

const SWIPE_DISTANCE_THRESHOLD = 96;
const SWIPE_VELOCITY_THRESHOLD = 480;

function normalizeText(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function formatStrollMeta(stroll: PersistentStrollSummary) {
  const parts = [
    stroll.city,
    stroll.stopCount ? `${stroll.stopCount} stop${stroll.stopCount === 1 ? "" : "s"}` : null,
    stroll.startDate,
  ].filter(Boolean);
  return parts.join(" · ");
}

function formatStrollDateRange(stroll: PersistentStrollSummary) {
  if (stroll.startDate && stroll.endDate && stroll.endDate !== stroll.startDate) {
    return `${stroll.startDate} to ${stroll.endDate}`;
  }
  if (stroll.startDate) return stroll.startDate;
  if (stroll.endDate) return stroll.endDate;
  return null;
}

function formatWhenRange(stroll: PersistentStrollSummary) {
  const parts = [
    formatStrollDateRange(stroll),
    stroll.requestedStartTime || null,
    stroll.radiusKm ? `${stroll.radiusKm} km` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function getMinimalFailureCopy(stroll: PersistentStrollSummary, fallback: string) {
  const message = (stroll.failureMessage || "").trim();
  if (!message) return fallback;
  if (message.toLowerCase().includes("interrupted before a durable job could be recovered")) {
    return "Curation paused. Retry to continue.";
  }
  return message;
}

function getDeckTheme(stroll: PersistentStrollSummary) {
  const interestTokens = new Set(stroll.interests.map((item) => normalizeText(item)));
  const cityToken = normalizeText(stroll.city);
  const isPatna = cityToken.includes("patna");

  if (interestTokens.has("food")) {
    return {
      className: "is-food",
      kicker: "FOOD STROLL",
      accentLabel: "Taste-led route",
      ambientLabel: cityToken ? `${stroll.city} food map` : "Food map",
      artwork: tasteArt,
      cityArtwork: isPatna ? golgharPatna : null,
    };
  }
  if (interestTokens.has("heritage") || interestTokens.has("history") || interestTokens.has("art")) {
    return {
      className: "is-heritage",
      kicker: "HERITAGE STROLL",
      accentLabel: "Story-rich route",
      ambientLabel: cityToken ? `${stroll.city} history trail` : "History trail",
      artwork: exploreArt,
      cityArtwork: isPatna ? golgharPatna : null,
    };
  }
  if (interestTokens.has("nature")) {
    return {
      className: "is-nature",
      kicker: "NATURE STROLL",
      accentLabel: "Open-air route",
      ambientLabel: cityToken ? `${stroll.city} nature pockets` : "Nature route",
      artwork: activityArt,
      cityArtwork: isPatna ? golgharPatna : null,
    };
  }
  if (interestTokens.has("nightlife")) {
    return {
      className: "is-nightlife",
      kicker: "NIGHT STROLL",
      accentLabel: "After-dark route",
      ambientLabel: cityToken ? `${stroll.city} evening circuit` : "Evening circuit",
      artwork: stayArt,
      cityArtwork: isPatna ? golgharPatna : null,
    };
  }

  return {
    className: "is-city",
    kicker: "CITY STROLL",
    accentLabel: "Mixed city route",
    ambientLabel: cityToken ? `${stroll.city} city mix` : "City mix",
    artwork: exploreArt,
    cityArtwork: isPatna ? golgharPatna : null,
  };
}

function getCardOpenAction(stroll: PersistentStrollSummary, onOpenStroll: (stroll: PersistentStrollSummary) => void, onStartStroll: (stroll: PersistentStrollSummary) => void) {
  if (stroll.status === "ready") return () => onStartStroll(stroll);
  return () => onOpenStroll(stroll);
}

export function StrollHeroDeck({
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
}: StrollHeroDeckProps) {
  const prefersReducedMotion = useReducedMotion();
  const deckItems = useMemo<DeckItem[]>(
    () => [
      ...strolls.map((stroll) => ({ kind: "stroll", key: stroll.id, stroll }) as const),
      { kind: "create", key: "create" } as const,
    ],
    [strolls],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const dragX = useMotionValue(0);
  const rotate = useTransform(dragX, [-220, 0, 220], [-9, 0, 9]);
  const activeOpacity = useTransform(dragX, [-280, 0, 280], [0.68, 1, 0.68]);
  const nextScale = useTransform(dragX, [-220, 0, 220], [0.96, 0.92, 0.96]);
  const nextOpacity = useTransform(dragX, [-220, 0, 220], [0.8, 0.52, 0.8]);
  const stackLift = useTransform(dragX, [-220, 0, 220], [-4, 10, -4]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(deckItems.length - 1, 0)));
  }, [deckItems.length]);

  useLayoutEffect(() => {
    dragX.set(0);
  }, [activeIndex, dragX]);

  const canGoBack = activeIndex > 0;
  const canGoForward = activeIndex < deckItems.length - 1;
  const activeItem = deckItems[activeIndex] ?? null;
  const backgroundIndex = canGoForward ? activeIndex + 1 : canGoBack ? activeIndex - 1 : activeIndex;
  const backgroundItem = deckItems[backgroundIndex] ?? null;

  const settleToCenter = () => {
    animate(dragX, 0, {
      type: "spring",
      stiffness: 360,
      damping: 30,
      mass: 0.9,
    });
  };

  const commitSwipe = (direction: -1 | 1) => {
    if (prefersReducedMotion) {
      setActiveIndex((current) => Math.max(0, Math.min(current + direction, deckItems.length - 1)));
      dragX.set(0);
      return;
    }

    const exitTarget = direction === 1 ? -420 : 420;
    animate(dragX, exitTarget, {
      duration: 0.2,
      ease: [0.22, 0.61, 0.36, 1],
      onComplete: () => {
        setActiveIndex((current) => Math.max(0, Math.min(current + direction, deckItems.length - 1)));
      },
    });
  };

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const offsetX = info.offset.x;
    const velocityX = info.velocity.x;
    if ((offsetX <= -SWIPE_DISTANCE_THRESHOLD || velocityX <= -SWIPE_VELOCITY_THRESHOLD) && canGoForward) {
      commitSwipe(1);
      return;
    }
    if ((offsetX >= SWIPE_DISTANCE_THRESHOLD || velocityX >= SWIPE_VELOCITY_THRESHOLD) && canGoBack) {
      commitSwipe(-1);
      return;
    }
    settleToCenter();
  };

  const jumpToIndex = (nextIndex: number) => {
    setActiveIndex(Math.max(0, Math.min(nextIndex, deckItems.length - 1)));
    dragX.set(0);
  };

  if (loadState === "loading" && strolls.length === 0) {
    return (
      <section className="wr-stroll-hero-deck" aria-label="Stroll deck">
        <article className="wr-stroll-hero-card is-loading">
          <span className="wr-stroll-hero-skeleton kicker" />
          <span className="wr-stroll-hero-skeleton title" />
          <span className="wr-stroll-hero-skeleton line" />
          <span className="wr-stroll-hero-skeleton line short" />
        </article>
      </section>
    );
  }

  if (loadState === "error" && strolls.length === 0) {
    return (
      <section className="wr-stroll-hero-deck" aria-label="Stroll deck">
        <article className="wr-stroll-hero-card is-failed">
          <p className="wr-stroll-hero-kicker">STROLLS</p>
          <h3>Could not load your strolls</h3>
          <p className="wr-stroll-hero-body-copy">{error || "Try again in a moment."}</p>
          <button type="button" className="wr-stroll-hero-primary" onClick={onCreateStroll}>
            Create new stroll
          </button>
        </article>
      </section>
    );
  }

  return (
    <section className="wr-stroll-hero-deck" aria-label="Stroll deck">
      <div className="wr-stroll-hero-stage is-stack">
        {backgroundItem ? (
          <motion.div
            className="wr-stroll-hero-stack-back"
            style={{
              scale: prefersReducedMotion ? 0.94 : nextScale,
              opacity: prefersReducedMotion ? 0.64 : nextOpacity,
              y: prefersReducedMotion ? 8 : stackLift,
            }}
          >
            <DeckCard
              item={backgroundItem}
              retrying={false}
              archiving={false}
              onCreateStroll={onCreateStroll}
              onRetryStroll={onRetryStroll}
              onArchiveStroll={onArchiveStroll}
              onOpenStroll={onOpenStroll}
              onStartStroll={onStartStroll}
              isInteractive={false}
              activeIndex={activeIndex}
              totalCount={deckItems.length}
              canGoBack={canGoBack}
              canGoForward={canGoForward}
              onPrev={() => jumpToIndex(activeIndex - 1)}
              onNext={() => jumpToIndex(activeIndex + 1)}
            />
          </motion.div>
        ) : null}

        {activeItem ? (
          <motion.div
            className="wr-stroll-hero-stack-front"
            drag={prefersReducedMotion ? false : "x"}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.12}
            style={{
              x: dragX,
              rotate,
              opacity: activeOpacity,
            }}
            onDragEnd={handleDragEnd}
          >
            <DeckCard
              item={activeItem}
              retrying={activeItem.kind === "stroll" ? retryingStrollId === activeItem.stroll.id : false}
              archiving={activeItem.kind === "stroll" ? archivingStrollId === activeItem.stroll.id : false}
              onCreateStroll={onCreateStroll}
              onRetryStroll={onRetryStroll}
              onArchiveStroll={onArchiveStroll}
              onOpenStroll={onOpenStroll}
              onStartStroll={onStartStroll}
              isInteractive
              activeIndex={activeIndex}
              totalCount={deckItems.length}
              canGoBack={canGoBack}
              canGoForward={canGoForward}
              onPrev={() => jumpToIndex(activeIndex - 1)}
              onNext={() => jumpToIndex(activeIndex + 1)}
            />
          </motion.div>
        ) : null}
      </div>

      {deckItems.length > 1 ? (
        <div className="wr-stroll-hero-dots" aria-hidden="true">
          {deckItems.map((item, index) => (
            <button
              key={item.key}
              type="button"
              className={`wr-stroll-hero-dot ${index === activeIndex ? "is-active" : ""}`}
              onClick={() => jumpToIndex(index)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function DeckCard({
  item,
  retrying,
  archiving,
  onCreateStroll,
  onRetryStroll,
  onArchiveStroll,
  onOpenStroll,
  onStartStroll,
  isInteractive,
  activeIndex,
  totalCount,
  canGoBack,
  canGoForward,
  onPrev,
  onNext,
}: {
  item: DeckItem;
  retrying: boolean;
  archiving: boolean;
  onCreateStroll: () => void;
  onRetryStroll: (strollId: string) => void;
  onArchiveStroll: (strollId: string) => void;
  onOpenStroll: (stroll: PersistentStrollSummary) => void;
  onStartStroll: (stroll: PersistentStrollSummary) => void;
  isInteractive: boolean;
  activeIndex: number;
  totalCount: number;
  canGoBack: boolean;
  canGoForward: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (item.kind === "create") {
    return (
      <article
        className={`wr-stroll-hero-card is-create ${isInteractive ? "is-interactive" : ""}`}
        onClick={isInteractive ? onCreateStroll : undefined}
        onKeyDown={isInteractive ? (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onCreateStroll();
          }
        } : undefined}
        role={isInteractive ? "button" : undefined}
        tabIndex={isInteractive ? 0 : undefined}
      >
        <div className="wr-stroll-hero-overlay" />
        <div className="wr-stroll-hero-topline">
          <div className="wr-stroll-hero-kicker-wrap">
            <p className="wr-stroll-hero-kicker">YOUR STROLL</p>
            <span className="wr-stroll-hero-footprints" aria-hidden="true">
              <span className="wr-stroll-hero-footprint left">
                <span className="wr-stroll-hero-footprint-sole" />
                <span className="wr-stroll-hero-footprint-toes">
                  <span />
                  <span />
                  <span />
                </span>
              </span>
              <span className="wr-stroll-hero-footprint right">
                <span className="wr-stroll-hero-footprint-sole" />
                <span className="wr-stroll-hero-footprint-toes">
                  <span />
                  <span />
                  <span />
                </span>
              </span>
            </span>
          </div>
          {isInteractive ? (
            <div className="wr-stroll-hero-inline-nav">
              <button type="button" className="wr-stroll-hero-inline-nav-btn" aria-label="Previous stroll" disabled={!canGoBack} onClick={(event) => { event.stopPropagation(); onPrev(); }}>
                <ChevronLeft size={14} />
              </button>
              <span>{activeIndex + 1}/{totalCount}</span>
              <button type="button" className="wr-stroll-hero-inline-nav-btn" aria-label="Next stroll" disabled={!canGoForward} onClick={(event) => { event.stopPropagation(); onNext(); }}>
                <ChevronRight size={14} />
              </button>
            </div>
          ) : null}
        </div>
        <div className="wr-stroll-hero-create-shell" aria-hidden={!isInteractive}>
          <div className="wr-stroll-hero-create-plus">
            <Plus size={26} />
          </div>
          <div className="wr-stroll-hero-create-copy">
            <h3>Create new stroll</h3>
          </div>
        </div>
      </article>
    );
  }

  const stroll = item.stroll;
  const effectiveStatus = retrying ? "queued" : stroll.status;
  const presentation = getStrollStatusPresentation(effectiveStatus);
  const theme = getDeckTheme(stroll);
  const isDraft = effectiveStatus === "draft";
  const isWorking = effectiveStatus === "queued" || effectiveStatus === "curating";
  const isFailed = effectiveStatus === "failed";
  const canEditInputs = effectiveStatus === "failed";
  const openAction = getCardOpenAction(stroll, onOpenStroll, onStartStroll);
  const backgroundLayers = isFailed
    ? [
      "linear-gradient(145deg, rgba(255, 255, 255, 0.06) 0%, rgba(8, 18, 38, 0.12) 100%)",
      "radial-gradient(circle at top right, rgba(255, 255, 255, 0.16), transparent 32%)",
      "linear-gradient(135deg, #a83d26 0%, #b55b2f 54%, #a46e2d 100%)",
    ].join(", ")
    : [
      "linear-gradient(145deg, rgba(8, 18, 38, 0.08) 0%, rgba(8, 18, 38, 0.26) 100%)",
      "radial-gradient(circle at top right, rgba(255, 255, 255, 0.3), transparent 34%)",
      theme.cityArtwork ? `linear-gradient(90deg, rgba(8, 18, 38, 0.08), rgba(8, 18, 38, 0.34)), url(${theme.cityArtwork})` : null,
      `linear-gradient(120deg, rgba(8, 18, 38, 0.16), rgba(8, 18, 38, 0.1)), url(${theme.artwork})`,
    ].filter(Boolean).join(", ");
  const bodyCopy = isFailed
    ? getMinimalFailureCopy(stroll, presentation.description)
    : stroll.failureMessage || stroll.description || presentation.description;
  const locationMeta = "Place";
  const whenRangeValue = formatWhenRange(stroll) || formatStrollMeta(stroll) || "Flexible";
  const whenRangeMeta = "When / Range";

  return (
    <article
      className={`wr-stroll-hero-card ${theme.className} is-${presentation.tone} ${isFailed ? "is-minimal-failed" : ""} ${isInteractive ? "is-interactive" : ""}`}
      onClick={isInteractive ? openAction : undefined}
      onKeyDown={isInteractive ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openAction();
        }
      } : undefined}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      style={{ backgroundImage: backgroundLayers }}
    >
      <div className="wr-stroll-hero-overlay" />
        <div className="wr-stroll-hero-topline">
          <div className="wr-stroll-hero-kicker-stack">
            <p className="wr-stroll-hero-kicker">{theme.kicker}</p>
            <span className={`wr-stroll-hero-status is-${presentation.tone}`}>{presentation.label}</span>
          </div>
          {isInteractive ? (
            <div className="wr-stroll-hero-right-rail">
              <div className="wr-stroll-hero-inline-nav">
                <button type="button" className="wr-stroll-hero-inline-nav-btn" aria-label="Previous stroll" disabled={!canGoBack} onClick={(event) => { event.stopPropagation(); onPrev(); }}>
                  <ChevronLeft size={14} />
                </button>
                <span>{activeIndex + 1}/{totalCount}</span>
                <button type="button" className="wr-stroll-hero-inline-nav-btn" aria-label="Next stroll" disabled={!canGoForward} onClick={(event) => { event.stopPropagation(); onNext(); }}>
                  <ChevronRight size={14} />
                </button>
              </div>
              <div className="wr-stroll-hero-icon-actions">
                {stroll.status === "failed" ? (
                  <button
                    type="button"
                    className="wr-stroll-hero-icon-btn"
                    aria-label={`Retry ${stroll.name}`}
                    disabled={retrying}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRetryStroll(stroll.id);
                    }}
                  >
                    <RotateCcw size={15} />
                  </button>
                ) : null}
                {canEditInputs ? (
                  <button
                    type="button"
                    className="wr-stroll-hero-icon-btn"
                    aria-label={`Edit ${stroll.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenStroll(stroll);
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="wr-stroll-hero-icon-btn is-danger"
                  aria-label={`Delete ${stroll.name}`}
                  disabled={archiving}
                  onClick={(event) => {
                    event.stopPropagation();
                    onArchiveStroll(stroll.id);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      <h3>{stroll.name}</h3>
      <p className="wr-stroll-hero-body-copy">{bodyCopy}</p>
      {isWorking ? (
        <div className="wr-stroll-hero-progress" role="status" aria-label={`${stroll.name} is ${presentation.label.toLowerCase()}`}>
          <div className="wr-stroll-hero-progress-bar" aria-hidden="true">
            <span className="wr-stroll-hero-progress-fill" />
          </div>
          <small>{effectiveStatus === "queued" ? "Starting curation..." : "Curating your stroll..."}</small>
        </div>
      ) : null}
      <div className="wr-stroll-hero-metric-row">
        <div className="wr-stroll-hero-metric">
          <MapPinned size={16} />
          <strong>{stroll.city}</strong>
          <small>{locationMeta}</small>
        </div>
        <div className="wr-stroll-hero-metric">
          <Clock3 size={16} />
          <strong>{whenRangeValue}</strong>
          <small>{whenRangeMeta}</small>
        </div>
      </div>
      {isInteractive ? (
        <div className="wr-stroll-hero-actions">
          {isDraft ? (
            <button type="button" className="wr-stroll-hero-primary" onClick={(event) => {
              event.stopPropagation();
              onOpenStroll(stroll);
            }}>
              Continue editing
            </button>
          ) : null}
          {stroll.status === "ready" ? (
            <button type="button" className="wr-stroll-hero-primary" onClick={(event) => {
              event.stopPropagation();
              onStartStroll(stroll);
            }}>
              Open stroll
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
