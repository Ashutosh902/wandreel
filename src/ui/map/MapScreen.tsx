import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, LocateFixed, MapPin, Search, X } from "lucide-react";
import { mapCategories, runMapDataChecks, type MapCategoryLabel, type MapCategoryPin } from "./map.data";
import { useUx } from "../layout/UxProvider";
import "./map.css";

runMapDataChecks();

const MAP_CENTER = { x: 51, y: 56 };
const MAX_RADIUS_VISUAL_RATIO = 0.44;

function pinDistanceFromCenter(pin: MapCategoryPin): number {
  const px = Number(pin.x.replace("%", ""));
  const py = Number(pin.y.replace("%", ""));
  const dx = px - MAP_CENTER.x;
  const dy = py - MAP_CENTER.y;
  return Math.hypot(dx, dy);
}

function MapPinMarker({
  pin,
  inRange,
  selected,
  onSelect,
}: {
  pin: MapCategoryPin;
  inRange: boolean;
  selected: boolean;
  onSelect: (pin: MapCategoryPin) => void;
}) {
  const Icon = pin.icon;

  return (
    <button
      type="button"
      className={`wr-map-pin ${inRange ? "" : "is-out-of-range"} ${selected ? "is-selected" : ""}`}
      style={{ left: pin.x, top: pin.y }}
      onClick={() => onSelect(pin)}
      aria-label={`Open ${pin.label} place details`}
    >
      <div className="wr-map-pin-core" style={{ backgroundColor: pin.color }}>
        <Icon size={13} strokeWidth={2.2} />
      </div>
      <div className="wr-map-pin-tail" style={{ borderTopColor: pin.color }} />
      <div className="wr-map-pin-tooltip">{pin.label}</div>
    </button>
  );
}

export function MapScreen({
  focusedCategory = null,
  onBack,
  onAddLink,
}: {
  focusedCategory?: MapCategoryLabel | null;
  onBack?: () => void;
  onAddLink?: () => void;
}) {
  const {
    currentLocationLabel,
    isLocating,
    requestCurrentLocation,
    searchLocations,
    setLocationFromPlaceId,
    useDeviceLocationAsCurrent,
    deviceLocationLabel,
    showToast,
  } = useUx();
  const [activeMapCategories, setActiveMapCategories] = useState<MapCategoryLabel[]>([
    "Taste",
    "Activity",
    "Stay",
    "Explore",
  ]);
  const [radiusKm, setRadiusKm] = useState(12);
  const [mapMinDimensionPx, setMapMinDimensionPx] = useState(320);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [activePinPreview, setActivePinPreview] = useState<MapCategoryPin | null>(null);
  const sheetTouchStartYRef = useRef<number | null>(null);
  const [isCountBump, setIsCountBump] = useState(false);
  const [isLocationMenuOpen, setIsLocationMenuOpen] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<Array<{ placeId: string; label: string; secondaryText: string | null; description: string | null }>>([]);
  const [isLocationSearching, setIsLocationSearching] = useState(false);
  const [isLocationSearchUnavailable, setIsLocationSearchUnavailable] = useState(false);

  useEffect(() => {
    if (focusedCategory) {
      setActiveMapCategories([focusedCategory]);
      return;
    }
    setActiveMapCategories(["Taste", "Activity", "Stay", "Explore"]);
  }, [focusedCategory]);

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      const minDim = Math.max(1, Math.min(rect.width, rect.height));
      setMapMinDimensionPx(minDim);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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
  const isCategoryLockActive = focusedCategory !== null;
  const radiusProgress = (radiusKm - 2) / 98;
  const radiusVisualPx = radiusProgress * mapMinDimensionPx * MAX_RADIUS_VISUAL_RATIO;
  const radiusVisualPercentForLogic = radiusProgress * 44;

  const pinsWithRangeState = useMemo(
    () =>
      visiblePins.map((pin) => ({
        pin,
        inRange: pinDistanceFromCenter(pin) <= radiusVisualPercentForLogic,
      })),
    [visiblePins, radiusVisualPercentForLogic],
  );
  const inRangeCount = pinsWithRangeState.filter((item) => item.inRange).length;
  const inRangeNoun = inRangeCount === 1 ? "place" : "places";
  const closePinPreview = () => setActivePinPreview(null);

  useEffect(() => {
    setIsCountBump(true);
    const timer = window.setTimeout(() => setIsCountBump(false), 180);
    return () => window.clearTimeout(timer);
  }, [inRangeCount]);

  useEffect(() => {
    if (!isLocationMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const node = document.querySelector(".wr-map-topbar");
      if (!node) return;
      if (!node.contains(event.target as Node)) {
        setIsLocationMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [isLocationMenuOpen]);

  useEffect(() => {
    if (!isLocationMenuOpen) return;
    const timer = window.setTimeout(async () => {
      if (locationQuery.trim().length < 2) {
        setLocationSuggestions([]);
        return;
      }
      setIsLocationSearching(true);
      setIsLocationSearchUnavailable(false);
      try {
        const next = await searchLocations(locationQuery);
        setLocationSuggestions(next);
      } catch {
        setLocationSuggestions([]);
        setIsLocationSearchUnavailable(true);
      } finally {
        setIsLocationSearching(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [isLocationMenuOpen, locationQuery, searchLocations]);

  return (
    <section className="wr-map" aria-label="Map tab">
      <div className="wr-map-topbar">
        <div className="wr-map-top-row">
          <button
            type="button"
            className="wr-map-back-btn"
            aria-label="Back"
            onClick={() => onBack?.()}
          >
            <ArrowLeft size={18} />
          </button>
          <div className="wr-map-search">
          <MapPin size={15} className="wr-map-search-pin" />
          <div className="wr-map-search-texts">
            <span className="wr-map-search-main">{currentLocationLabel}</span>
          </div>
          <button type="button" className="wr-map-search-change" onClick={() => setIsLocationMenuOpen((open) => !open)}>
            {isLocating ? "Locating..." : "Change"}
          </button>
          <Search size={14} className="wr-map-search-icon" />
          </div>
          {isLocationMenuOpen ? (
            <div className="wr-map-location-menu" role="dialog" aria-label="Change map location">
              <input
                type="text"
                className="wr-map-location-input"
                placeholder="Search city or locality..."
                value={locationQuery}
                onChange={(event) => setLocationQuery(event.target.value)}
                autoFocus
              />
              <button
                type="button"
                className="wr-map-location-option is-current"
                onClick={() => {
                  void useDeviceLocationAsCurrent();
                  setIsLocationMenuOpen(false);
                }}
              >
                <span>Current location</span>
                <small>{deviceLocationLabel || "Use device GPS"}</small>
              </button>
              {!isLocationSearching && isLocationSearchUnavailable ? (
                <p className="wr-map-location-helper">Location suggestions unavailable right now.</p>
              ) : null}
              {isLocationSearching ? <p className="wr-map-location-helper">Searching...</p> : null}
              {!isLocationSearching && locationQuery.trim().length >= 2 && locationSuggestions.length === 0 ? (
                <p className="wr-map-location-helper">
                  {isLocationSearchUnavailable ? "Try again in a moment." : "No matching places found."}
                </p>
              ) : null}
              {locationSuggestions.map((item) => (
                <button
                  key={item.placeId}
                  type="button"
                  className="wr-map-location-option"
                  onClick={async () => {
                    const ok = await setLocationFromPlaceId(item.placeId);
                    if (!ok) {
                      showToast({ message: "Couldn’t set that location. Please try again.", variant: "error" });
                      return;
                    }
                    setIsLocationMenuOpen(false);
                    setLocationQuery("");
                    setLocationSuggestions([]);
                  }}
                >
                  <span>{item.label}</span>
                  <small>{item.secondaryText || item.description || ""}</small>
                </button>
              ))}
            </div>
          ) : null}
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
                onClick={() => {
                  if (isCategoryLockActive) return;
                  toggleMapCategory(category.label);
                }}
                disabled={isCategoryLockActive && !isActive}
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

      <div className="wr-map-canvas" aria-label="Map canvas" ref={canvasRef}>
        <div
          className="wr-map-radius-overlay"
          aria-hidden="true"
          style={{
            width: `${radiusVisualPx * 2}px`,
            height: `${radiusVisualPx * 2}px`,
            left: `${MAP_CENTER.x}%`,
            top: `${MAP_CENTER.y}%`,
          }}
        />
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

        {pinsWithRangeState.map(({ pin, inRange }) => (
          <MapPinMarker key={pin.label} pin={pin} inRange={inRange} selected={activePinPreview?.label === pin.label} onSelect={setActivePinPreview} />
        ))}

        <button type="button" className="wr-map-current-location" onClick={() => void requestCurrentLocation()} aria-label="Locate me">
          <LocateFixed size={11} />
        </button>

        <div className={`wr-map-in-range-pill ${isCountBump ? "is-bump" : ""}`} aria-live="polite">
          <span className="wr-map-in-range-count">{inRangeCount}</span>
          <span className="wr-map-in-range-label">{inRangeNoun}</span>
        </div>
        {inRangeCount === 0 ? (
          <div className="wr-map-empty-state" aria-live="polite">
            <p className="wr-map-empty-title">No places in this radius</p>
            <p className="wr-map-empty-copy">Increase distance or add your first Wandreel.</p>
            <div className="wr-map-empty-actions">
              <button type="button" className="wr-map-empty-btn" onClick={() => setRadiusKm((km) => Math.min(100, km + 8))}>
                Increase radius
              </button>
              <button type="button" className="wr-map-empty-btn is-primary" onClick={() => onAddLink?.()}>
                Add a link
              </button>
            </div>
          </div>
        ) : null}
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
      {activePinPreview ? (
        <div className="wr-map-sheet-layer" onClick={closePinPreview} role="presentation">
          <article
            className="wr-map-sheet"
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => {
              sheetTouchStartYRef.current = event.touches[0].clientY;
            }}
            onTouchEnd={(event) => {
              if (sheetTouchStartYRef.current === null) return;
              const deltaY = event.changedTouches[0].clientY - sheetTouchStartYRef.current;
              sheetTouchStartYRef.current = null;
              if (deltaY > 72) closePinPreview();
            }}
            aria-label={`${activePinPreview.previewTitle} details`}
          >
            <button type="button" className="wr-map-sheet-close" aria-label="Close map place details" onClick={closePinPreview}>
              <X size={16} />
            </button>
            <img src={activePinPreview.imageUrl} alt={activePinPreview.previewTitle} className="wr-map-sheet-image" />
            <h3 className="wr-map-sheet-title">{activePinPreview.previewTitle}</h3>
            <p className="wr-map-sheet-meta">{activePinPreview.previewSubtitle}</p>
            <p className="wr-map-sheet-address">{activePinPreview.address}</p>
            <p className="wr-map-sheet-timing">{activePinPreview.timing}</p>
            <div className="wr-map-sheet-actions">
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activePinPreview.address)}`}
                target="_blank"
                rel="noreferrer"
                className="wr-map-sheet-action-btn"
              >
                Directions
              </a>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}


