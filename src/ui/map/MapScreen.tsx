import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Globe2, LocateFixed, MapPin, Pencil, Search, Share2, Trash2, X } from "lucide-react";
import {
  CircleF,
  GoogleMap,
  MarkerF,
  OVERLAY_MOUSE_TARGET,
  OverlayViewF,
  useJsApiLoader,
} from "@react-google-maps/api";
import { mapCategoryStyles, runMapDataChecks, type MapCategoryLabel } from "./map.data";
import { useUx } from "../layout/UxProvider";
import { bearingRadians, distanceKm, type LatLng } from "../geo";
import {
  buildPlaceMapsUrl,
  sharePlaceExternally,
} from "../home/shareHelpers";
import {
  isPlaceGlobal,
  removeSavedPlace,
  togglePlaceGlobal,
  upsertSavedPlace,
  type SavedPlaceRecord,
} from "../home/savedPlaces";
import "./map.css";

runMapDataChecks();

const MAP_CENTER = { x: 51, y: 56 };
const MAX_RADIUS_VISUAL_RATIO = 0.44;
const FALLBACK_MAP_CENTER = { lat: 25.5941, lng: 85.1376 };
const GOOGLE_MAP_LIBRARIES: ("places")[] = ["places"];
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
const LIGHT_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { featureType: "poi.business", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#c7d4e1" }, { weight: 1 }] },
  { featureType: "administrative.neighborhood", elementType: "labels.text.fill", stylers: [{ color: "#67778a" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#516274" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#edf3f5" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#d5e8d0" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#5e7d61" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#b9dcfb" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4f739d" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.local", elementType: "geometry", stylers: [{ color: "#fdfefe" }] },
  { featureType: "road.local", elementType: "geometry.stroke", stylers: [{ color: "#d7e0ea" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#f7f9fb" }] },
  { featureType: "road.arterial", elementType: "geometry.stroke", stylers: [{ color: "#ccd7e2" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#f7ebcf" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#dcc58a" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#5b6d82" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#687b90" }] },
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

function GoogleMapPinLabel({
  pin,
  selected,
  onSelect,
}: {
  pin: MapPlacePin;
  selected: boolean;
  onSelect: (pin: MapPlacePin) => void;
}) {
  return (
    <OverlayViewF
      position={{ lat: pin.lat as number, lng: pin.lng as number }}
      mapPaneName={OVERLAY_MOUSE_TARGET}
      getPixelPositionOffset={(width, height) => ({
        x: Math.round(-width / 2),
        y: Math.round(-(height + 28)),
      })}
    >
      <button
        type="button"
        className={`wr-map-google-label ${selected ? "is-selected" : ""}`}
        onClick={() => onSelect(pin)}
        aria-label={`Open ${pin.title} details`}
      >
        {pin.title}
      </button>
    </OverlayViewF>
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
        const tint = hexToRgba(category.color, 0.22);
        const indicator = hexToRgba(category.color, 0.46);

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
  const [editingPlace, setEditingPlace] = useState<MapPlacePin | null>(null);
  const [deleteConfirmPlace, setDeleteConfirmPlace] = useState<MapPlacePin | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editLocality, setEditLocality] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editCategory, setEditCategory] = useState<MapCategoryLabel>("Explore");
  const [isSheetClosing, setIsSheetClosing] = useState(false);
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

  const mapPlaces = useMemo(
    () =>
      filteredSavedPlaces.filter(
        (place) => typeof place.lat === "number" && typeof place.lng === "number",
      ),
    [filteredSavedPlaces],
  );
  const mapCenter = useMemo(() => {
    if (currentCoords) {
      return { lat: currentCoords.lat, lng: currentCoords.lng };
    }
    if (deviceCoords) {
      return { lat: deviceCoords.lat, lng: deviceCoords.lng };
    }
    return FALLBACK_MAP_CENTER;
  }, [currentCoords?.lat, currentCoords?.lng, deviceCoords?.lat, deviceCoords?.lng]);
  const radiusMapZoom = useMemo(() => getGoogleZoomForRadius(radiusKm), [radiusKm]);

  const visibleMapPlaces = useMemo(
    () =>
      mapPlaces.filter((place) =>
        distanceKm(mapCenter, {
          lat: place.lat as number,
          lng: place.lng as number,
        }) <= radiusKm,
      ),
    [mapCenter, mapPlaces, radiusKm],
  );

  const visiblePins = useMemo(() => {
    const places = visibleMapPlaces;

    if (!places.length) return [];

    return places.map((place, index) => {
      const placeCoords: LatLng = { lat: place.lat as number, lng: place.lng as number };
      const distanceRatio = Math.min(1, distanceKm(mapCenter, placeCoords) / Math.max(radiusKm, 1));
      const bearing = bearingRadians(mapCenter, placeCoords);
      const visualRadius = distanceRatio * 44;
      const x = MAP_CENTER.x + Math.sin(bearing) * visualRadius;
      const y = MAP_CENTER.y - Math.cos(bearing) * visualRadius;
      const style = mapCategoryStyles.find((item) => item.label === place.category);
      return {
        ...place,
        color: style?.color || "#10213f",
        x: `${Math.max(10, Math.min(90, x + (index % 2 === 0 ? 0 : 0.4)))}%`,
        y: `${Math.max(14, Math.min(88, y))}%`,
      };
    });
  }, [visibleMapPlaces, mapCenter, radiusKm]);

  const sliderPercent = ((radiusKm - 2) / 98) * 100;
  const isCategoryLockActive = focusedCategory !== null;
  const radiusProgress = (radiusKm - 2) / 98;
  const radiusVisualPx = radiusProgress * mapMinDimensionPx * MAX_RADIUS_VISUAL_RATIO;
  const visiblePlaceCount = visiblePins.length;
  const hasVisiblePins = visiblePlaceCount > 0;
  const inRangeNoun = visiblePlaceCount === 1 ? "place" : "places";
  const hasOverlayOpen = Boolean(activePinPreview || editingPlace || deleteConfirmPlace);
  const overlayTarget =
    typeof document !== "undefined"
      ? (document.querySelector(".wr-phone-shell") as HTMLElement | null) || document.body
      : null;
  const closePinPreview = () => {
    if (!activePinPreview || isSheetClosing) return;
    setIsSheetClosing(true);
  };

  useEffect(() => {
    if (!isSheetClosing) return;
    const timer = window.setTimeout(() => {
      setActivePinPreview(null);
      setIsSheetClosing(false);
    }, 190);
    return () => window.clearTimeout(timer);
  }, [isSheetClosing]);

  useEffect(() => {
    if (activePinPreview && !visiblePins.some((pin) => pin.id === activePinPreview.id)) {
      setActivePinPreview(null);
    }
  }, [activePinPreview, visiblePins]);

  useEffect(() => {
    if (!hasOverlayOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const surface = document.querySelector(".wr-home-surface") as HTMLDivElement | null;
    const previousSurfaceOverflow = surface?.style.overflow;
    const previousSurfaceTouchAction = surface?.style.touchAction;
    const previousSurfaceOverscroll = surface?.style.overscrollBehavior;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    if (surface) {
      surface.style.overflow = "hidden";
      surface.style.touchAction = "none";
      surface.style.overscrollBehavior = "none";
    }

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      if (surface) {
        surface.style.overflow = previousSurfaceOverflow || "";
        surface.style.touchAction = previousSurfaceTouchAction || "";
        surface.style.overscrollBehavior = previousSurfaceOverscroll || "";
      }
    };
  }, [hasOverlayOpen]);

  const openEditPlace = (place: MapPlacePin) => {
    setEditTitle(place.title);
    setEditLocality(place.locality);
    setEditAddress(place.fullAddress);
    setEditCategory(place.category);
    setEditingPlace(place);
  };

  const savePlaceEdit = () => {
    if (!editingPlace) return;
    const title = editTitle.trim();
    const locality = editLocality.trim();
    const fullAddress = editAddress.trim() || locality;
    if (!title || !locality) {
      showToast({ message: "Title and location are required.", variant: "error" });
      return;
    }

    const updated: MapPlacePin = {
      ...editingPlace,
      title,
      locality,
      fullAddress,
      category: editCategory,
      metaPrimary: editCategory,
    };

    upsertSavedPlace(updated);
    setActivePinPreview(updated);
    setEditingPlace(null);
    showToast({ message: "Card updated", variant: "success" });
  };

  const handleRecommendPlace = (place: MapPlacePin) => {
    const nextPlace = togglePlaceGlobal(place);
    setActivePinPreview((current) => (current?.id === place.id ? { ...current, ...nextPlace } : current));
    showToast({
      message: isPlaceGlobal(nextPlace)
        ? "This place is now global. Others can discover it in Connect."
        : "Removed from global recommendations.",
      variant: isPlaceGlobal(nextPlace) ? "success" : "info",
    });
  };

  const handleSharePlace = async (place: MapPlacePin) => {
    try {
      const result = await sharePlaceExternally(place);
      if (result === "copied") {
        showToast({ message: "Share link copied", variant: "success" });
      }
    } catch {
      showToast({ message: "Could not open the share sheet right now.", variant: "error" });
    }
  };

  const deletePlace = async (place: MapPlacePin) => {
    removeSavedPlace(place);
    if (place.placeId) {
      fetch(`${API_BASE_URL}/api/saved-places/${encodeURIComponent(place.placeId)}`, {
        method: "DELETE",
        credentials: "include",
      }).catch(() => undefined);
    }
    setActivePinPreview(null);
    setEditingPlace(null);
    setDeleteConfirmPlace(null);
    showToast({ message: "Card deleted", variant: "info" });
  };

  useEffect(() => {
    setIsCountBump(true);
    const timer = window.setTimeout(() => setIsCountBump(false), 180);
    return () => window.clearTimeout(timer);
  }, [visiblePlaceCount]);

  const overlays =
    overlayTarget && (activePinPreview || editingPlace || deleteConfirmPlace)
      ? createPortal(
          <>
            {activePinPreview ? (
              <div
                className={`wr-taste-sheet-layer ${isSheetClosing ? "is-closing" : ""}`}
                onClick={closePinPreview}
                role="presentation"
              >
                <article
                  className="wr-taste-sheet wr-map-place-sheet"
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
                  <div className="wr-taste-sheet-toolbar place-sheet-actions">
                    <button
                      type="button"
                      className={`wr-taste-sheet-icon-btn ${isPlaceGlobal(activePinPreview) ? "is-active" : ""}`}
                      aria-label={isPlaceGlobal(activePinPreview) ? "Remove from Connect" : "Recommend in Connect"}
                      onClick={() => handleRecommendPlace(activePinPreview)}
                    >
                      <Globe2 size={15} />
                    </button>
                    <button
                      type="button"
                      className="wr-taste-sheet-icon-btn"
                      aria-label="Share place"
                      onClick={() => void handleSharePlace(activePinPreview)}
                    >
                      <Share2 size={15} />
                    </button>
                    <button
                      type="button"
                      className="wr-taste-sheet-icon-btn"
                      aria-label="Edit place"
                      onClick={() => openEditPlace(activePinPreview)}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      className="wr-taste-sheet-icon-btn is-delete"
                      aria-label="Delete place"
                      onClick={() => setDeleteConfirmPlace(activePinPreview)}
                    >
                      <Trash2 size={15} />
                    </button>
                    <button
                      type="button"
                      className="wr-taste-sheet-icon-btn"
                      aria-label="Close details"
                      onClick={closePinPreview}
                    >
                      <X size={15} />
                    </button>
                  </div>

                  <div className="wr-taste-sheet-body place-sheet-content">
                    {activePinPreview.imageUrl ? (
                      <img src={activePinPreview.imageUrl} alt={activePinPreview.title} className="wr-taste-sheet-image" />
                    ) : (
                      <div className="wr-taste-sheet-image wr-map-place-sheet-placeholder" aria-hidden="true" />
                    )}
                    <h3 className="wr-taste-sheet-title">{activePinPreview.title}</h3>
                    <p className="wr-taste-sheet-address">
                      <strong>Full address:</strong> {activePinPreview.fullAddress || activePinPreview.locality}
                    </p>
                    <div className="wr-taste-sheet-actions">
                      <a
                        href={buildPlaceMapsUrl(activePinPreview)}
                        target="_blank"
                        rel="noreferrer"
                        className="wr-taste-sheet-action-btn"
                      >
                        Directions
                      </a>
                      <a
                        href={activePinPreview.videoUrl || "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="wr-taste-sheet-action-btn is-video"
                        aria-disabled={!activePinPreview.videoUrl}
                        onClick={(event) => {
                          if (!activePinPreview.videoUrl) {
                            event.preventDefault();
                            showToast({ message: "No video link available yet.", variant: "info" });
                          }
                        }}
                      >
                        Watch video
                      </a>
                    </div>
                  </div>
                </article>
              </div>
            ) : null}

            {editingPlace ? (
              <div className="wr-add-edit-layer" role="presentation">
                <div className="wr-add-edit-backdrop" onClick={() => setEditingPlace(null)} />
                <section className="wr-add-edit-sheet" aria-label="Edit saved place">
                  <div className="wr-add-edit-header">
                    <div>
                      <p className="wr-add-edit-eyebrow">Saved place</p>
                      <h3>Edit card details</h3>
                    </div>
                    <button type="button" className="wr-add-edit-close" onClick={() => setEditingPlace(null)} aria-label="Close edit form">
                      <X size={16} />
                    </button>
                  </div>

                  <label className="wr-add-edit-field">
                    <span>Place name</span>
                    <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} placeholder="Place name" />
                  </label>

                  <label className="wr-add-edit-field">
                    <span>Locality</span>
                    <input value={editLocality} onChange={(event) => setEditLocality(event.target.value)} placeholder="Locality or city" />
                  </label>

                  <label className="wr-add-edit-field">
                    <span>Full address</span>
                    <textarea
                      value={editAddress}
                      onChange={(event) => setEditAddress(event.target.value)}
                      rows={3}
                      placeholder="Full address"
                    />
                  </label>

                  <label className="wr-add-edit-field">
                    <span>Category</span>
                    <select value={editCategory} onChange={(event) => setEditCategory(event.target.value as MapCategoryLabel)}>
                      <option value="Taste">Taste</option>
                      <option value="Activity">Activity</option>
                      <option value="Stay">Stay</option>
                      <option value="Explore">Explore</option>
                    </select>
                  </label>

                  <div className="wr-add-edit-actions">
                    <button type="button" className="wr-add-edit-btn is-secondary" onClick={() => setEditingPlace(null)}>
                      Cancel
                    </button>
                    <button type="button" className="wr-add-edit-btn is-primary" onClick={savePlaceEdit}>
                      Save changes
                    </button>
                  </div>
                </section>
              </div>
            ) : null}

            {deleteConfirmPlace ? (
              <div className="wr-add-edit-layer" role="presentation">
                <div className="wr-add-edit-backdrop" onClick={() => setDeleteConfirmPlace(null)} />
                <section className="wr-delete-confirm-sheet" aria-label="Delete saved place">
                  <div className="wr-delete-confirm-icon">
                    <Trash2 size={18} />
                  </div>
                  <h3>Delete this card?</h3>
                  <p>
                    Remove <strong>{deleteConfirmPlace.title}</strong> from your saved places?
                  </p>
                  <div className="wr-delete-confirm-actions">
                    <button
                      type="button"
                      className="wr-delete-confirm-btn is-secondary"
                      onClick={() => setDeleteConfirmPlace(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="wr-delete-confirm-btn is-danger"
                      onClick={() => void deletePlace(deleteConfirmPlace)}
                    >
                      Delete
                    </button>
                  </div>
                </section>
              </div>
            ) : null}
          </>,
          overlayTarget,
        )
      : null;

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
                fillColor: "#2F80ED",
                fillOpacity: 0.1,
                strokeColor: "#2F80ED",
                strokeOpacity: 0.55,
                strokeWeight: 2,
                clickable: false,
                zIndex: 1,
              }}
            />
            <MarkerF
              position={mapCenter}
              icon={{
                path: window.google.maps.SymbolPath.CIRCLE,
                scale: 7,
                fillColor: "#2b77f5",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 3,
              }}
              zIndex={1001}
            />
            {visiblePins.map((pin) => (
              <Fragment key={pin.id}>
                <MarkerF
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
                {activePinPreview?.id === pin.id ? (
                  <GoogleMapPinLabel
                    pin={pin}
                    selected
                    onSelect={setActivePinPreview}
                  />
                ) : null}
              </Fragment>
            ))}
          </GoogleMap>
        ) : null}
        {!isMapReady ? (
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
        ) : null}
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
          <span className="wr-map-in-range-count">{visiblePlaceCount}</span>
          <span className="wr-map-in-range-label">{inRangeNoun}</span>
        </div>
        {!hasVisiblePins ? (
          <div className="wr-map-empty-state" aria-live="polite">
            <p className="wr-map-empty-title">No mapped places in range</p>
            <p className="wr-map-empty-copy">Increase the radius or update location details to see places on your map.</p>
            <div className="wr-map-empty-actions">
              <button type="button" className="wr-map-empty-btn is-primary" onClick={() => onAddLink?.()}>
                Add place
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
      {overlays}
    </section>
  );
}



