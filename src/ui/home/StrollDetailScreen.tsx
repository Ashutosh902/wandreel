import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, ChevronRight, Map, MapPin, Navigation, Play, SkipForward, X } from "lucide-react";
import { GoogleMap, MarkerF, OverlayViewF, PolylineF, useJsApiLoader, OVERLAY_MOUSE_TARGET } from "@react-google-maps/api";
import { useReducedMotion } from "framer-motion";
import { useUx } from "../layout/UxProvider";
import {
  buildFirstStopDescription,
  buildInitialStrollJourneyProgress,
  buildJourneyWhyItems,
  buildStrollHeaderMeta,
  buildStrollHeaderTitle,
  buildStrollJourneyStorageKey,
  EMPTY_STROLL_JOURNEY_PROGRESS,
  buildStrollStopDirectionsUrl,
  buildJourneySummaryItems,
  buildWhyThisJourney,
  completeActiveStrollStop,
  formatDisplayVenueName,
  formatRouteDistance,
  formatRouteDuration,
  formatStopDuration,
  getActiveStrollStop,
  getNumberedMapStops,
  getOrderedStrollStops,
  getStrollMapFallbackReason,
  getStrollMapGestureHandling,
  getStrollProgressLabel,
  getStrollRoutePath,
  getStrollStopStatus,
  hasStoredRouteData,
  hasValidReelUrl,
  markStrollStopArrived,
  normalizeStrollJourneyProgress,
  selectStopById,
  skipActiveStrollStop,
  startStrollJourney,
  type StrollDetailLoadState,
  type StrollJourneyProgress,
  type StrollStopStatus,
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
  userId?: string | null;
  onBack: () => void;
  allowInitialJourneyMotionStart?: boolean;
};

type StrollDetailAnalyticsEvent =
  | "stroll_detail_viewed"
  | "stroll_started"
  | "map_marker_selected"
  | "progress_node_selected"
  | "itinerary_stop_selected"
  | "full_route_opened"
  | "navigation_opened"
  | "stop_marked_arrived"
  | "stop_completed"
  | "stop_skipped"
  | "weather_details_opened"
  | "route_adaptation_reviewed"
  | "route_adaptation_accepted"
  | "route_adaptation_rejected"
  | "route_details_opened"
  | "stroll_completed";

type RoutePreviewStop = ReturnType<typeof getNumberedMapStops>[number];

function logStrollDetailEvent(event: StrollDetailAnalyticsEvent, details: Record<string, unknown>) {
  console.info("[stroll-detail]", {
    event,
    source: "StrollDetailScreen",
    ...details,
  });
}

function getStopTitle(stop: PersistentStrollStop) {
  return formatDisplayVenueName(stop.placeTitle || stop.placeId || `Stop ${stop.sequence}`);
}

function getStopLocality(stop: PersistentStrollStop, stroll: PersistentStrollDetail | null) {
  return stop.placeLocality?.trim() || stop.placeAddress?.trim() || stroll?.city?.trim() || "Ready when you are";
}

function getStopDescription(stop: PersistentStrollStop | null) {
  if (!stop) return "Your Stroll is ready when you are.";
  return buildFirstStopDescription(stop);
}

function getCleanMetaItems(items: string[]) {
  return items.filter((item) => item.trim()).join(" • ");
}

function getStopCategoryChips(stop: PersistentStrollStop | null) {
  return [
    stop?.placeCategory?.trim() || null,
    stop?.suitability.weather && stop.suitability.weather !== "unknown" ? stop.suitability.weather : null,
  ].filter(Boolean).slice(0, 2) as string[];
}

function getMarkerColor(status: StrollStopStatus, isSelected: boolean, isWakeup: boolean) {
  if (isWakeup || status === "active" || status === "arrived") return "#c2410c";
  if (isSelected) return "#102a57";
  if (status === "completed") return "#0f766e";
  if (status === "skipped") return "#94a3b8";
  return "#102a57";
}

function getStopStatusLabel(status: StrollStopStatus) {
  if (status === "active") return "Current";
  if (status === "arrived") return "You're here";
  if (status === "completed") return "Visited";
  if (status === "skipped") return "Skipped";
  return "Upcoming";
}

function readStoredJourneyProgress(storageKey: string, stops: PersistentStrollStop[]) {
  if (typeof window === "undefined") return buildInitialStrollJourneyProgress(stops);
  try {
    const raw = window.localStorage.getItem(storageKey);
    return normalizeStrollJourneyProgress(raw ? JSON.parse(raw) as Partial<StrollJourneyProgress> : null, stops);
  } catch {
    return buildInitialStrollJourneyProgress(stops);
  }
}

function writeStoredJourneyProgress(storageKey: string, progress: StrollJourneyProgress) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(progress));
  } catch {
    // Local progress is a safe fallback only; losing it must not break the Stroll.
  }
}

function buildStrollRouteDirectionsUrl(stops: PersistentStrollStop[], currentCoords?: { lat: number; lng: number } | null) {
  const mappedStops = getNumberedMapStops(stops);
  if (mappedStops.length === 0) return null;
  if (mappedStops.length === 1) return buildStrollStopDirectionsUrl(mappedStops[0]);
  const origin = currentCoords
    ? `${currentCoords.lat},${currentCoords.lng}`
    : `${mappedStops[0].lat},${mappedStops[0].lng}`;
  const destination = mappedStops[mappedStops.length - 1];
  const waypoints = mappedStops.slice(currentCoords ? 0 : 1, -1);
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", `${destination.lat},${destination.lng}`);
  if (waypoints.length) {
    url.searchParams.set("waypoints", waypoints.map((stop) => `${stop.lat},${stop.lng}`).join("|"));
  }
  return url.toString();
}

function StrollStopSheet({
  stop,
  stopNumber,
  status,
  isActive,
  onClose,
  onNavigate,
  onArrived,
  onComplete,
  onSkip,
}: {
  stop: PersistentStrollStop;
  stopNumber: number;
  status: StrollStopStatus;
  isActive: boolean;
  onClose: () => void;
  onNavigate: () => void;
  onArrived: () => void;
  onComplete: () => void;
  onSkip: () => void;
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
        <span className="wr-stroll-detail-stop-kicker">Stop {stopNumber} · {status}</span>
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
          {isActive && status !== "arrived" && status !== "completed" ? (
            <button type="button" className="wr-stroll-detail-action is-primary" onClick={onNavigate}>
              <Navigation size={14} />
              Navigate
            </button>
          ) : null}
          {isActive && status === "active" ? (
            <button type="button" className="wr-stroll-detail-action" onClick={onArrived}>I&apos;m here</button>
          ) : null}
          {isActive && status === "arrived" ? (
            <button type="button" className="wr-stroll-detail-action is-primary" onClick={onComplete}>Mark visited</button>
          ) : null}
          {isActive && (status === "active" || status === "arrived") ? (
            <button type="button" className="wr-stroll-detail-action" onClick={onSkip}>Skip stop</button>
          ) : null}
          {!isActive && directionsUrl ? (
            <a href={directionsUrl} target="_blank" rel="noreferrer" className="wr-stroll-detail-action">
              <Navigation size={14} />
              View on map
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

function StrollSkipConfirmSheet({
  stopTitle,
  onConfirm,
  onCancel,
}: {
  stopTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLElement>(true, onCancel);
  return (
    <div className="wr-stroll-detail-sheet-layer" role="presentation">
      <article
        ref={dialogRef}
        className="wr-stroll-detail-sheet wr-stroll-skip-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wr-stroll-skip-title"
        aria-describedby="wr-stroll-skip-description"
        tabIndex={-1}
      >
        <button type="button" className="wr-stroll-detail-sheet-close" aria-label="Cancel skip" onClick={onCancel}>
          <X size={16} />
        </button>
        <span className="wr-stroll-detail-stop-kicker">Skip stop</span>
        <h3 id="wr-stroll-skip-title">Skip {stopTitle}?</h3>
        <p id="wr-stroll-skip-description">
          This stop will stay in your Stroll, but Wandreel will move you to the next stop for this journey.
        </p>
        <div className="wr-stroll-detail-sheet-actions">
          <button type="button" className="wr-stroll-detail-action is-primary" onClick={onConfirm}>Skip this stop</button>
          <button type="button" className="wr-stroll-detail-action" onClick={onCancel}>Cancel</button>
        </div>
      </article>
    </div>
  );
}

function StrollStartNavigateConfirmSheet({
  stopTitle,
  onConfirm,
  onCancel,
}: {
  stopTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLElement>(true, onCancel);
  return (
    <div className="wr-stroll-detail-sheet-layer" role="presentation">
      <article
        ref={dialogRef}
        className="wr-stroll-detail-sheet wr-stroll-skip-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wr-stroll-start-nav-title"
        aria-describedby="wr-stroll-start-nav-description"
        tabIndex={-1}
      >
        <button type="button" className="wr-stroll-detail-sheet-close" aria-label="Cancel navigation" onClick={onCancel}>
          <X size={16} />
        </button>
        <span className="wr-stroll-detail-stop-kicker">Start navigation</span>
        <h3 id="wr-stroll-start-nav-title">Start Stroll and navigate?</h3>
        <p id="wr-stroll-start-nav-description">
          Wandreel will mark {stopTitle} as your current stop, then open directions. You can still mark arrival or completion yourself.
        </p>
        <div className="wr-stroll-detail-sheet-actions">
          <button type="button" className="wr-stroll-detail-action is-primary" onClick={onConfirm}>Start Stroll and navigate</button>
          <button type="button" className="wr-stroll-detail-action" onClick={onCancel}>Cancel</button>
        </div>
      </article>
    </div>
  );
}

function StrollRoutePreviewSheet({
  stops,
  summary,
  routeUrl,
  onClose,
  onNavigate,
}: {
  stops: RoutePreviewStop[];
  summary: string;
  routeUrl: string | null;
  onClose: () => void;
  onNavigate: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);
  return (
    <div className="wr-stroll-detail-sheet-layer" role="presentation">
      <article
        ref={dialogRef}
        className="wr-stroll-detail-sheet wr-stroll-route-preview-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wr-stroll-route-preview-title"
        aria-describedby="wr-stroll-route-preview-description"
        tabIndex={-1}
      >
        <button type="button" className="wr-stroll-detail-sheet-close" aria-label="Close route preview" onClick={onClose}>
          <X size={16} />
        </button>
        <span className="wr-stroll-detail-stop-kicker">Your route</span>
        <h3 id="wr-stroll-route-preview-title">Full route preview</h3>
        <p id="wr-stroll-route-preview-description">
          {summary || "Review every stop in today's Stroll before you head out."}
        </p>
        <div className="wr-stroll-route-preview-list" role="list">
          {stops.map((stop) => (
            <div className="wr-stroll-route-preview-row" role="listitem" key={stop.id}>
              <span>{stop.markerNumber}</span>
              <strong>{getStopTitle(stop)}</strong>
            </div>
          ))}
        </div>
        <div className="wr-stroll-detail-sheet-actions">
          <button type="button" className="wr-stroll-detail-action is-primary" onClick={onNavigate}>
            <Navigation size={14} />
            Navigate
          </button>
          {routeUrl ? (
            <a href={routeUrl} target="_blank" rel="noreferrer" className="wr-stroll-detail-action">
              <Map size={14} />
              Open in Maps
            </a>
          ) : null}
        </div>
      </article>
    </div>
  );
}

function StickyJourneyAction({
  context,
  label,
  isArrived,
  onClick,
}: {
  context: string;
  label: string;
  isArrived: boolean;
  onClick: () => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="wr-stroll-sticky-action" aria-label="Next journey action">
      <span>{context}</span>
      <button type="button" onClick={onClick}>
        {!isArrived ? <Navigation size={15} /> : null}
        {label}
      </button>
    </div>,
    document.body,
  );
}

export function StrollDetailScreen({
  strollId,
  userId = null,
  onBack,
  allowInitialJourneyMotionStart = true,
}: StrollDetailScreenProps) {
  const prefersReducedMotion = useReducedMotion();
  const { currentCoords, isLocating, requestCurrentLocation, showToast } = useUx();
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
  const [isSkipConfirmOpen, setIsSkipConfirmOpen] = useState(false);
  const [isStartNavigateConfirmOpen, setIsStartNavigateConfirmOpen] = useState(false);
  const [isRoutePreviewOpen, setIsRoutePreviewOpen] = useState(false);
  const [journeyProgress, setJourneyProgress] = useState<StrollJourneyProgress>(EMPTY_STROLL_JOURNEY_PROGRESS);
  const [announceMessage, setAnnounceMessage] = useState("");
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
  const viewedStrollIdRef = useRef<string | null>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const timelineRowRefs = useRef(new globalThis.Map<string, HTMLButtonElement>());
  const isProgrammaticCameraMoveRef = useRef(false);
  const overlayReadinessFrameRef = useRef<number | null>(null);
  const googleMapsApiKey = String(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || import.meta.env.VITE_GOOGLE_PLACES_API_KEY || "",
  ).trim();
  const journeyStorageKey = useMemo(() => buildStrollJourneyStorageKey(userId, strollId), [strollId, userId]);
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
          const nextStops = getOrderedStrollStops(nextStroll);
          const storedProgress = readStoredJourneyProgress(journeyStorageKey, nextStops);
          setStroll(nextStroll);
          setJourneyProgress(storedProgress);
          setSelectedStopId(storedProgress.activeStopId ?? nextStops[0]?.id ?? null);
          setOpenStopId(null);
          setIsRoutePreviewOpen(false);
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
  }, [journeyStorageKey, strollId]);

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
        const nextStops = getOrderedStrollStops(updatedStroll);
        const nextFirstStopId = nextStops[0]?.id ?? null;
        setStroll(updatedStroll);
        setJourneyProgress((current) => {
          const nextProgress = normalizeStrollJourneyProgress({
            ...current,
            activeStopId: current.journeyState === "not_started" ? nextFirstStopId : current.activeStopId,
            arrivedStopId: current.journeyState === "not_started" ? null : current.arrivedStopId,
          }, nextStops);
          writeStoredJourneyProgress(journeyStorageKey, nextProgress);
          return nextProgress;
        });
        setSelectedStopId(nextFirstStopId);
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
  const selectedStop = useMemo(() => selectStopById(orderedStops, selectedStopId), [orderedStops, selectedStopId]);
  const activeStop = useMemo(() => getActiveStrollStop(orderedStops, journeyProgress), [journeyProgress, orderedStops]);
  const selectedStopNumber = openStop
    ? orderedStops.findIndex((stop) => stop.id === openStop.id) + 1
    : 0;
  const headerTitle = useMemo(() => buildStrollHeaderTitle(stroll), [stroll]);
  const headerMeta = useMemo(() => buildStrollHeaderMeta(stroll), [stroll]);
  const journeySummaryItems = useMemo(() => buildJourneySummaryItems(stroll), [stroll]);
  const routeSummaryItems = useMemo(() => {
    const items = [...journeySummaryItems];
    const totalMinutes = orderedStops.reduce((sum, stop) => (
      sum + (stop.routeDurationMinutes || 0) + (stop.estimatedVisitDurationMinutes || 0)
    ), 0);
    const duration = totalMinutes > 0 ? formatRouteDuration(totalMinutes) : null;
    if (duration) items.push(`Approx. ${duration}`);
    return items;
  }, [journeySummaryItems, orderedStops]);
  const whyItems = useMemo(() => buildJourneyWhyItems(stroll), [stroll]);
  const whyThisJourney = useMemo(() => buildWhyThisJourney(stroll), [stroll]);
  const progressLabel = useMemo(() => getStrollProgressLabel(journeyProgress, orderedStops), [journeyProgress, orderedStops]);
  const routeDirectionsUrl = useMemo(() => buildStrollRouteDirectionsUrl(orderedStops, currentCoords), [currentCoords, orderedStops]);
  const selectedStopIsActive = Boolean(selectedStop && activeStop && selectedStop.id === activeStop.id);
  const shouldShowReturnToCurrent = Boolean(selectedStop && activeStop && !selectedStopIsActive && journeyProgress.journeyState !== "completed");
  const heroStatus = journeyProgress.journeyState === "completed"
    ? "Complete"
    : journeyProgress.arrivedStopId
      ? "You're here"
      : journeyProgress.journeyState === "active"
        ? "Current stop"
        : "First stop";
  const heroTitle = journeyProgress.journeyState === "completed"
    ? "Stroll complete"
    : `${journeyProgress.arrivedStopId ? "You're at " : journeyProgress.journeyState === "active" ? "Current stop: " : "Start at "}${activeStop ? getStopTitle(activeStop) : "your first stop"}`;
  const heroLocality = activeStop ? getStopLocality(activeStop, stroll) : stroll?.city ?? "";
  const heroDescription = journeyProgress.journeyState === "completed"
    ? `${orderedStops.length} stops wrapped. Your route is still here whenever you want to revisit it.`
    : getStopDescription(activeStop);
  const activeDirectionsUrl = activeStop ? buildStrollStopDirectionsUrl(activeStop) : null;
  const getStopAnalytics = (stopId: string | null) => {
    const stop = selectStopById(orderedStops, stopId);
    const index = stop ? orderedStops.findIndex((candidate) => candidate.id === stop.id) : -1;
    return {
      strollId,
      stopId,
      stopNumber: index >= 0 ? index + 1 : null,
      stopTitle: stop ? getStopTitle(stop) : null,
      journeyState: journeyProgress.journeyState,
      activeStopId: journeyProgress.activeStopId,
    };
  };
  const openStopDetails = (stopId: string) => {
    setSelectedStopId(stopId);
    setOpenStopId(stopId);
  };
  const scrollTimelineStopIntoView = (stopId: string | null) => {
    if (!stopId || typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      timelineRowRefs.current.get(stopId)?.scrollIntoView({ block: "center", behavior: prefersReducedMotion ? "auto" : "smooth" });
    });
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
    if (loadState !== "ready" || !orderedStops.length) return;
    if (viewedStrollIdRef.current !== strollId) {
      viewedStrollIdRef.current = strollId;
      logStrollDetailEvent("stroll_detail_viewed", {
        strollId,
        city: stroll?.city ?? null,
        stopCount: orderedStops.length,
        journeyState: journeyProgress.journeyState,
      });
    }
    const normalized = normalizeStrollJourneyProgress(journeyProgress, orderedStops);
    if (JSON.stringify(normalized) !== JSON.stringify(journeyProgress)) {
      setJourneyProgress(normalized);
      return;
    }
    writeStoredJourneyProgress(journeyStorageKey, normalized);
  }, [journeyProgress, journeyStorageKey, loadState, orderedStops, stroll?.city, strollId]);

  useEffect(() => {
    if (!selectedStop || !googleMapRef.current || !window.google?.maps || isRoutePreviewOpen) return;
    if (typeof selectedStop.latitude !== "number" || typeof selectedStop.longitude !== "number") return;
    googleMapRef.current.panTo({ lat: selectedStop.latitude, lng: selectedStop.longitude });
  }, [isRoutePreviewOpen, selectedStop]);

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
  }, [currentCoords, mapStops]);

  if (loadState === "loading") {
    return (
      <section className="wr-stroll-detail-screen" aria-label="Loading Stroll">
        <header className="wr-stroll-detail-topbar">
          <button type="button" className="wr-map-back-btn" aria-label="Back" onClick={onBack}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <h2>Loading Stroll</h2>
            <p>Preparing your journey</p>
          </div>
        </header>
        <div className="wr-stroll-detail-loading" role="status" aria-live="polite">
          <div className="wr-stroll-skeleton hero" />
          <div className="wr-stroll-skeleton progress" />
          <div className="wr-stroll-skeleton map" />
          <div className="wr-stroll-skeleton row" />
          <div className="wr-stroll-skeleton row short" />
          <span className="wr-stroll-sr-status">Loading Stroll...</span>
        </div>
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
          <strong>We couldn&apos;t load this Stroll</strong>
          <span>{error || "It may have been removed or you may not have access."}</span>
          <div className="wr-stroll-state-actions">
            <button type="button" onClick={() => window.location.reload()}>Try again</button>
            <button type="button" onClick={onBack}>Back to Strolls</button>
          </div>
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
  const updateJourneyProgress = (updater: (current: StrollJourneyProgress) => StrollJourneyProgress, announcement?: string) => {
    setJourneyProgress((current) => {
      const nextProgress = updater(current);
      writeStoredJourneyProgress(journeyStorageKey, nextProgress);
      return nextProgress;
    });
    if (announcement) setAnnounceMessage(announcement);
  };
  const handleStartStroll = () => {
    const nextStop = activeStop ?? orderedStops[0] ?? null;
    logStrollDetailEvent("stroll_started", getStopAnalytics(nextStop?.id ?? null));
    updateJourneyProgress(
      (current) => startStrollJourney(current, orderedStops),
      nextStop ? `${getStopTitle(nextStop)} is now your current stop.` : "Your Stroll has started.",
    );
    if (nextStop) setSelectedStopId(nextStop.id);
  };
  const handleArrived = () => {
    if (!activeStop) return;
    logStrollDetailEvent("stop_marked_arrived", getStopAnalytics(activeStop.id));
    updateJourneyProgress(
      (current) => markStrollStopArrived(current, orderedStops),
      `You're at ${getStopTitle(activeStop)}.`,
    );
  };
  const handleCompleteStop = () => {
    if (!activeStop) return;
    const completedTitle = getStopTitle(activeStop);
    const nextProgress = completeActiveStrollStop(journeyProgress, orderedStops);
    const nextStop = selectStopById(orderedStops, nextProgress.activeStopId);
    logStrollDetailEvent("stop_completed", {
      ...getStopAnalytics(activeStop.id),
      nextStopId: nextStop?.id ?? null,
      nextStopTitle: nextStop ? getStopTitle(nextStop) : null,
    });
    if (!nextStop) {
      logStrollDetailEvent("stroll_completed", {
        strollId,
        stopCount: orderedStops.length,
        completedCount: nextProgress.completedStopIds.length,
        skippedCount: nextProgress.skippedStopIds.length,
      });
    }
    updateJourneyProgress(
      () => nextProgress,
      nextStop ? `${completedTitle} marked visited. ${getStopTitle(nextStop)} is now your next stop.` : `${completedTitle} marked visited. Stroll complete.`,
    );
    setSelectedStopId(nextStop?.id ?? activeStop.id);
    scrollTimelineStopIntoView(nextStop?.id ?? activeStop.id);
  };
  const confirmSkipStop = () => {
    if (!activeStop) return;
    const skippedTitle = getStopTitle(activeStop);
    const nextProgress = skipActiveStrollStop(journeyProgress, orderedStops);
    const nextStop = selectStopById(orderedStops, nextProgress.activeStopId);
    logStrollDetailEvent("stop_skipped", {
      ...getStopAnalytics(activeStop.id),
      nextStopId: nextStop?.id ?? null,
      nextStopTitle: nextStop ? getStopTitle(nextStop) : null,
    });
    updateJourneyProgress(
      () => nextProgress,
      nextStop ? `${skippedTitle} skipped. ${getStopTitle(nextStop)} is now your next stop.` : `${skippedTitle} skipped. Stroll complete.`,
    );
    setSelectedStopId(nextStop?.id ?? activeStop.id);
    scrollTimelineStopIntoView(nextStop?.id ?? activeStop.id);
    setOpenStopId(null);
    setIsSkipConfirmOpen(false);
  };
  const handleSkipStop = () => {
    if (!activeStop) return;
    setIsSkipConfirmOpen(true);
  };
  const openActiveStopNavigation = () => {
    if (!activeStop) return;
    logStrollDetailEvent("navigation_opened", getStopAnalytics(activeStop.id));
    const url = buildStrollStopDirectionsUrl(activeStop);
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };
  const confirmStartAndNavigate = () => {
    if (!activeStop) return;
    const startedProgress = startStrollJourney(journeyProgress, orderedStops);
    updateJourneyProgress(() => startedProgress, `${getStopTitle(activeStop)} is now your current stop.`);
    setSelectedStopId(activeStop.id);
    scrollTimelineStopIntoView(activeStop.id);
    setIsStartNavigateConfirmOpen(false);
    openActiveStopNavigation();
  };
  const handleNavigate = () => {
    if (!activeStop) return;
    if (journeyProgress.journeyState === "not_started") {
      setIsStartNavigateConfirmOpen(true);
      return;
    }
    openActiveStopNavigation();
  };
  const handleViewRoute = () => {
    logStrollDetailEvent("full_route_opened", {
      strollId,
      stopCount: orderedStops.length,
      hasRouteDirectionsUrl: Boolean(routeDirectionsUrl),
    });
    setIsRoutePreviewOpen(true);
    setOpenStopId(null);
    if (mapStops.length && googleMapRef.current && window.google?.maps) {
      const bounds = new window.google.maps.LatLngBounds();
      for (const stop of mapStops) {
        bounds.extend({ lat: stop.lat, lng: stop.lng });
      }
      if (currentCoords) bounds.extend(currentCoords);
      isProgrammaticCameraMoveRef.current = true;
      setIsCameraFitComplete(false);
      googleMapRef.current.fitBounds(bounds, 56);
    }
  };
  const handleEnableLocation = async () => {
    const result = await requestCurrentLocation();
    if (!result.ok) {
      const message = result.reason === "permission_denied"
        ? "Location permission is off. You can still use this Stroll."
        : "Location is unavailable right now. You can still use this Stroll.";
      showToast({ message, variant: "info" });
    }
  };
  const returnToCurrentStop = () => {
    if (!activeStop) return;
    setSelectedStopId(activeStop.id);
    scrollTimelineStopIntoView(activeStop.id);
  };
  const stickyActionLabel = journeyProgress.arrivedStopId
    ? "Mark visited"
    : "Navigate";
  const stickyContext = `${journeyProgress.arrivedStopId ? "At" : "Next"}: ${activeStop ? getStopTitle(activeStop) : "your first stop"}`;
  const shouldShowStickyAction = journeyProgress.journeyState !== "completed" && !openStop && !isSkipConfirmOpen && !isStartNavigateConfirmOpen && !isRoutePreviewOpen;
  const handleStickyAction = journeyProgress.arrivedStopId ? handleCompleteStop : handleNavigate;
  return (
    <section
      className={`wr-stroll-detail-screen ${prefersReducedMotion ? "is-reduced-motion" : ""} ${shouldShowStickyAction ? "has-sticky-action" : ""}`}
      aria-label={`${stroll.name} Stroll`}
    >
      <div className="wr-stroll-sr-status" aria-live="polite">{announceMessage}</div>
      <header className="wr-stroll-detail-topbar">
        <button type="button" className="wr-map-back-btn" aria-label="Back" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2>{headerTitle}</h2>
          <p>{headerMeta || progressLabel}</p>
        </div>
      </header>

      <div className="wr-stroll-detail-first-view" data-testid="stroll-first-view">
        <article
          className={`wr-stroll-detail-hero-card is-${journeyProgress.journeyState}`}
          aria-label="Current stop hero"
        >
          <div
            className="wr-stroll-current-surface"
            role={activeStop ? "button" : undefined}
            tabIndex={activeStop ? 0 : undefined}
            aria-label={activeStop ? `Open details for ${getStopTitle(activeStop)}` : undefined}
            onClick={() => {
              if (!activeStop) return;
              logStrollDetailEvent("itinerary_stop_selected", getStopAnalytics(activeStop.id));
              handleOpenStopDetails(activeStop.id);
            }}
            onKeyDown={(event) => {
              if (!activeStop) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                logStrollDetailEvent("itinerary_stop_selected", getStopAnalytics(activeStop.id));
                handleOpenStopDetails(activeStop.id);
              }
            }}
          >
            <div className="wr-stroll-current-icon" aria-hidden="true">
              {journeyProgress.journeyState === "completed" ? <Check size={26} /> : <MapPin size={26} />}
            </div>
            <div className="wr-stroll-current-copy">
              <span>{heroStatus}</span>
              <h1 data-testid="stroll-first-stop-title">{heroTitle}</h1>
              {heroLocality ? <p className="wr-stroll-current-locality">{heroLocality}</p> : null}
              {getStopCategoryChips(activeStop).length ? (
                <div className="wr-stroll-current-chips" aria-label="Stop categories">
                  {getStopCategoryChips(activeStop).map((chip) => <small key={chip}>{chip}</small>)}
                </div>
              ) : null}
              <p>{heroDescription}</p>
            </div>
          </div>
          {journeyProgress.journeyState !== "completed" ? (
            <div className="wr-stroll-current-actions">
              {journeyProgress.journeyState === "not_started" ? (
                <button type="button" className="wr-stroll-detail-begin-btn" onClick={handleStartStroll}>
                  Start Stroll
                </button>
              ) : journeyProgress.arrivedStopId ? (
                <button type="button" className="wr-stroll-detail-begin-btn" onClick={handleCompleteStop}>
                  Mark as visited
                </button>
              ) : (
                <button type="button" className="wr-stroll-detail-begin-btn" onClick={handleNavigate} disabled={!activeDirectionsUrl}>
                  Navigate
                </button>
              )}
              <div className="wr-stroll-current-links">
                {journeyProgress.journeyState === "active" && !journeyProgress.arrivedStopId ? (
                  <button type="button" onClick={handleArrived}>I&apos;m here</button>
                ) : null}
                {journeyProgress.arrivedStopId ? (
                  <button type="button" onClick={handleSkipStop}>
                    <SkipForward size={13} />
                    Skip stop
                  </button>
                ) : null}
                {activeDirectionsUrl ? (
                  <a
                    href={activeDirectionsUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => activeStop ? logStrollDetailEvent("navigation_opened", getStopAnalytics(activeStop.id)) : undefined}
                  >
                    Open in Maps
                  </a>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="wr-stroll-current-actions">
              <button
                type="button"
                className="wr-stroll-detail-begin-btn"
                onClick={() => {
                  logStrollDetailEvent("full_route_opened", {
                    strollId,
                    stopCount: orderedStops.length,
                    hasRouteDirectionsUrl: Boolean(routeDirectionsUrl),
                    journeyState: journeyProgress.journeyState,
                  });
                  if (routeDirectionsUrl) {
                    window.open(routeDirectionsUrl, "_blank", "noopener,noreferrer");
                  }
                }}
                disabled={!routeDirectionsUrl}
              >
                View completed route
              </button>
              <button type="button" className="wr-stroll-detail-complete-secondary" onClick={onBack}>Return to Strolls</button>
            </div>
          )}
        </article>

        <div className="wr-stroll-progress-card" aria-label="Journey progress">
          <strong>{progressLabel}</strong>
          <div className="wr-stroll-progress-nodes" role="list">
            {orderedStops.map((stop, index) => {
              const status = getStrollStopStatus(journeyProgress, stop.id);
              const isSelected = selectedStopId === stop.id;
              return (
                <button
                  type="button"
                  key={stop.id}
                  className={`wr-stroll-progress-node is-${status} ${isSelected ? "is-selected" : ""}`}
                  aria-label={`Stop ${index + 1}, ${getStopTitle(stop)}, ${status}`}
                  aria-pressed={isSelected}
                  onClick={() => {
                    handleJourneyInteraction();
                    logStrollDetailEvent("progress_node_selected", getStopAnalytics(stop.id));
                    setSelectedStopId(stop.id);
                    scrollTimelineStopIntoView(stop.id);
                  }}
                >
                  {status === "completed" ? <Check size={13} /> : index + 1}
                </button>
              );
            })}
          </div>
          {shouldShowReturnToCurrent ? (
            <button type="button" className="wr-stroll-return-current" onClick={returnToCurrentStop}>
              Return to current stop
            </button>
          ) : null}
        </div>

      </div>
      <div className="wr-stroll-detail-map-section" data-testid="stroll-map-section">
        <div className="wr-stroll-detail-section-heading">
          <span>Your route</span>
          {routeSummaryItems.length ? <p className="wr-stroll-route-summary">{getCleanMetaItems(routeSummaryItems)}</p> : null}
          {journeySummaryItems.length ? <p>{journeySummaryItems.join(" • ")}</p> : null}
        </div>
        {!currentCoords ? (
          <div className="wr-stroll-location-note" role="note">
            <MapPin size={15} />
            <div>
              <strong>Location access is off</strong>
              <span>Enable it for distance and navigation estimates.</span>
            </div>
            <button type="button" onClick={() => void handleEnableLocation()} disabled={isLocating}>
              {isLocating ? "Locating..." : "Enable location"}
            </button>
          </div>
        ) : null}
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
                title="Your current location"
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
                title={`Stop ${stop.markerNumber}, ${getStopTitle(stop)}, ${getStrollStopStatus(journeyProgress, stop.id)}`}
                label={{ text: String(stop.markerNumber), color: "#ffffff", fontWeight: "900" }}
                onClick={() => {
                  logStrollDetailEvent("map_marker_selected", getStopAnalytics(stop.id));
                  scrollTimelineStopIntoView(stop.id);
                  handleOpenStopDetails(stop.id);
                }}
                icon={{
                  path: window.google.maps.SymbolPath.CIRCLE,
                  scale: selectedStopId === stop.id ? 13 : wakeupStopId === stop.id || getStrollStopStatus(journeyProgress, stop.id) === "active" ? 13.5 : 11,
                  fillColor: getMarkerColor(getStrollStopStatus(journeyProgress, stop.id), selectedStopId === stop.id, wakeupStopId === stop.id),
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
        <div className="wr-stroll-map-actions">
          <button
            type="button"
            className="wr-stroll-map-secondary"
            onClick={handleViewRoute}
          >
            <Map size={15} />
            View route
          </button>
          <button type="button" className="wr-stroll-map-primary" onClick={handleNavigate} disabled={!activeDirectionsUrl || journeyProgress.journeyState === "completed"}>
            <Navigation size={15} />
            Navigate
          </button>
        </div>
      </div>

      <div className="wr-stroll-timeline-card" aria-label="Today's Stroll. Select a stop to preview details.">
        <div className="wr-stroll-detail-section-heading">
          <span>Today&apos;s Stroll</span>
        </div>
        <div className="wr-stroll-timeline-list">
          {orderedStops.map((stop, index) => {
            const stopNumber = index + 1;
            const isSelected = selectedStopId === stop.id;
            const status = getStrollStopStatus(journeyProgress, stop.id);
            const duration = formatStopDuration(stop.estimatedVisitDurationMinutes);
            const transfer = formatRouteDistance(stop.routeDistanceMeters);
            return (
              <button
                type="button"
                key={stop.id}
                ref={(element) => {
                  if (element) {
                    timelineRowRefs.current.set(stop.id, element);
                  } else {
                    timelineRowRefs.current.delete(stop.id);
                  }
                }}
                className={`wr-stroll-timeline-row is-${status} ${isSelected ? "is-selected" : ""}`}
                aria-pressed={isSelected}
                aria-label={`Open details for stop ${stopNumber}: ${getStopTitle(stop)}, ${status}`}
                onClick={() => {
                  logStrollDetailEvent("itinerary_stop_selected", getStopAnalytics(stop.id));
                  handleOpenStopDetails(stop.id);
                }}
              >
                <span className="wr-stroll-timeline-number">{status === "completed" ? <Check size={13} /> : stopNumber}</span>
                <div className="wr-stroll-timeline-main">
                  <strong>{getStopTitle(stop)}</strong>
                  <small>{getStopLocality(stop, stroll)}</small>
                  <span className="wr-stroll-timeline-badges">
                    <em className="wr-stroll-timeline-status">{getStopStatusLabel(status)}</em>
                    {stop.placeCategory ? <em>{stop.placeCategory}</em> : null}
                  </span>
                </div>
                <div className="wr-stroll-timeline-meta">
                  {stop.arrivalEstimate ? <small>{stop.arrivalEstimate}</small> : null}
                  {duration ? <small>{duration}</small> : null}
                  {transfer ? <small>{transfer}</small> : null}
                </div>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>

      <StrollLiveConditionsPanel
        loadState={liveLoadState}
        live={liveConditions}
        error={liveError}
        onDetailsOpen={() => logStrollDetailEvent("weather_details_opened", {
          strollId,
          status: liveConditions?.status ?? liveLoadState,
          conditionCount: liveConditions?.conditions.length ?? 0,
        })}
      />

      <div className="wr-stroll-detail-why-card" aria-label="Why we picked this route">
        <span>Why we picked this route</span>
        {whyItems.length ? (
          <div className="wr-stroll-why-grid">
            {whyItems.map((item, index) => (
              <div className="wr-stroll-why-item" key={item}>
                <span aria-hidden="true">{index + 1}</span>
                <p>{item}</p>
              </div>
            ))}
          </div>
        ) : (
          <p>{whyThisJourney}</p>
        )}
      </div>

      <StrollAdaptationPanel
        loadState={adaptationLoadState}
        recommendation={adaptationRecommendation}
        error={adaptationError}
        dismissed={isAdaptationDismissed}
        accepting={isAcceptingAdaptation}
        onAccept={(stopIds) => {
          logStrollDetailEvent("route_adaptation_accepted", {
            strollId,
            proposedStopCount: stopIds.length,
            recommendationStatus: adaptationRecommendation?.status ?? null,
          });
          acceptAdaptation(stopIds);
        }}
        onDismiss={() => {
          logStrollDetailEvent("route_adaptation_rejected", {
            strollId,
            recommendationStatus: adaptationRecommendation?.status ?? null,
          });
          setIsAdaptationDismissed(true);
        }}
        onDetailsOpen={(recommendation) => {
          logStrollDetailEvent("route_details_opened", {
            strollId,
            recommendationStatus: recommendation.status,
            confidence: recommendation.confidence,
          });
          if (recommendation.status === "recommended") {
            logStrollDetailEvent("route_adaptation_reviewed", {
              strollId,
              proposedStopCount: recommendation.proposedStopIds.length,
              confidence: recommendation.confidence,
            });
          }
        }}
      />

      {shouldShowStickyAction ? (
        <StickyJourneyAction
          context={stickyContext}
          label={stickyActionLabel}
          isArrived={Boolean(journeyProgress.arrivedStopId)}
          onClick={handleStickyAction}
        />
      ) : null}

      {isRoutePreviewOpen ? (
        <StrollRoutePreviewSheet
          stops={mapStops}
          summary={getCleanMetaItems(routeSummaryItems)}
          routeUrl={routeDirectionsUrl}
          onClose={() => setIsRoutePreviewOpen(false)}
          onNavigate={() => {
            setIsRoutePreviewOpen(false);
            handleNavigate();
          }}
        />
      ) : null}

      {openStop ? (
        <StrollStopSheet
          stop={openStop}
          stopNumber={selectedStopNumber}
          status={getStrollStopStatus(journeyProgress, openStop.id)}
          isActive={activeStop?.id === openStop.id}
          onClose={() => setOpenStopId(null)}
          onNavigate={handleNavigate}
          onArrived={handleArrived}
          onComplete={handleCompleteStop}
          onSkip={handleSkipStop}
        />
      ) : null}

      {isSkipConfirmOpen && activeStop ? (
        <StrollSkipConfirmSheet
          stopTitle={getStopTitle(activeStop)}
          onConfirm={confirmSkipStop}
          onCancel={() => setIsSkipConfirmOpen(false)}
        />
      ) : null}

      {isStartNavigateConfirmOpen && activeStop ? (
        <StrollStartNavigateConfirmSheet
          stopTitle={getStopTitle(activeStop)}
          onConfirm={confirmStartAndNavigate}
          onCancel={() => setIsStartNavigateConfirmOpen(false)}
        />
      ) : null}
    </section>
  );
}
