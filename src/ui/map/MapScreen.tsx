import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, LocateFixed, MapPin, Search, X } from "lucide-react";
import { CircleF, GoogleMap, MarkerF, useJsApiLoader } from "@react-google-maps/api";
import { mapCategoryStyles, runMapDataChecks, type MapCategoryLabel } from "./map.data";
import { useUx } from "../layout/UxProvider";
import type { SavedPlaceRecord } from "../home/savedPlaces";
import "./map.css";

runMapDataChecks();

const MAP_CENTER = { x: 51, y: 56 };
const MAX_RADIUS_VISUAL_RATIO = 0.44;
const FALLBACK_MAP_CENTER = { lat: 25.5941, lng: 85.1376 };
const GOOGLE_MAP_LIBRARIES: ("places")[] = ["places"];
const LIGHT_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "administrative", elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#e0f2fe" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#f8fafc" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#e2e8f0" }] },
];

type MapPlacePin = SavedPlaceRecord & {
  x: string;
  y: string;
  color: string;
};

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "").trim();
  if (normalized.length !== 6) return `rgba(16, 33, 63, ${alpha})`;
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceBetweenKm(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
): number {
  const earthRadiusKm = 6371;
  const latDelta = toRadians(end.lat - start.lat);
  const lngDelta = toRadians(end.lng - start.lng);
  const startLat = toRadians(start.lat);
  const endLat = toRadians(end.lat);
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(lngDelta / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function getGoogleZoomForRadius(radiusKm: number): number {
  if (radiusKm <= 3) return 14.8;
  if (radiusKm <= 6) return 13.9;
  if (radiusKm <= 10) return 13.2;
  if (radiusKm <= 16) return 12.7;
  if (radiusKm <= 25) return 11.9;
  if (radiusKm <= 40) return 11.2;
  if (radiusKm <= 60) return 10.6;
  if (radiusKm <= 80) return 10.1;
  return 9.6;
}

function MapPinMarker({
  pin,
  selected,
  onSelect,
}: {
  pin: MapPlacePin;
  selected: boolean;
  onSelect: (pin: MapPlacePin) => void;
}) {
  const categoryStyle = mapCategoryStyles.find((item) => item.label === pin.category);
  if (!categoryStyle) return null;
  const Icon = categoryStyle.icon;

  return (
    <button
      type="button"
      className={`wr-map-pin ${selected ? "is-selected" : ""}`}
      style={{ left: pin.x, top: pin.y }}
      onClick={() => onSelect(pin)}
      aria-label={`Open ${pin.title} details`}
    >
      <div className="wr-map-pin-core" style={{ backgroundColor: pin.color }}>
        <Icon size={13} strokeWidth={2.2} />
      </div>
      <div className="wr-map-pin-tail" style={{ borderTopColor: pin.color }} />
      <div className="wr-map-pin-tooltip">{pin.title}</div>
    </button>
  );
}

function MapCategorySegmentedControl({
  categories,
  activeCategories,
  isLocked,
  onToggle,
}: {
  categories: typeof mapCategoryStyles;
  activeCategories: MapCategoryLabel[];
  isLocked: boolean;
  onToggle: (label: MapCategoryLabel) => void;
}) {
  return (
    <div className="map-category-card" role="group" aria-label="Map categories">
      {categories.map((category, index) => {
        const Icon = category.icon;
        const isActive = activeCategories.includes(category.label);
        const tint = hexToRgba(category.color, 0.1);
        const indicator = hexToRgba(category.color, 0.22);

        return (
          <button
            type="button"
            key={category.label}
            aria-pressed={isActive}
            aria-label={`${isActive ? "Hide" : "Show"} ${category.label} places`}
            onClick={() => {
              if (isLocked) return;
              onToggle(category.label);
            }}
            disabled={isLocked && !isActive}
            className={`map-category-segment ${isActive ? "active" : ""} ${!isActive ? "is-neutral" : ""}`}
            style={
              isActive
                ? ({
                    "--map-segment-color": category.color,
                    "--map-segment-tint": tint,
                    "--map-segment-indicator": indicator,
                  } as CSSProperties)
                : undefined
            }
          >
            <span className="map-category-icon">
              <Icon size={16} strokeWidth={2.1} />
            </span>
            <span className="map-category-label">{category.label}</span>
            {index < categories.length - 1 ? <span className="map-category-divider" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}

export function MapScreen({
  focusedCategory = null,
  savedPlaces,
  onBack,
  onAddLink,
}: {
  focusedCategory?: MapCategoryLabel | null;
  savedPlaces: SavedPlaceRecord[];
  onBack?: () => void;
  onAddLink?: () => void;
}) {
  const {
    currentLocationLabel,
    currentCoords,
    deviceCoords,
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
  const [radiusKm, setRadiusKm] = useState(10);
  const [mapMinDimensionPx, setMapMinDimensionPx] = useState(320);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [activePinPreview, setActivePinPreview] = useState<MapPlacePin | null>(null);
  const sheetTouchStartYRef = useRef<number | null>(null);
  const [isCountBump, setIsCountBump] = useState(false);
  const [isLocationMenuOpen, setIsLocationMenuOpen] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<Array<{ placeId: string; label: string; secondaryText: string | null; description: string | null }>>([]);
  const [isLocationSearching, setIsLocationSearching] = useState(false);
  const [isLocationSearchUnavailable, setIsLocationSearchUnavailable] = useState(false);
  const locationShellRef = useRef<HTMLDivElement | null>(null);
  const effectiveLocationLabel = currentLocationLabel || "Dhanaut, Bihar";
  const googleMapsApiKey = String(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || import.meta.env.VITE_GOOGLE_PLACES_API_KEY || "",
  ).trim();
  const hasMapsKey = Boolean(googleMapsApiKey);
  const { isLoaded: isMapLoaded, loadError: mapLoadError } = useJsApiLoader({
    id: "wr-google-map",
    googleMapsApiKey,
    libraries: GOOGLE_MAP_LIBRARIES,
  });
  const isMapReady = hasMapsKey && isMapLoaded && !mapLoadError;

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

  const filteredSavedPlaces = useMemo(
    () => savedPlaces.filter((place) => activeMapCategories.includes(place.category)),
    [activeMapCategories, savedPlaces],
  );

  const placesMissingCoordinates = useMemo(
    () =>
      filteredSavedPlaces.filter(
        (place) => typeof place.lat !== "number" || typeof place.lng !== "number",
      ),
    [filteredSavedPlaces],
  );

  const mapPlaces = useMemo(
    () =>
      filteredSavedPlaces.filter(
        (place) => typeof place.lat === "number" && typeof place.lng === "number",
      ),
    [filteredSavedPlaces],
  );
  const mapCenter = currentCoords || deviceCoords || FALLBACK_MAP_CENTER;
  const radiusMapZoom = useMemo(() => getGoogleZoomForRadius(radiusKm), [radiusKm]);

  const inRadiusMapPlaces = useMemo(
    () =>
      mapPlaces.filter((place) =>
        distanceBetweenKm(mapCenter, {
          lat: place.lat as number,
          lng: place.lng as number,
        }) <= radiusKm,
      ),
    [mapCenter, mapPlaces, radiusKm],
  );

  useEffect(() => {
    console.log("savedPlaces for map:", savedPlaces);
    console.log("mapPlaces with coordinates:", mapPlaces);
    console.log("places missing coordinates:", placesMissingCoordinates);
  }, [mapPlaces, placesMissingCoordinates, savedPlaces]);

  const visiblePins = useMemo(() => {
    const places = inRadiusMapPlaces;

    if (!places.length) return [];

    return places.map((place, index) => {
      const lat = place.lat as number;
      const lng = place.lng as number;
      const latKmOffset = (lat - mapCenter.lat) * 111;
      const lngKmOffset =
        (lng - mapCenter.lng) * 111 * Math.cos(toRadians(mapCenter.lat));
      const x = MAP_CENTER.x + (lngKmOffset / Math.max(radiusKm, 1)) * 44;
      const y = MAP_CENTER.y - (latKmOffset / Math.max(radiusKm, 1)) * 44;
      const style = mapCategoryStyles.find((item) => item.label === place.category);
      return {
        ...place,
        color: style?.color || "#10213f",
        x: `${Math.max(10, Math.min(90, x + (index % 2 === 0 ? 0 : 0.4)))}%`,
        y: `${Math.max(14, Math.min(88, y))}%`,
      };
    });
  }, [inRadiusMapPlaces, mapCenter, radiusKm]);

  const sliderPercent = ((radiusKm - 2) / 98) * 100;
  const isCategoryLockActive = focusedCategory !== null;
  const radiusProgress = (radiusKm - 2) / 98;
  const radiusVisualPx = radiusProgress * mapMinDimensionPx * MAX_RADIUS_VISUAL_RATIO;
  const inRangeCount = visiblePins.length;
  const inRangeNoun = inRangeCount === 1 ? "place" : "places";
  const closePinPreview = () => setActivePinPreview(null);

  useEffect(() => {
    if (activePinPreview && !visiblePins.some((pin) => pin.id === activePinPreview.id)) {
      setActivePinPreview(null);
    }
  }, [activePinPreview, visiblePins]);

  useEffect(() => {
    setIsCountBump(true);
    const timer = window.setTimeout(() => setIsCountBump(false), 180);
    return () => window.clearTimeout(timer);
  }, [inRangeCount]);

  useEffect(() => {
    if (!isLocationMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const node = locationShellRef.current;
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
          <div className="wr-map-location-shell" ref={locationShellRef}>
            <div className="wr-map-search">
              <MapPin size={15} className="wr-map-search-pin" />
              <div className="wr-map-search-texts">
                <span className="wr-map-search-main">{effectiveLocationLabel}</span>
              </div>
              <button type="button" className="wr-map-search-change" onClick={() => setIsLocationMenuOpen((open) => !open)}>
                {isLocating ? "Locating..." : "Change"}
              </button>
              <span className="wr-map-search-divider" aria-hidden="true" />
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
                        showToast({ message: "Couldn't set that location. Please try again.", variant: "error" });
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
        </div>

        <MapCategorySegmentedControl
          categories={mapCategoryStyles}
          activeCategories={activeMapCategories}
          isLocked={isCategoryLockActive}
          onToggle={toggleMapCategory}
        />
      </div>

      <div className="wr-map-canvas" aria-label="Map canvas" ref={canvasRef}>
        {isMapReady ? (
          <GoogleMap
            mapContainerClassName="wr-map-google-surface"
            center={mapCenter}
            zoom={radiusMapZoom}
            onClick={() => setActivePinPreview(null)}
            options={{
              streetViewControl: false,
              mapTypeControl: false,
              fullscreenControl: false,
              gestureHandling: "cooperative",
              styles: LIGHT_MAP_STYLES,
            }}
          >
            <CircleF
              center={mapCenter}
              radius={radiusKm * 1000}
              options={{
                fillColor: "#2b77f5",
                fillOpacity: 0.07,
                strokeColor: "#2b77f5",
                strokeOpacity: 0.18,
                strokeWeight: 1.6,
                clickable: false,
              }}
            />
            {visiblePins.map((pin) => (
              <MarkerF
                key={pin.id}
                position={{ lat: pin.lat as number, lng: pin.lng as number }}
                onClick={() => setActivePinPreview(pin)}
                icon={{
                  path: window.google.maps.SymbolPath.CIRCLE,
                  scale: activePinPreview?.id === pin.id ? 10 : 8,
                  fillColor: pin.color,
                  fillOpacity: 1,
                  strokeColor: "#ffffff",
                  strokeWeight: 3,
                }}
                zIndex={activePinPreview?.id === pin.id ? 1000 : 10}
              />
            ))}
          </GoogleMap>
        ) : null}
        <div className="wr-map-current-area" aria-hidden="true">
          <div
            className="wr-map-radius-overlay"
            style={{
              width: `${radiusVisualPx * 2}px`,
              height: `${radiusVisualPx * 2}px`,
            }}
          />
          <div className="wr-map-center-marker">
            <div className="wr-map-center-pulse" />
            <div className="wr-map-center-dot" />
          </div>
        </div>
        {!isMapReady ? <div className="wr-map-base" /> : null}
        {!isMapReady ? <div className="wr-map-block wr-map-block-a" /> : null}
        {!isMapReady ? <div className="wr-map-block wr-map-block-b" /> : null}
        {!isMapReady ? <div className="wr-map-block wr-map-block-c" /> : null}
        {!isMapReady ? <div className="wr-map-block wr-map-block-d" /> : null}
        {!isMapReady ? <div className="wr-map-block wr-map-block-e" /> : null}
        {!isMapReady ? <div className="wr-map-block wr-map-block-f" /> : null}
        {!isMapReady ? <div className="wr-map-road wr-map-road-a" /> : null}
        {!isMapReady ? <div className="wr-map-road wr-map-road-b" /> : null}
        {!isMapReady ? <div className="wr-map-road wr-map-road-c" /> : null}
        {!isMapReady ? <div className="wr-map-road wr-map-road-d" /> : null}
        {!isMapReady ? visiblePins.map((pin) => (
          <MapPinMarker
            key={pin.id}
            pin={pin}
            selected={activePinPreview?.id === pin.id}
            onSelect={setActivePinPreview}
          />
        )) : null}

        <button type="button" className="wr-map-current-location" onClick={() => void requestCurrentLocation()} aria-label="Locate me">
          <LocateFixed size={11} />
        </button>

        <div className={`wr-map-in-range-pill ${isCountBump ? "is-bump" : ""}`} aria-live="polite">
          <span className="wr-map-in-range-count">{inRangeCount}</span>
          <span className="wr-map-in-range-label">{inRangeNoun}</span>
        </div>
        {filteredSavedPlaces.length === 0 ? (
          <div className="wr-map-empty-state" aria-live="polite">
            <p className="wr-map-empty-title">No places added yet</p>
            <p className="wr-map-empty-copy">Save your first reel or place to see it on the map.</p>
            <div className="wr-map-empty-actions">
              <button type="button" className="wr-map-empty-btn is-primary" onClick={() => onAddLink?.()}>
                Add place
              </button>
            </div>
          </div>
        ) : null}
        {placesMissingCoordinates.length ? (
          <section className="wr-map-missing-card" aria-label="Saved places without location">
            <div className="wr-map-missing-head">
              <h3>Saved places without location</h3>
              <span>{placesMissingCoordinates.length}</span>
            </div>
            <div className="wr-map-missing-list">
              {placesMissingCoordinates.slice(0, 4).map((place) => (
                <article key={place.id} className="wr-map-missing-item">
                  <div className="wr-map-missing-copy">
                    <p>{place.title}</p>
                    <span>{place.locality}</span>
                  </div>
                  <strong>{place.category}</strong>
                </article>
              ))}
            </div>
          </section>
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
            aria-label={`${activePinPreview.title} details`}
          >
            <button type="button" className="wr-map-sheet-close" aria-label="Close map place details" onClick={closePinPreview}>
              <X size={16} />
            </button>
            <img src={activePinPreview.imageUrl} alt={activePinPreview.title} className="wr-map-sheet-image" />
            <h3 className="wr-map-sheet-title">{activePinPreview.title}</h3>
            <p className="wr-map-sheet-meta">{activePinPreview.category} · {activePinPreview.locality}</p>
            <p className="wr-map-sheet-address">{activePinPreview.fullAddress}</p>
            <p className="wr-map-sheet-timing">{activePinPreview.metaPrimary} · {activePinPreview.metaSecondary}</p>
            <div className="wr-map-sheet-actions">
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activePinPreview.fullAddress)}`}
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
