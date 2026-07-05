import { ArrowLeft, Clock3, MapPinned, RefreshCcw, Route } from "lucide-react";
import { useMemo, useState } from "react";
import type { SavedPlaceRecord } from "./savedPlaces";
import {
  buildWeekendPlan,
  resolveDefaultWeekendPlannerTiming,
  type WeekendPlannerTiming,
} from "./weekendPlanner";

const TIMING_OPTIONS: Array<{ value: WeekendPlannerTiming; label: string }> = [
  { value: "this_saturday", label: "This Saturday" },
  { value: "this_sunday", label: "This Sunday" },
  { value: "next_weekend", label: "Next weekend" },
  { value: "pick_later", label: "Pick later" },
];

function getNextTiming(current: WeekendPlannerTiming): WeekendPlannerTiming {
  const currentIndex = TIMING_OPTIONS.findIndex((option) => option.value === current);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % TIMING_OPTIONS.length : 0;
  return TIMING_OPTIONS[nextIndex].value;
}

export function WeekendPlannerScreen({
  savedPlaces,
  cityName,
  onBack,
  onAddPlaces,
  isDemoPreview = false,
}: {
  savedPlaces: SavedPlaceRecord[];
  cityName: string;
  onBack: () => void;
  onAddPlaces?: () => void;
  isDemoPreview?: boolean;
}) {
  const [selectedTiming, setSelectedTiming] = useState<WeekendPlannerTiming>(() => resolveDefaultWeekendPlannerTiming(new Date()));
  const [rebuildSeed, setRebuildSeed] = useState(0);
  const plan = useMemo(
    () => buildWeekendPlan(savedPlaces, selectedTiming, { now: new Date(), rebuildSeed }),
    [rebuildSeed, savedPlaces, selectedTiming],
  );
  const hasEnoughPlaces = savedPlaces.length >= 3 && plan.stops.length >= 3;
  const headerCity = cityName.trim() || "your city";

  return (
    <section className="wr-weekend-plan-page">
      <header className="wr-weekend-plan-header">
        <button type="button" className="wr-weekend-plan-back" aria-label="Back" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <div className="wr-weekend-plan-title-block">
          <p>WEEKEND PLAN</p>
          <h2>Plan your {headerCity} weekend</h2>
          {isDemoPreview ? <small>Demo preview</small> : null}
        </div>
      </header>

      <div className="wr-weekend-plan-hero">
        <div className="wr-weekend-plan-hero-copy">
          <span className="wr-weekend-plan-hero-kicker">Mixed planner</span>
          <h3>{hasEnoughPlaces ? plan.planStyleLabel : `${headerCity} weekend planning`}</h3>
          <p>
            {hasEnoughPlaces
              ? `${plan.summaryLabel}. Start ${plan.suggestedStartTimeLabel}.`
              : "Save a few more food, explore, or activity spots to build a city plan."}
          </p>
          {hasEnoughPlaces ? (
            <div className="wr-weekend-plan-start-pill">
              <Clock3 size={14} />
              <span>{plan.suggestedStartTimeLabel}</span>
            </div>
          ) : null}
        </div>
        <div className="wr-weekend-plan-hero-mark" aria-hidden="true">
          <Route size={26} />
        </div>
      </div>

      <div className="wr-weekend-plan-timing-row" role="group" aria-label="Weekend plan day">
        {TIMING_OPTIONS.map((option) => (
          <button
            type="button"
            key={option.value}
            className={`wr-weekend-plan-timing-chip ${selectedTiming === option.value ? "is-active" : ""}`}
            onClick={() => setSelectedTiming(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {hasEnoughPlaces ? (
        <>
          <section className="wr-weekend-plan-summary">
            <article className="wr-weekend-plan-summary-card">
              <span><Clock3 size={14} /> {plan.dateLabel}</span>
              <strong>{plan.suggestedStartTimeLabel}</strong>
              <small>Suggested start</small>
            </article>
            <article className="wr-weekend-plan-summary-card">
              <span><MapPinned size={14} /> Route style</span>
              <strong>{plan.planStyleLabel}</strong>
              <small>{headerCity}</small>
            </article>
          </section>

          <section className="wr-weekend-plan-route">
            <div className="wr-weekend-plan-section-head">
              <div>
                <p>ROUTE</p>
                <h3>Your weekend stops</h3>
              </div>
              <span className="wr-weekend-plan-duration">{plan.timingLabel}</span>
            </div>
            <p className="wr-weekend-plan-why-route">
              <span>Why this plan</span>
              {plan.whyPlanLabel}
            </p>

            <div className="wr-weekend-plan-stop-list">
              {plan.stops.map((stop, index) => (
                <article className="wr-weekend-plan-stop-card" key={`${stop.placeId}-${index}`}>
                  <div className="wr-weekend-plan-stop-rail" aria-hidden="true">
                    <div className="wr-weekend-plan-stop-index">{index + 1}</div>
                    {index < plan.stops.length - 1 ? <div className="wr-weekend-plan-stop-connector" /> : null}
                  </div>
                  <div className="wr-weekend-plan-stop-body">
                    <div className="wr-weekend-plan-stop-topline">
                      <h4>{stop.title}</h4>
                      <span>{stop.role}</span>
                    </div>
                    <p>{stop.locality}</p>
                    <small>{stop.category}{stop.travelGapLabel ? ` · ${stop.travelGapLabel} from previous stop` : " · Start here"}</small>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <div className="wr-weekend-plan-controls">
            <button
              type="button"
              className="wr-weekend-plan-control-primary"
              onClick={() => setRebuildSeed((current) => current + 1)}
            >
              <RefreshCcw size={15} />
              Rebuild plan
            </button>
            <button
              type="button"
              className="wr-weekend-plan-control-secondary"
              onClick={() => setSelectedTiming((current) => getNextTiming(current))}
            >
              Change day
            </button>
          </div>
        </>
      ) : (
        <section className="wr-weekend-plan-empty-state">
          <h3>{headerCity} plan is not ready yet</h3>
          <p>Save at least 3 places across food, explore, or activity to build a mixed weekend route.</p>
          <div className="wr-weekend-plan-empty-actions">
            {onAddPlaces ? (
              <button type="button" className="wr-weekend-plan-control-primary" onClick={onAddPlaces}>
                Add places
              </button>
            ) : null}
            <button type="button" className="wr-weekend-plan-control-secondary" onClick={onBack}>
              Back to Discover
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
