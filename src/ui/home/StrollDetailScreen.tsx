import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, MapPin, Navigation, Play, X } from "lucide-react";
import { GoogleMap, MarkerF, OverlayViewF, PolylineF, useJsApiLoader, OVERLAY_MOUSE_TARGET } from "@react-google-maps/api";
import { useReducedMotion } from "framer-motion";
import { useUx } from "../layout/UxProvider";
import {
  buildFirstStopDescription,
  buildFirstStopLocality,
  buildFirstStopReason,
  buildFirstStopTitle,
  buildStopRowSupportingText,
  buildStrollContextLabel,
  buildStrollStopDirectionsUrl,
  buildWhyThisJourney,
  buildJourneyPreviewStops,
  buildJourneySummaryItems,
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
import { useDialogFocus } from "./useDialogFocus";
import {
  buildJourneyFootprints,
  buildJourneyRevealedPath,
  buildJourneyRoutePoints,
  createJourneyMotionController,
  getJourneyMotionFallbackReason,
  isJourneyMotionEnabled,
  shouldStartJourneyMotion,
  type JourneyPhase,
  type JourneyPoint,
} from "./journeyMotion";

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
  allowInitialJourneyMotionStart?: boolean;
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
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);
  const directionsUrl = buildStrollStopDirectionsUrl(stop);
  const duration = formatStopDuration(stop.estimatedVisitDurationMinutes);
  const distance = formatRouteDistance(stop.routeDistanceMeters);
  const hasReel = hasValidReelUrl(stop);

  return (
    <div className="wr-stroll-detail-sheet-layer" role="presentation">
      <article
        ref={dialogRef}
        className="wr-stroll-detail-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wr-stroll-stop-sheet-title"
        aria-describedby="wr-stroll-stop-sheet-description"
        tabIndex={-1}
      >
        <button type="button" className="wr-stroll-detail-sheet-close" aria-label="Close stop details" onClick={onClose}>
          <X size={16} />
        </button>
        {stop.placeImageUrl ? <img src={stop.placeImageUrl} alt="" className="wr-stroll-detail-sheet-image" /> : null}
        <span className="wr-stroll-detail-stop-kicker">Stop {stopNumber}</span>
        <h3 id="wr-stroll-stop-sheet-title">{getStopTitle(stop)}</h3>
        {stop.placeAddress || stop.placeLocality ? (
          <p className="wr-stroll-detail-address">{stop.placeAddress || stop.placeLocality}</p>
        ) : null}
        {stop.generatedDescription || stop.placeDescription ? (
          <p id="wr-stroll-stop-sheet-description">{stop.generatedDescription || stop.placeDescription}</p>
        ) : (
          <p id="wr-stroll-stop-sheet-description">Review stored details and actions for this Stroll stop.</p>
        )}
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

export function StrollDetailScreen({
  strollId,
  onBack,
  allowInitialJourneyMotionStart = true,
}: StrollDetailScreenProps) {
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
  const [openStopId, setOpenStopId] = useState<string | null>(null);
  const [journeyPhase, setJourneyPhase] = useState<JourneyPhase>("idle");
  const [journeyRevealProgress, setJourneyRevealProgress] = useState(0);
  const [journeyFootprints, setJourneyFootprints] = useState<Array<{ id: string; point: JourneyPoint; side: "left" | "right"; rotation: number; scale: number; opacity: number }>>([]);
  const [wakeupStopId, setWakeupStopId] = useState<string | null>(null);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const [isJourneyMapVisible, setIsJourneyMapVisible] = useState(false);
  const [isMapInstanceReady, setIsMapInstanceReady] = useState(false);
  const [areMapOverlaysReady, setAreMapOverlaysReady] = useState(false);
  const [isCameraFitComplete, setIsCameraFitComplete] = useState(false);
  const journeyMapRef = useRef<HTMLDivElement | null>(null);
  const motionControllerRef = useRef<ReturnType<typeof createJourneyMotionController> | null>(null);
  const hasStartedJourneyRef = useRef(false);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const isProgrammaticCameraMoveRef = useRef(false);
  const overlayReadinessFrameRef = useRef<number | null>(null);
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
          setOpenStopId(null);
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
        setOpenStopId(null);
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
  const journeyRoutePath = useMemo(() => buildJourneyRoutePoints(routePath, currentCoords), [currentCoords, routePath]);
  const revealedRoutePath = useMemo(() => buildJourneyRevealedPath(journeyRoutePath, journeyRevealProgress), [journeyRevealProgress, journeyRoutePath]);
  const openStop = useMemo(() => selectStopById(orderedStops, openStopId), [orderedStops, openStopId]);
  const selectedStopNumber = openStop
    ? orderedStops.findIndex((stop) => stop.id === openStop.id) + 1
    : 0;
  const firstStop = orderedStops[0] ?? null;
  const strollContextLabel = useMemo(() => buildStrollContextLabel(stroll), [stroll]);
  const firstStopTitle = useMemo(() => buildFirstStopTitle(firstStop), [firstStop]);
  const firstStopLocality = useMemo(() => buildFirstStopLocality(firstStop, stroll), [firstStop, stroll]);
  const firstStopDescription = useMemo(() => buildFirstStopDescription(firstStop), [firstStop]);
  const firstStopReason = useMemo(() => buildFirstStopReason(firstStop), [firstStop]);
  const journeyPreviewStops = useMemo(() => buildJourneyPreviewStops(stroll), [stroll]);
  const journeySummaryItems = useMemo(() => buildJourneySummaryItems(stroll), [stroll]);
  const whyThisJourney = useMemo(() => buildWhyThisJourney(stroll), [stroll]);
  const openStopDetails = (stopId: string) => {
    setSelectedStopId(stopId);
    setOpenStopId(stopId);
  };
  const fallbackReason = getStrollMapFallbackReason({
    hasMapsKey: Boolean(googleMapsApiKey),
    isMapLoaded,
    hasMapLoadError: Boolean(mapLoadError),
    mapStopCount: mapStops.length,
  });
  const hasRouteData = hasStoredRouteData(orderedStops);
  const mapCenter = mapStops[0] ? { lat: mapStops[0].lat, lng: mapStops[0].lng } : { lat: 25.5941, lng: 85.1376 };
  const motionEnabled = isJourneyMotionEnabled();
  const motionFallbackReason = getJourneyMotionFallbackReason({
    isEnabled: motionEnabled,
    prefersReducedMotion: Boolean(prefersReducedMotion),
    hasMapsKey: Boolean(googleMapsApiKey),
    isMapLoaded,
    hasMapLoadError: Boolean(mapLoadError),
    routePointCount: mapStops.length,
  });
  const hasRouteGeometry = journeyRoutePath.length >= 2;
  const isJourneyRenderReady =
    isJourneyMapVisible &&
    isMapInstanceReady &&
    areMapOverlaysReady &&
    isCameraFitComplete &&
    hasRouteGeometry;

  useEffect(() => {
    setIsJourneyMapVisible(false);
    if (prefersReducedMotion || !allowInitialJourneyMotionStart || fallbackReason) {
      return;
    }

    const mapElement = journeyMapRef.current;
    if (!mapElement) return;
    if (!("IntersectionObserver" in window)) {
      setIsJourneyMapVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.28)) {
          setIsJourneyMapVisible(true);
          observer.disconnect();
        }
      },
      { threshold: [0.28] },
    );
    observer.observe(mapElement);
    return () => observer.disconnect();
  }, [allowInitialJourneyMotionStart, fallbackReason, loadState, prefersReducedMotion, stroll?.id]);

  useEffect(() => {
    setAreMapOverlaysReady(false);
    if (overlayReadinessFrameRef.current !== null) {
      window.cancelAnimationFrame(overlayReadinessFrameRef.current);
      overlayReadinessFrameRef.current = null;
    }
    if (fallbackReason || !isMapInstanceReady || !hasRouteGeometry || !mapStops.length) return;
    overlayReadinessFrameRef.current = window.requestAnimationFrame(() => {
      overlayReadinessFrameRef.current = null;
      setAreMapOverlaysReady(true);
    });
    return () => {
      if (overlayReadinessFrameRef.current !== null) {
        window.cancelAnimationFrame(overlayReadinessFrameRef.current);
        overlayReadinessFrameRef.current = null;
      }
    };
  }, [fallbackReason, hasRouteGeometry, isMapInstanceReady, mapStops.length, stroll?.id]);

  useEffect(() => {
    const shouldStart = shouldStartJourneyMotion({
      loadState,
      hasUserInteracted,
      hasStartedJourney: hasStartedJourneyRef.current,
      allowInitialMotionStart: allowInitialJourneyMotionStart && isJourneyRenderReady,
      prefersReducedMotion: Boolean(prefersReducedMotion),
      isEnabled: motionEnabled,
      fallbackReason,
      routePointCount: mapStops.length,
    });

    if (!shouldStart) {
      const isWaitingForJourneyReadiness =
        loadState === "ready" &&
        allowInitialJourneyMotionStart &&
        !isJourneyRenderReady &&
        !hasUserInteracted &&
        !hasStartedJourneyRef.current &&
        !prefersReducedMotion &&
        motionEnabled &&
        (!fallbackReason || fallbackReason === "loading") &&
        mapStops.length >= 2;
      if (isWaitingForJourneyReadiness) return;

      if (
        loadState === "ready" &&
        allowInitialJourneyMotionStart &&
        (
          hasUserInteracted ||
          hasStartedJourneyRef.current ||
          Boolean(prefersReducedMotion) ||
          !motionEnabled ||
          Boolean(fallbackReason && fallbackReason !== "loading") ||
          mapStops.length < 2
        )
      ) {
        setJourneyPhase("completed");
        setJourneyRevealProgress(1);
        setJourneyFootprints([]);
        setWakeupStopId(null);
      }
      return;
    }

    hasStartedJourneyRef.current = true;
    const controller = createJourneyMotionController({
      routeStopIds: mapStops.map((stop) => stop.id),
      currentLocationExists: Boolean(currentCoords),
      prefersReducedMotion: Boolean(prefersReducedMotion),
      isEnabled: motionEnabled,
      onSnapshot: ({ phase, routeRevealProgress, activeFootprintIndex, wakeStopId }) => {
        setJourneyPhase(phase);
        setJourneyRevealProgress(routeRevealProgress);
        setWakeupStopId(wakeStopId);
        if (phase === "interrupted" || phase === "completed") {
          setJourneyFootprints([]);
          return;
        }
        const routePoints = mapStops.map((stop) => ({ lat: stop.lat, lng: stop.lng }));
        setJourneyFootprints(buildJourneyFootprints(routePoints, currentCoords, routeRevealProgress, Math.max(3, activeFootprintIndex + 2)));
      },
    });

    motionControllerRef.current?.destroy();
    motionControllerRef.current = controller;
    controller.begin();

    return () => {
      controller.destroy();
      motionControllerRef.current = null;
      setJourneyFootprints([]);
      setWakeupStopId(null);
    };
  }, [allowInitialJourneyMotionStart, currentCoords, fallbackReason, hasUserInteracted, isJourneyRenderReady, loadState, mapStops, motionEnabled, prefersReducedMotion, stroll?.id]);

  useEffect(() => {
    if (prefersReducedMotion) return;
    if (!googleMapRef.current || !window.google?.maps || !mapStops.length) return;
    setIsCameraFitComplete(false);
    isProgrammaticCameraMoveRef.current = true;
    const bounds = new window.google.maps.LatLngBounds();
    for (const stop of mapStops) {
      bounds.extend({ lat: stop.lat, lng: stop.lng });
    }
    if (currentCoords) {
      bounds.extend(currentCoords);
    }
    googleMapRef.current.fitBounds(bounds, 56);
  }, [currentCoords, mapStops, prefersReducedMotion]);

  if (loadState === "loading") {
    return (
      <section className="wr-stroll-detail-screen" aria-label="Loading Stroll">
        <button type="button" className="wr-header-back" aria-label="Back" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <div className="wr-stroll-detail-state-card" role="status" aria-live="polite">Loading Stroll...</div>
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

  const handleJourneyInteraction = () => {
    setHasUserInteracted(true);
    setJourneyPhase("interrupted");
    setJourneyRevealProgress(1);
    setJourneyFootprints([]);
    setWakeupStopId(null);
    motionControllerRef.current?.interrupt();
  };
  const handleMapCameraIdle = () => {
    isProgrammaticCameraMoveRef.current = false;
    setIsCameraFitComplete(true);
  };
  const handleMapZoomChanged = () => {
    // Google fires zoom_changed during fitBounds and map initialization; user zoom is handled by wheel/touch input.
    isProgrammaticCameraMoveRef.current = false;
  };
  const handleOpenStopDetails = (stopId: string) => {
    handleJourneyInteraction();
    openStopDetails(stopId);
  };

  return (
    <section className={`wr-stroll-detail-screen ${prefersReducedMotion ? "is-reduced-motion" : ""}`} aria-label={`${stroll.name} Stroll`}>
      <div className="wr-stroll-detail-topbar">
        <button type="button" className="wr-map-back-btn" aria-label="Back" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
      </div>

      <div className="wr-stroll-detail-first-view" data-testid="stroll-first-view">
        <div className="wr-stroll-detail-arrival">
          <p>{strollContextLabel}</p>
        </div>

        <div className="wr-stroll-detail-hero-card" aria-label="First stop hero">
          <h1 data-testid="stroll-first-stop-title">{firstStopTitle}</h1>
          <span>{firstStopLocality}</span>
          <p>{firstStopDescription}</p>
          <strong>{firstStopReason}</strong>
          {firstStop ? (
            <button type="button" className="wr-stroll-detail-begin-btn" onClick={() => handleOpenStopDetails(firstStop.id)}>
              Begin Here
            </button>
          ) : null}
        </div>

        <div className="wr-stroll-detail-journey-card" aria-label="Today's Journey">
          <span>Today&apos;s Journey</span>
          <div className="wr-stroll-detail-journey-steps">
            {journeyPreviewStops.map((stopTitle, index) => (
              <div key={`${stopTitle}-${index}`} className="wr-stroll-detail-journey-step">
                <strong>{stopTitle}</strong>
                {index < journeyPreviewStops.length - 1 ? <small aria-hidden="true">↓</small> : null}
              </div>
            ))}
          </div>
          {journeySummaryItems.length ? <p>{journeySummaryItems.join(" • ")}</p> : null}
        </div>
      </div>

      <div className="wr-stroll-detail-map-section" data-testid="stroll-map-section">
        <div className="wr-stroll-detail-section-heading">
          <span>Map</span>
        </div>
        <div
          ref={journeyMapRef}
          className="wr-stroll-detail-map-wrap"
          data-journey-phase={journeyPhase}
          data-testid="stroll-journey-map"
          onClick={handleJourneyInteraction}
          onTouchStart={handleJourneyInteraction}
          onWheel={handleJourneyInteraction}
        >
        {!fallbackReason ? (
          <GoogleMap
            mapContainerClassName="wr-stroll-detail-google-map"
            center={mapCenter}
            zoom={14}
            onLoad={(map) => {
              googleMapRef.current = map;
              setIsMapInstanceReady(true);
              setIsCameraFitComplete(false);
              setAreMapOverlaysReady(false);
            }}
            onUnmount={() => {
              googleMapRef.current = null;
              isProgrammaticCameraMoveRef.current = false;
              setIsMapInstanceReady(false);
              setIsCameraFitComplete(false);
              setAreMapOverlaysReady(false);
            }}
            onIdle={handleMapCameraIdle}
            options={{
              streetViewControl: false,
              mapTypeControl: false,
              fullscreenControl: false,
              gestureHandling: getStrollMapGestureHandling(Boolean(prefersReducedMotion)),
              styles: STROLL_MAP_STYLES,
            }}
            onDragStart={handleJourneyInteraction}
            onZoomChanged={handleMapZoomChanged}
          >
            {!prefersReducedMotion && motionEnabled && !motionFallbackReason && journeyPhase !== "completed" && journeyPhase !== "interrupted" && journeyPhase !== "handoff" ? (
              <>
                {journeyFootprints.map((footprint) => (
                  <OverlayViewF
                    key={footprint.id}
                    position={footprint.point}
                    mapPaneName={OVERLAY_MOUSE_TARGET}
                    getPixelPositionOffset={(width, height) => ({ x: Math.round(-width / 2), y: Math.round(-(height + 10)) })}
                  >
                    <div
                      className={`wr-stroll-footprint ${footprint.side}`}
                      data-testid="stroll-journey-footprint"
                      style={{
                        opacity: footprint.opacity,
                        transform: `translate(-50%, -50%) rotate(${footprint.rotation}deg) scale(${footprint.scale})`,
                      } as CSSProperties}
                    />
                  </OverlayViewF>
                ))}
              </>
            ) : null}
            {revealedRoutePath.length > 1 ? (
              <PolylineF
                path={revealedRoutePath}
                options={{
                  strokeColor: hasRouteData ? "#0f766e" : "#102a57",
                  strokeOpacity: Math.max(0.24, Math.min(0.92, 0.18 + journeyRevealProgress * 0.74)),
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
                  scale: journeyPhase === "current-location-pulse" ? 10 : 8,
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
                onClick={() => handleOpenStopDetails(stop.id)}
                icon={{
                  path: window.google.maps.SymbolPath.CIRCLE,
                  scale: selectedStopId === stop.id ? 13 : wakeupStopId === stop.id ? 13.5 : 11,
                  fillColor: wakeupStopId === stop.id ? "#f59e0b" : selectedStopId === stop.id ? "#c2410c" : "#102a57",
                  fillOpacity: 1,
                  strokeColor: "#ffffff",
                  strokeWeight: 3,
                }}
              />
            ))}
          </GoogleMap>
        ) : (
          <div className="wr-stroll-detail-map-fallback" role="status" aria-live="polite">
            <MapPin size={20} />
            <strong>Map preview unavailable</strong>
            <span>
              {fallbackReason === "loading"
                ? "Loading the map..."
                : fallbackReason === "missing_coordinates"
                  ? "Stops without stored coordinates still appear in the keyboard-accessible ordered list below."
                  : "Use the keyboard-accessible ordered stop list and Directions links below."}
            </span>
          </div>
        )}
        </div>
      </div>

      <div className="wr-stroll-detail-why-card" aria-label="Why this journey">
        <span>Why this journey</span>
        <p>{whyThisJourney}</p>
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

      {orderedStops.length > 1 ? (
        <div className="wr-stroll-detail-list" aria-label="Remaining Stroll stops. Select a stop to open details.">
          <div className="wr-stroll-detail-section-heading">
            <span>Remaining stops</span>
          </div>
          {orderedStops.slice(1).map((stop, index) => {
            const stopNumber = index + 2;
            const isSelected = selectedStopId === stop.id;
            return (
              <button
                type="button"
                key={stop.id}
                className={`wr-stroll-detail-stop-row ${isSelected ? "is-selected" : ""}`}
                aria-pressed={isSelected}
                aria-label={`Open details for stop ${stopNumber}: ${getStopTitle(stop)}`}
                onClick={() => handleOpenStopDetails(stop.id)}
              >
                <span>{stopNumber}</span>
                <div>
                  <strong>{getStopTitle(stop)}</strong>
                  <small>{buildStopRowSupportingText(stop, stopNumber - 1)}</small>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}

      {openStop ? (
        <StrollStopSheet
          stop={openStop}
          stopNumber={selectedStopNumber}
          onClose={() => setOpenStopId(null)}
        />
      ) : null}
    </section>
  );
}
