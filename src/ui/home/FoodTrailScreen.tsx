import { ArrowLeft, Clock3, MapPinned, RefreshCcw, UtensilsCrossed } from "lucide-react";
import { useMemo, useState } from "react";
import type { SavedPlaceRecord } from "./savedPlaces";
import {
  buildFoodTrailPlan,
  resolveDefaultFoodTrailTiming,
  type FoodTrailTiming,
} from "./foodTrailPlanner";

const TIMING_OPTIONS: Array<{ value: FoodTrailTiming; label: string }> = [
  { value: "now_today", label: "Now / Today" },
  { value: "today_evening", label: "Today evening" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "weekend", label: "This weekend" },
];

function getNextTiming(current: FoodTrailTiming): FoodTrailTiming {
  const currentIndex = TIMING_OPTIONS.findIndex((option) => option.value === current);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % TIMING_OPTIONS.length : 0;
  return TIMING_OPTIONS[nextIndex].value;
}

export function FoodTrailScreen({
  savedPlaces,
  onBack,
}: {
  savedPlaces: SavedPlaceRecord[];
  onBack: () => void;
}) {
  const [selectedTiming, setSelectedTiming] = useState<FoodTrailTiming>(() => resolveDefaultFoodTrailTiming(new Date()));
  const [rebuildSeed, setRebuildSeed] = useState(0);
  const plan = useMemo(
    () => buildFoodTrailPlan(savedPlaces, selectedTiming, { now: new Date(), rebuildSeed }),
    [rebuildSeed, savedPlaces, selectedTiming],
  );
  const hasEnoughPlaces = savedPlaces.length >= 2 && plan.stops.length >= 2;

  return (
    <section className="wr-food-trail-page">
      <header className="wr-food-trail-header">
        <button type="button" className="wr-food-trail-back" aria-label="Back" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <div className="wr-food-trail-title-block">
          <p>FOOD TRAIL</p>
          <h2>Build from your saved places</h2>
        </div>
      </header>

      <div className="wr-food-trail-hero">
        <div className="wr-food-trail-hero-copy">
          <span className="wr-food-trail-hero-kicker">Taste planner</span>
          <h3>{hasEnoughPlaces ? plan.trailStyleLabel : "Food trail planning"}</h3>
          <p>
            {hasEnoughPlaces
              ? `${plan.summaryLabel}. Start around ${plan.suggestedStartTimeLabel}.`
              : "Save a few food places first, then Wandreel can build a trail for you."}
          </p>
        </div>
        <div className="wr-food-trail-hero-mark" aria-hidden="true">
          <UtensilsCrossed size={26} />
        </div>
      </div>

      <div className="wr-food-trail-timing-row" role="group" aria-label="Food trail time">
        {TIMING_OPTIONS.map((option) => (
          <button
            type="button"
            key={option.value}
            className={`wr-food-trail-timing-chip ${selectedTiming === option.value ? "is-active" : ""}`}
            onClick={() => setSelectedTiming(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {hasEnoughPlaces ? (
        <>
          <section className="wr-food-trail-summary">
            <article className="wr-food-trail-summary-card">
              <span><Clock3 size={14} /> {plan.dateLabel}</span>
              <strong>{plan.suggestedStartTimeLabel}</strong>
              <small>Suggested start</small>
            </article>
            <article className="wr-food-trail-summary-card">
              <span><MapPinned size={14} /> Route style</span>
              <strong>{plan.trailStyleLabel}</strong>
              <small>{plan.totalDurationLabel}</small>
            </article>
          </section>

          <section className="wr-food-trail-route">
            <div className="wr-food-trail-section-head">
              <div>
                <p>ROUTE</p>
                <h3>Your saved stops</h3>
              </div>
              <span className="wr-food-trail-duration">{plan.totalDurationLabel}</span>
            </div>

            <div className="wr-food-trail-stop-list">
              {plan.stops.map((stop, index) => (
                <article className="wr-food-trail-stop-card" key={`${stop.placeId}-${index}`}>
                  <div className="wr-food-trail-stop-index">{index + 1}</div>
                  <div className="wr-food-trail-stop-body">
                    <div className="wr-food-trail-stop-topline">
                      <h4>{stop.title}</h4>
                      <span>{stop.role}</span>
                    </div>
                    <p>{stop.locality}</p>
                    <small>{stop.travelGapLabel ? `${stop.travelGapLabel} from previous stop` : "Start here"}</small>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <div className="wr-food-trail-controls">
            <button
              type="button"
              className="wr-food-trail-control-primary"
              onClick={() => setRebuildSeed((current) => current + 1)}
            >
              <RefreshCcw size={15} />
              Rebuild route
            </button>
            <button
              type="button"
              className="wr-food-trail-control-secondary"
              onClick={() => setSelectedTiming((current) => getNextTiming(current))}
            >
              Change time
            </button>
          </div>
        </>
      ) : (
        <section className="wr-food-trail-empty-state">
          <h3>Not enough saved food places yet</h3>
          <p>Save a few food places first, then Wandreel can build a trail for you.</p>
        </section>
      )}
    </section>
  );
}
