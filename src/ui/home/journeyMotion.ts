export type JourneyPhase = "idle" | "opening" | "current-location-pulse" | "walking" | "marker-wake" | "handoff" | "completed" | "interrupted";

export type JourneyPoint = { lat: number; lng: number };

export type JourneyFootprint = {
  id: string;
  point: JourneyPoint;
  side: "left" | "right";
  rotation: number;
  scale: number;
  opacity: number;
};

export type JourneyMotionTokens = {
  openingDuration: number;
  currentLocationPulseDuration: number;
  footstepInterval: number;
  cadenceVariation: number;
  strideSpacing: number;
  footprintOpacity: number;
  footprintScale: number;
  routeRevealDuration: number;
  markerWakeDuration: number;
  markerWakeScale: number;
  markerGlowIntensity: number;
  handoffFadeDuration: number;
  interruptionDuration: number;
  easing: [number, number, number, number];
};

export type JourneyMotionSnapshot = {
  phase: JourneyPhase;
  routeRevealProgress: number;
  activeFootprintIndex: number;
  wakeStopId: string | null;
};

export type JourneyRouteStep = {
  stopId: string;
  progress: number;
};

export const journeyMotionTokens: JourneyMotionTokens = {
  openingDuration: 180,
  currentLocationPulseDuration: 240,
  footstepInterval: 620,
  cadenceVariation: 36,
  strideSpacing: 36,
  footprintOpacity: 0.54,
  footprintScale: 0.84,
  routeRevealDuration: 1200,
  markerWakeDuration: 260,
  markerWakeScale: 1.12,
  markerGlowIntensity: 0.18,
  handoffFadeDuration: 320,
  interruptionDuration: 180,
  easing: [0.22, 1, 0.36, 1],
};

export function isJourneyMotionEnabled(explicitValue?: boolean) {
  if (typeof explicitValue === "boolean") return explicitValue;
  const configuredValue = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env?.VITE_ENABLE_JOURNEY_MOTION;
  if (typeof configuredValue === "string") {
    return !["false", "0", "off", "no"].includes(configuredValue.toLowerCase());
  }
  if (typeof configuredValue === "boolean") return configuredValue;
  return true;
}

export function getJourneyMotionFallbackReason({
  isEnabled,
  prefersReducedMotion,
  hasMapsKey,
  isMapLoaded,
  hasMapLoadError,
  routePointCount,
}: {
  isEnabled: boolean;
  prefersReducedMotion: boolean;
  hasMapsKey: boolean;
  isMapLoaded: boolean;
  hasMapLoadError: boolean;
  routePointCount: number;
}) {
  if (!isEnabled) return "feature_flag";
  if (prefersReducedMotion) return "reduced_motion";
  if (!hasMapsKey) return "missing_key";
  if (hasMapLoadError) return "map_error";
  if (!isMapLoaded) return "loading";
  if (routePointCount < 2) return "insufficient_route";
  return null;
}

export function shouldStartJourneyMotion({
  loadState,
  hasUserInteracted,
  hasStartedJourney,
  allowInitialMotionStart,
  prefersReducedMotion,
  isEnabled,
  fallbackReason,
  routePointCount,
}: {
  loadState: "loading" | "ready" | "error";
  hasUserInteracted: boolean;
  hasStartedJourney: boolean;
  allowInitialMotionStart: boolean;
  prefersReducedMotion: boolean;
  isEnabled: boolean;
  fallbackReason: string | null;
  routePointCount: number;
}) {
  return loadState === "ready" && allowInitialMotionStart && !hasUserInteracted && !hasStartedJourney && !prefersReducedMotion && isEnabled && !fallbackReason && routePointCount >= 2;
}

function interpolatePoint(start: JourneyPoint, end: JourneyPoint, progress: number): JourneyPoint {
  const clamped = Math.max(0, Math.min(1, progress));
  return {
    lat: start.lat + (end.lat - start.lat) * clamped,
    lng: start.lng + (end.lng - start.lng) * clamped,
  };
}

export function buildJourneyRoutePoints(routePoints: JourneyPoint[], currentLocation?: JourneyPoint | null) {
  return currentLocation ? [currentLocation, ...routePoints] : routePoints;
}

export function buildJourneyRevealedPath(routePoints: JourneyPoint[], progress: number) {
  if (routePoints.length <= 1) return routePoints;
  const clamped = Math.max(0, Math.min(1, progress));
  if (clamped >= 1) return routePoints;
  if (clamped <= 0) return [routePoints[0]];

  const maxSegmentIndex = routePoints.length - 1;
  const exactSegment = clamped * maxSegmentIndex;
  const segmentIndex = Math.min(maxSegmentIndex - 1, Math.floor(exactSegment));
  const segmentProgress = exactSegment - segmentIndex;
  const revealed = routePoints.slice(0, segmentIndex + 1);
  revealed.push(interpolatePoint(routePoints[segmentIndex], routePoints[segmentIndex + 1], segmentProgress));
  return revealed;
}

export function buildJourneyRouteSteps(stopIds: string[], currentLocationExists: boolean): JourneyRouteStep[] {
  const totalPoints = stopIds.length + (currentLocationExists ? 1 : 0);
  const segmentCount = Math.max(1, totalPoints - 1);
  return stopIds.map((stopId, index) => ({
    stopId,
    progress: Math.min(1, (index + (currentLocationExists ? 1 : 0)) / segmentCount),
  }));
}

export function buildJourneyFootprints(
  routePoints: JourneyPoint[],
  currentLocation?: JourneyPoint | null,
  progress = 1,
  maxVisibleFootprints = 5,
) {
  const anchorPoints = currentLocation ? [currentLocation, ...routePoints] : routePoints;
  if (anchorPoints.length <= 1) return [] as JourneyFootprint[];

  const clampedProgress = Math.max(0, Math.min(1, progress));
  if (clampedProgress <= 0) return [] as JourneyFootprint[];
  const maxFootprints = Math.min(maxVisibleFootprints, Math.max(2, anchorPoints.length <= 2 ? 2 : Math.ceil(clampedProgress * maxVisibleFootprints)));
  const footprints: JourneyFootprint[] = [];

  for (let index = 0; index < maxFootprints; index += 1) {
    const normalized = maxFootprints === 1 ? clampedProgress : (index + 1) / maxFootprints * clampedProgress;
    const exactSegment = normalized * (anchorPoints.length - 1);
    const segmentIndex = Math.min(anchorPoints.length - 2, Math.floor(exactSegment));
    const point = interpolatePoint(anchorPoints[segmentIndex], anchorPoints[segmentIndex + 1], exactSegment - segmentIndex);
    const side = index % 2 === 0 ? "left" : "right";
    const rotation = index % 2 === 0 ? -8 : 8;
    const scale = journeyMotionTokens.footprintScale + index * 0.01;
    const opacity = Math.max(0.22, journeyMotionTokens.footprintOpacity - index * 0.06);

    footprints.push({
      id: `${side}-${index}`,
      point,
      side,
      rotation,
      scale,
      opacity,
    });
  }

  return footprints;
}

export function createJourneyMotionController({
  routeStopIds,
  currentLocationExists,
  prefersReducedMotion,
  isEnabled,
  onSnapshot,
  schedule: scheduleInput,
  clearSchedule: clearScheduleInput,
}: {
  routeStopIds: string[];
  currentLocationExists: boolean;
  prefersReducedMotion: boolean;
  isEnabled: boolean;
  onSnapshot: (snapshot: JourneyMotionSnapshot) => void;
  schedule?: (callback: () => void, delay: number) => number;
  clearSchedule?: (timerId: number) => void;
}) {
  const timers: number[] = [];
  const scheduleTimer = scheduleInput ?? ((callback: () => void, delay: number) => window.setTimeout(callback, delay));
  const clearTimer = clearScheduleInput ?? ((timerId: number) => window.clearTimeout(timerId));
  let active = false;
  let interrupted = false;
  let snapshot: JourneyMotionSnapshot = {
    phase: "idle",
    routeRevealProgress: 0,
    activeFootprintIndex: 0,
    wakeStopId: null,
  };

  const publish = (nextSnapshot: JourneyMotionSnapshot) => {
    snapshot = nextSnapshot;
    onSnapshot(snapshot);
  };

  const clearScheduled = () => {
    for (const timer of timers.splice(0)) {
      clearTimer(timer);
    }
  };

  const schedule = (delay: number, callback: () => void) => {
    const id = scheduleTimer(() => {
      const index = timers.indexOf(id);
      if (index >= 0) timers.splice(index, 1);
      callback();
    }, delay);
    timers.push(id);
    return id;
  };

  const setPhase = (phase: JourneyPhase, overrides: Partial<JourneyMotionSnapshot> = {}) => {
    publish({
      ...snapshot,
      phase,
      ...overrides,
    });
  };

  const stop = () => {
    interrupted = true;
    clearScheduled();
    setPhase("interrupted", {
      routeRevealProgress: 1,
      activeFootprintIndex: 0,
      wakeStopId: null,
    });
  };

  const begin = () => {
    if (!isEnabled || prefersReducedMotion || !routeStopIds.length) {
      active = false;
      clearScheduled();
      publish({
        phase: "completed",
        routeRevealProgress: 1,
        activeFootprintIndex: 0,
        wakeStopId: null,
      });
      return;
    }

    active = true;
    interrupted = false;
    clearScheduled();
    publish({
      phase: "idle",
      routeRevealProgress: 0,
      activeFootprintIndex: 0,
      wakeStopId: null,
    });

    schedule(journeyMotionTokens.openingDuration, () => {
      if (!active || interrupted) return;
      setPhase("opening", { routeRevealProgress: 0.08 });

      schedule(journeyMotionTokens.currentLocationPulseDuration, () => {
        if (!active || interrupted) return;
        setPhase("current-location-pulse", {
          routeRevealProgress: currentLocationExists ? 0.1 : 0.18,
          activeFootprintIndex: 0,
          wakeStopId: null,
        });

        schedule(journeyMotionTokens.markerWakeDuration, () => {
          if (!active || interrupted) return;
          const routeSteps = buildJourneyRouteSteps(routeStopIds, currentLocationExists);
          let stepIndex = 0;

          const playStep = () => {
            if (!active || interrupted) return;
            const routeStep = routeSteps[stepIndex];
            if (!routeStep) {
              setPhase("handoff", { routeRevealProgress: 1, activeFootprintIndex: routeSteps.length, wakeStopId: null });
              schedule(journeyMotionTokens.handoffFadeDuration, () => {
                if (!active || interrupted) return;
                publish({
                  phase: "completed",
                  routeRevealProgress: 1,
                  activeFootprintIndex: 0,
                  wakeStopId: null,
                });
              });
              return;
            }

            setPhase("walking", {
              routeRevealProgress: routeStep.progress,
              activeFootprintIndex: stepIndex + 1,
              wakeStopId: null,
            });

            schedule(journeyMotionTokens.markerWakeDuration, () => {
              if (!active || interrupted) return;
              setPhase("marker-wake", {
                routeRevealProgress: routeStep.progress,
                activeFootprintIndex: stepIndex + 1,
                wakeStopId: routeStep.stopId,
              });
              stepIndex += 1;
              const variance = stepIndex % 2 === 0 ? journeyMotionTokens.cadenceVariation : 0;
              schedule(journeyMotionTokens.footstepInterval + variance, playStep);
            });
          };

          setPhase("walking", {
            routeRevealProgress: currentLocationExists ? 0.14 : 0.2,
            activeFootprintIndex: 0,
            wakeStopId: null,
          });
          schedule(260, playStep);
        });
      });
    });
  };

  return {
    begin,
    interrupt: stop,
    destroy: () => {
      active = false;
      interrupted = true;
      clearScheduled();
    },
  };
}
