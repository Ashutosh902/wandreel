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

export const journeyMotionTokens: JourneyMotionTokens = {
  openingDuration: 140,
  currentLocationPulseDuration: 220,
  footstepInterval: 480,
  cadenceVariation: 42,
  strideSpacing: 36,
  footprintOpacity: 0.42,
  footprintScale: 0.78,
  routeRevealDuration: 1000,
  markerWakeDuration: 140,
  markerWakeScale: 1.04,
  markerGlowIntensity: 0.12,
  handoffFadeDuration: 220,
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
  prefersReducedMotion,
  isEnabled,
  fallbackReason,
  routePointCount,
}: {
  loadState: "loading" | "ready" | "error";
  hasUserInteracted: boolean;
  hasStartedJourney: boolean;
  prefersReducedMotion: boolean;
  isEnabled: boolean;
  fallbackReason: string | null;
  routePointCount: number;
}) {
  return loadState === "ready" && !hasUserInteracted && !hasStartedJourney && !prefersReducedMotion && isEnabled && !fallbackReason && routePointCount >= 2;
}

export function buildJourneyFootprints(routePoints: JourneyPoint[], currentLocation?: JourneyPoint | null) {
  const anchorPoints = currentLocation ? [currentLocation, ...routePoints] : routePoints;
  if (anchorPoints.length <= 1) return [] as JourneyFootprint[];

  const maxFootprints = Math.min(3, Math.max(2, anchorPoints.length <= 2 ? 2 : 3));
  const footprints: JourneyFootprint[] = [];

  for (let index = 0; index < maxFootprints; index += 1) {
    const normalized = maxFootprints === 1 ? 0 : index / (maxFootprints - 1);
    const stepIndex = Math.min(anchorPoints.length - 1, Math.round(normalized * (anchorPoints.length - 1)));
    const point = anchorPoints[stepIndex];
    const side = index % 2 === 0 ? "left" : "right";
    const rotation = index % 2 === 0 ? -2 : 2;
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
}: {
  routeStopIds: string[];
  currentLocationExists: boolean;
  prefersReducedMotion: boolean;
  isEnabled: boolean;
  onSnapshot: (snapshot: JourneyMotionSnapshot) => void;
}) {
  const timers: number[] = [];
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
      window.clearTimeout(timer);
    }
  };

  const schedule = (delay: number, callback: () => void) => {
    const id = window.setTimeout(() => {
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

      schedule(220, () => {
        if (!active || interrupted) return;
        setPhase("walking", {
          routeRevealProgress: currentLocationExists ? 0.16 : 0.24,
        });

        const totalSteps = Math.max(routeStopIds.length, 1);
        let stepIndex = 0;

        const playStep = () => {
          if (!active || interrupted) return;
          if (stepIndex >= totalSteps) {
            setPhase("handoff", { routeRevealProgress: 1, activeFootprintIndex: 0, wakeStopId: null });
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

          const nextIndex = stepIndex + 1;
          setPhase("walking", {
            routeRevealProgress: Math.min(1, nextIndex / Math.max(totalSteps, 1)),
            activeFootprintIndex: nextIndex,
            wakeStopId: null,
          });

          stepIndex = nextIndex;
          const variance = stepIndex % 2 === 0 ? journeyMotionTokens.cadenceVariation : 0;
          schedule(journeyMotionTokens.footstepInterval + variance, playStep);
        };

        setPhase("walking", {
          routeRevealProgress: 0.24,
          activeFootprintIndex: 0,
          wakeStopId: null,
        });
        schedule(220, playStep);
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
