import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, MapPin, Navigation, Play, X } from "lucide-react";
import { GoogleMap, MarkerF, PolylineF, useJsApiLoader } from "@react-google-maps/api";
import { useReducedMotion } from "framer-motion";
import { useUx } from "../layout/UxProvider";
import {
  buildStrollStopDirectionsUrl,
  formatRouteDistance,
  formatStopDuration,
  getNumberedMapStops,
  getOrderedStrollStops,
  getStrollMapFallbackReason,
  getStrollMapGestureHandling,
  getStrollRoutePath,
  hasStoredRouteData,
  hasValidReelUrl,
  selectStopById,
  type StrollDetailLoadState,
} from "./strollDetail";
import { fetchStrollDetail, type PersistentStrollDetail, type PersistentStrollStop } from "./strollLibrary";
import {
  acceptStrollAdaptation,
  fetchStrollAdaptationRecommendation,
  type StrollAdaptationLoadState,
  type StrollAdaptationRecommendation,
} from "./strollAdaptation";
import { StrollAdaptationPanel } from "./StrollAdaptationPanel";
import {
  fetchStrollLiveConditions,
  type LiveConditionsLoadState,
  type PersistentStrollLiveConditions,
} from "./strollLiveConditions";
import { StrollLiveConditionsPanel } from "./StrollLiveConditionsPanel";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
const GOOGLE_MAP_LIBRARIES: ("places")[] = ["places"];
const STROLL_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { featureType: "poi.business", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#f1efe7" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#bcdff7" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#d5dee7" }] },
];

type StrollDetailScreenProps = {
  strollId: string;
  onBack: () => void;
};

function getStopTitle(stop: PersistentStrollStop) {
  return stop.placeTitle || stop.placeId || `Stop ${stop.sequence}`;
}

function StrollStopSheet({
  stop,
  stopNumber,
  onClose,
}: {
  stop: PersistentStrollStop;
  stopNumber: number;
  onClose: () => void;
}) {
  const directionsUrl = buildStrollStopDirectionsUrl(stop);
  const duration = formatStopDuration(stop.estimatedVisitDurationMinutes);
  const distance = formatRouteDistance(stop.routeDistanceMeters);
  const hasReel = hasValidReelUrl(stop);

  return (
    <div className="wr-stroll-detail-sheet-layer" role="presentation">
      <article className="wr-stroll-detail-sheet" role="dialog" aria-modal="false" aria-label={`${getStopTitle(stop)} details`}>
        <button type="button" className="wr-stroll-detail-sheet-close" aria-label="Close stop details" onClick={onClose}>
          <X size={16} />
        </button>
        {stop.placeImageUrl ? <img src={stop.placeImageUrl} alt="" className="wr-stroll-detail-sheet-image" /> : null}
        <span className="wr-stroll-detail-stop-kicker">Stop {stopNumber}</span>
        <h3>{getStopTitle(stop)}</h3>
        {stop.placeAddress || stop.placeLocality ? (
          <p className="wr-stroll-detail-address">{stop.placeAddress || stop.placeLocality}</p>
        ) : null}
        {stop.generatedDescription || stop.placeDescription ? <p>{stop.generatedDescription || stop.placeDescription}</p> : null}
        {stop.reason ? <p>{stop.reason}</p> : null}
        <div className="wr-stroll-detail-sheet-meta">
          {duration ? <span>{duration}</span> : null}
          {distance ? <span>{distance}</span> : null}
        </div>
        <div className="wr-stroll-detail-sheet-actions">
          {directionsUrl ? (
            <a href={directionsUrl} target="_blank" rel="noreferrer" className="wr-stroll-detail-action">
              <Navigation size={14} />
              Directions
            </a>
          ) : null}
          {hasReel ? (
            <a href={stop.placeVideoUrl || ""} target="_blank" rel="noreferrer" className="wr-stroll-detail-action">
              <Play size={14} />
              Watch reel
            </a>
          ) : null}
        </div>
      </article>
    </div>
  );
}

export function StrollDetailScreen({ strollId, onBack }: StrollDetailScreenProps) {
  const prefersReducedMotion = useReducedMotion();
  const { currentCoords } = useUx();
  const [loadState, setLoadState] = useState<StrollDetailLoadState>("loading");
  const [liveLoadState, setLiveLoadState] = useState<LiveConditionsLoadState>("idle");
  const [adaptationLoadState, setAdaptationLoadState] = useState<StrollAdaptationLoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [adaptationError, setAdaptationError] = useState<string | null>(null);
  const [stroll, setStroll] = useState<PersistentStrollDetail | null>(null);
  const [liveConditions, setLiveConditions] = useState<PersistentStrollLiveConditions | null>(null);
  const [adaptationRecommendation, setAdaptationRecommendation] = useState<StrollAdaptationRecommendation | null>(null);
  const [isAdaptationDismissed, setIsAdaptationDismissed] = useState(false);
  const [isAcceptingAdaptation, setIsAcceptingAdaptation] = useState(false);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const googleMapsApiKey = String(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || import.meta.env.VITE_GOOGLE_PLACES_API_KEY || "",
  ).trim();
  const { isLoaded: isMapLoaded, loadError: mapLoadError } = useJsApiLoader({
    id: "wr-google-map",
    googleMapsApiKey,
    libraries: GOOGLE_MAP_LIBRARIES,
  });

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setLoadState("loading");
      setError(null);
      fetchStrollDetail(API_BASE_URL, strollId)
        .then((nextStroll) => {
          if (cancelled) return;
          setStroll(nextStroll);
          setSelectedStopId(nextStroll.stops[0]?.id ?? null);
          setLoadState("ready");
        })
        .catch((fetchError) => {
          if (cancelled) return;
          setError(fetchError instanceof Error ? fetchError.message : "Could not load this Stroll.");
          setLoadState("error");
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [strollId]);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setAdaptationLoadState("loading");
      setAdaptationError(null);
      setAdaptationRecommendation(null);
      setIsAdaptationDismissed(false);
      fetchStrollAdaptationRecommendation(API_BASE_URL, strollId, currentCoords)
        .then((recommendation) => {
          if (cancelled) return;
          setAdaptationRecommendation(recommendation);
          setAdaptationLoadState("ready");
        })
        .catch((fetchError) => {
          if (cancelled) return;
          setAdaptationError(fetchError instanceof Error ? fetchError.message : "No reliable adaptation is available.");
          setAdaptationLoadState("error");
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [currentCoords, strollId]);

  const acceptAdaptation = (stopIds: string[]) => {
    if (isAcceptingAdaptation) return;
    setIsAcceptingAdaptation(true);
    setAdaptationError(null);
    acceptStrollAdaptation(API_BASE_URL, strollId, stopIds)
      .then((updatedStroll) => {
        setStroll(updatedStroll);
        setSelectedStopId(updatedStroll.stops[0]?.id ?? null);
        setAdaptationRecommendation(null);
        setIsAdaptationDismissed(true);
      })
      .catch((acceptError) => {
        setAdaptationError(acceptError instanceof Error ? acceptError.message : "Could not apply this order.");
        setAdaptationLoadState("error");
      })
      .finally(() => {
        setIsAcceptingAdaptation(false);
      });
  };

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setLiveLoadState("loading");
      setLiveError(null);
      setLiveConditions(null);
      fetchStrollLiveConditions(API_BASE_URL, strollId)
        .then((live) => {
          if (cancelled) return;
          setLiveConditions(live);
          setLiveLoadState(live.status === "unavailable" ? "unavailable" : "ready");
        })
        .catch((fetchError) => {
          if (cancelled) return;
          setLiveError(fetchError instanceof Error ? fetchError.message : "Live conditions are unavailable.");
          setLiveLoadState("error");
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [strollId]);

  const orderedStops = useMemo(() => getOrderedStrollStops(stroll), [stroll]);
  const mapStops = useMemo(() => getNumberedMapStops(orderedStops), [orderedStops]);
  const routePath = useMemo(() => getStrollRoutePath(mapStops), [mapStops]);
  const selectedStop = useMemo(() => selectStopById(orderedStops, selectedStopId), [orderedStops, selectedStopId]);
  const selectedStopNumber = selectedStop
    ? orderedStops.findIndex((stop) => stop.id === selectedStop.id) + 1
    : 0;
  const fallbackReason = getStrollMapFallbackReason({
    hasMapsKey: Boolean(googleMapsApiKey),
    isMapLoaded,
    hasMapLoadError: Boolean(mapLoadError),
    mapStopCount: mapStops.length,
  });
  const hasRouteData = hasStoredRouteData(orderedStops);
  const mapCenter = mapStops[0] ? { lat: mapStops[0].lat, lng: mapStops[0].lng } : { lat: 25.5941, lng: 85.1376 };

  useEffect(() => {
    if (!googleMapRef.current || !window.google?.maps || !mapStops.length) return;
    const bounds = new window.google.maps.LatLngBounds();
    for (const stop of mapStops) {
      bounds.extend({ lat: stop.lat, lng: stop.lng });
    }
    if (currentCoords) {
      bounds.extend(currentCoords);
    }
    googleMapRef.current.fitBounds(bounds, 56);
  }, [currentCoords, mapStops]);

  if (loadState === "loading") {
    return (
      <section className="wr-stroll-detail-screen" aria-label="Loading Stroll">
        <button type="button" className="wr-header-back" aria-label="Back" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <div className="wr-stroll-detail-state-card">Loading Stroll...</div>
      </section>
    );
  }

  if (loadState === "error" || !stroll) {
    return (
      <section className="wr-stroll-detail-screen" aria-label="Stroll error">
        <button type="button" className="wr-header-back" aria-label="Back" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <div className="wr-stroll-detail-state-card" role="alert">
          <strong>Could not open this Stroll</strong>
          <span>{error || "It may have been removed or you may not have access."}</span>
        </div>
      </section>
    );
  }

  return (
    <section className={`wr-stroll-detail-screen ${prefersReducedMotion ? "is-reduced-motion" : ""}`} aria-label={`${stroll.name} Stroll`}>
      <div className="wr-stroll-detail-topbar">
        <button type="button" className="wr-map-back-btn" aria-label="Back" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <p>STROLL</p>
          <h2>{stroll.name}</h2>
          <span>{stroll.city} - {orderedStops.length} stops</span>
        </div>
      </div>

      <div className="wr-stroll-detail-map-wrap">
        {!fallbackReason ? (
          <GoogleMap
            mapContainerClassName="wr-stroll-detail-google-map"
            center={mapCenter}
            zoom={14}
            onLoad={(map) => {
              googleMapRef.current = map;
            }}
            onUnmount={() => {
              googleMapRef.current = null;
            }}
            options={{
              streetViewControl: false,
              mapTypeControl: false,
              fullscreenControl: false,
              gestureHandling: getStrollMapGestureHandling(Boolean(prefersReducedMotion)),
              styles: STROLL_MAP_STYLES,
            }}
          >
            {routePath.length > 1 ? (
              <PolylineF
                path={routePath}
                options={{
                  strokeColor: hasRouteData ? "#0f766e" : "#102a57",
                  strokeOpacity: hasRouteData ? 0.88 : 0.62,
                  strokeWeight: hasRouteData ? 5 : 4,
                }}
              />
            ) : null}
            {currentCoords ? (
              <MarkerF
                position={currentCoords}
                label={{ text: "You", color: "#ffffff", fontWeight: "900" }}
                icon={{
                  path: window.google.maps.SymbolPath.CIRCLE,
                  scale: 8,
                  fillColor: "#2b77f5",
                  fillOpacity: 1,
                  strokeColor: "#ffffff",
                  strokeWeight: 3,
                }}
                zIndex={1000}
              />
            ) : null}
            {mapStops.map((stop) => (
              <MarkerF
                key={stop.id}
                position={{ lat: stop.lat, lng: stop.lng }}
                label={{ text: String(stop.markerNumber), color: "#ffffff", fontWeight: "900" }}
                onClick={() => setSelectedStopId(stop.id)}
                icon={{
                  path: window.google.maps.SymbolPath.CIRCLE,
                  scale: selectedStopId === stop.id ? 13 : 11,
                  fillColor: selectedStopId === stop.id ? "#c2410c" : "#102a57",
                  fillOpacity: 1,
                  strokeColor: "#ffffff",
                  strokeWeight: 3,
                }}
              />
            ))}
          </GoogleMap>
        ) : (
          <div className="wr-stroll-detail-map-fallback" role="status">
            <MapPin size={20} />
            <strong>Map preview unavailable</strong>
            <span>
              {fallbackReason === "loading"
                ? "Loading the map..."
                : fallbackReason === "missing_coordinates"
                  ? "Stops without stored coordinates still appear below."
                  : "Use the ordered stop list and Directions links below."}
            </span>
          </div>
        )}
      </div>

      <StrollLiveConditionsPanel
        loadState={liveLoadState}
        live={liveConditions}
        error={liveError}
      />

      <StrollAdaptationPanel
        loadState={adaptationLoadState}
        recommendation={adaptationRecommendation}
        error={adaptationError}
        dismissed={isAdaptationDismissed}
        accepting={isAcceptingAdaptation}
        onAccept={acceptAdaptation}
        onDismiss={() => setIsAdaptationDismissed(true)}
      />

      <div className="wr-stroll-detail-list" aria-label="Ordered Stroll stops">
        {orderedStops.map((stop, index) => {
          const isSelected = selectedStopId === stop.id;
          return (
            <button
              type="button"
              key={stop.id}
              className={`wr-stroll-detail-stop-row ${isSelected ? "is-selected" : ""}`}
              onClick={() => setSelectedStopId(stop.id)}
            >
              <span>{index + 1}</span>
              <div>
                <strong>{getStopTitle(stop)}</strong>
                <small>{stop.placeAddress || stop.placeLocality || stop.placeId}</small>
              </div>
            </button>
          );
        })}
      </div>

      {selectedStop ? (
        <StrollStopSheet
          stop={selectedStop}
          stopNumber={selectedStopNumber}
          onClose={() => setSelectedStopId(null)}
        />
      ) : null}
    </section>
  );
}
