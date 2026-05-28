import { useMemo, useState } from "react";
import { LocateFixed, MapPin, Navigation, Search } from "lucide-react";
import { mapCategories, runMapDataChecks, type MapCategoryLabel, type MapCategoryPin } from "./map.data";
import "./map.css";

runMapDataChecks();

function MapPinMarker({ pin }: { pin: MapCategoryPin }) {
  const Icon = pin.icon;

  return (
    <div className="wr-map-pin" style={{ left: pin.x, top: pin.y }}>
      <div className="wr-map-pin-core" style={{ backgroundColor: pin.color }}>
        <Icon size={13} strokeWidth={2.2} />
      </div>
      <div className="wr-map-pin-tail" style={{ borderTopColor: pin.color }} />
      <div className="wr-map-pin-tooltip">{pin.label}</div>
    </div>
  );
}

export function MapScreen() {
  const [activeMapCategories, setActiveMapCategories] = useState<MapCategoryLabel[]>([
    "Taste",
    "Activity",
    "Stay",
    "Explore",
  ]);
  const [radiusKm, setRadiusKm] = useState(12);

  const toggleMapCategory = (label: MapCategoryLabel) => {
    setActiveMapCategories((current) =>
      current.includes(label) ? current.filter((item) => item !== label) : [...current, label],
    );
  };

  const visiblePins = useMemo(
    () => mapCategories.filter((pin) => activeMapCategories.includes(pin.label)),
    [activeMapCategories],
  );
  const sliderPercent = ((radiusKm - 2) / 98) * 100;

  return (
    <section className="wr-map" aria-label="Map tab">
      <div className="wr-map-topbar">
        <div className="wr-map-search">
          <MapPin size={15} className="wr-map-search-pin" />
          <div className="wr-map-search-texts">
            <span className="wr-map-search-main">Patna, Bihar</span>
            <span className="wr-map-search-sub">55 saved places nearby</span>
          </div>
          <button type="button" className="wr-map-search-change">Change</button>
          <Search size={14} className="wr-map-search-icon" />
        </div>

        <div className="wr-map-chips" role="group" aria-label="Map categories">
          {mapCategories.map((category) => {
            const Icon = category.icon;
            const isActive = activeMapCategories.includes(category.label);

            return (
              <button
                type="button"
                key={category.label}
                aria-pressed={isActive}
                aria-label={`${isActive ? "Hide" : "Show"} ${category.label} places`}
                onClick={() => toggleMapCategory(category.label)}
                className={`wr-map-chip ${isActive ? "is-active" : "is-disabled"}`}
              >
                <span className="wr-map-chip-icon" style={isActive ? { backgroundColor: category.color } : undefined}>
                  <Icon size={13} strokeWidth={2.2} />
                </span>
                <span>{category.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="wr-map-canvas" aria-label="Map canvas">
        <div className="wr-map-base" />
        <div className="wr-map-road wr-map-road-a" />
        <div className="wr-map-road wr-map-road-b" />
        <div className="wr-map-road wr-map-road-c" />
        <div className="wr-map-road wr-map-road-d" />

        <span className="wr-map-locality wr-map-locality-a">Rupaspur</span>
        <span className="wr-map-locality wr-map-locality-b">Jagdeo Path</span>
        <span className="wr-map-locality wr-map-locality-c">Boring Road</span>
        <span className="wr-map-locality wr-map-locality-d">Jalalpur</span>
        <span className="wr-map-locality wr-map-locality-e">Patna</span>

        {visiblePins.map((pin) => (
          <MapPinMarker key={pin.label} pin={pin} />
        ))}

        <div className="wr-map-current-location">
          <LocateFixed size={11} />
        </div>

        <button type="button" className="wr-map-recenter-btn" aria-label="Recenter map">
          <Navigation size={16} />
        </button>
        <div className="wr-map-radius-vertical" aria-label="Map search radius control">
          <p className="wr-map-radius-value">{radiusKm} km</p>
          <div className="wr-map-radius-vertical-body">
            <span className="wr-map-radius-limit">100</span>
            <input
              type="range"
              min={2}
              max={100}
              step={1}
              value={radiusKm}
              onChange={(event) => setRadiusKm(Number(event.target.value))}
              className="wr-map-radius-slider-vertical"
              aria-label="Map search radius in kilometers"
              style={{ "--wr-map-slider": `${sliderPercent}%` } as { [key: string]: string }}
            />
            <span className="wr-map-radius-limit">2</span>
          </div>
        </div>
      </div>
    </section>
  );
}
