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
  openingDuration: 220,
  currentLocationPulseDuration: 640,
  footstepInterval: 320,
  cadenceVariation: 86,
  strideSpacing: 36,
  footprintOpacity: 0.78,
  footprintScale: 0.94,
  routeRevealDuration: 1400,
  markerWakeDuration: 220,
  markerWakeScale: 1.12,
  markerGlowIntensity: 0.24,
  handoffFadeDuration: 360,
  interruptionDuration: 220,
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

  const maxFootprints = Math.min(8, Math.max(2, anchorPoints.length));
  const footprints: JourneyFootprint[] = [];

  for (let index = 0; index < maxFootprints; index += 1) {
    const normalized = maxFootprints === 1 ? 0 : index / (maxFootprints - 1);
    const stepIndex = Math.min(anchorPoints.length - 1, Math.round(normalized * (anchorPoints.length - 1)));
    const point = anchorPoints[stepIndex];
    const side = index % 2 === 0 ? "left" : "right";
    const rotation = (index % 2 === 0 ? -8 : 7) + (index % 3) * 2;
    const scale = journeyMotionTokens.footprintScale + (index % 3) * 0.01;
    const opacity = journeyMotionTokens.footprintOpacity - (index % 2) * 0.05;

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
      setPhase("opening", { routeRevealProgress: 0.12 });

      schedule(journeyMotionTokens.currentLocationPulseDuration, () => {
        if (!active || interrupted) return;
        setPhase(currentLocationExists ? "current-location-pulse" : "walking", {
          routeRevealProgress: currentLocationExists ? 0.22 : 0.28,
        });

        const walkStart = currentLocationExists ? journeyMotionTokens.currentLocationPulseDuration + journeyMotionTokens.openingDuration : journeyMotionTokens.openingDuration;
        schedule(180, () => {
          if (!active || interrupted) return;
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
            const nextStopId = routeStopIds[stepIndex] ?? null;
            setPhase("marker-wake", {
              routeRevealProgress: Math.min(1, nextIndex / Math.max(totalSteps, 1)),
              activeFootprintIndex: nextIndex,
              wakeStopId: nextStopId,
            });

            schedule(journeyMotionTokens.markerWakeDuration, () => {
              if (!active || interrupted) return;
              setPhase("walking", {
                routeRevealProgress: Math.min(1, nextIndex / Math.max(totalSteps, 1)),
                activeFootprintIndex: nextIndex,
                wakeStopId: null,
              });
              stepIndex = nextIndex;
              const variance = stepIndex % 2 === 0 ? journeyMotionTokens.cadenceVariation : 0;
              schedule(journeyMotionTokens.footstepInterval + variance, playStep);
            });
          };

          setPhase("walking", {
            routeRevealProgress: 0.3,
            activeFootprintIndex: 0,
            wakeStopId: null,
          });
          schedule(walkStart + 120, playStep);
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
