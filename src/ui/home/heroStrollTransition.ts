import type { HeroCardData } from "./useHeroCard";
import type { PersistentStrollDetail, PersistentStrollSummary, StrollLibraryLoadState } from "./strollLibrary";

export type HeroTransitionCardMode = "empty-memory" | "city-memory";

export type HeroStrollTransitionSource = {
  rect: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
  scrollY: number;
  mode: HeroTransitionCardMode;
  title: string;
  subtitle: string;
  ctaLabel: string;
};

export type HeroStrollTransitionRequest = {
  key: string;
  strollId: string;
  source: HeroStrollTransitionSource;
  durationMs: number;
  reducedMotion: boolean;
};

export type HeroStrollTransitionPlan = {
  kind: "transition" | "direct";
  strollId: string;
  durationMs: number;
  reducedMotion: boolean;
  source: HeroStrollTransitionSource | null;
};

export const heroStrollTransitionTokens = {
  durationMs: 380,
  reducedMotionDurationMs: 120,
  ease: [0.22, 1, 0.36, 1] as const,
  scale: 1.03,
  settledScale: 1.015,
  backdropOpacity: 0.18,
};

function readEnvFlag(name: string) {
  return (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env?.[name];
}

export function readReadyStrollId(card: HeroCardData) {
  return typeof card.readyStrollId === "string" ? card.readyStrollId.trim() : "";
}

export function isHeroStrollTransitionEnabled(explicitValue?: boolean) {
  if (typeof explicitValue === "boolean") return explicitValue;
  const configuredValue = readEnvFlag("VITE_ENABLE_HERO_STROLL_TRANSITION");
  if (typeof configuredValue === "string") {
    return !["false", "0", "off", "no"].includes(configuredValue.toLowerCase());
  }
  if (typeof configuredValue === "boolean") return configuredValue;
  return true;
}

export function getHeroStrollTransitionDuration(prefersReducedMotion: boolean) {
  return prefersReducedMotion
    ? heroStrollTransitionTokens.reducedMotionDurationMs
    : heroStrollTransitionTokens.durationMs;
}

export function captureHeroStrollTransitionSource(input: {
  element: HTMLElement | null;
  mode: HeroTransitionCardMode;
  card: HeroCardData;
}): HeroStrollTransitionSource | null {
  if (!input.element) return null;
  const rect = input.element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  return {
    rect: {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    },
    scrollY: typeof window !== "undefined" ? window.scrollY : 0,
    mode: input.mode,
    title: input.card.title,
    subtitle: input.card.subtitle,
    ctaLabel: input.card.ctaLabel,
  };
}

export function findReadyHeroStroll(card: HeroCardData, strolls: PersistentStrollSummary[]) {
  const readyStrollId = readReadyStrollId(card);
  if (!readyStrollId) return null;
  const readyStroll = strolls.find((stroll) => stroll.id === readyStrollId);
  return readyStroll?.status === "ready" ? readyStroll : null;
}

export async function resolveReadyHeroStroll(input: {
  card: HeroCardData;
  strolls: PersistentStrollSummary[];
  strollLibraryState: StrollLibraryLoadState;
  verifyStroll?: (strollId: string) => Promise<PersistentStrollSummary | PersistentStrollDetail | null>;
}) {
  const loadedMatch = findReadyHeroStroll(input.card, input.strolls);
  if (loadedMatch) return loadedMatch;

  const readyStrollId = readReadyStrollId(input.card);
  if (!readyStrollId) return null;
  if (input.strollLibraryState !== "idle" && input.strollLibraryState !== "loading") {
    return null;
  }
  if (!input.verifyStroll) return null;

  const verified = await input.verifyStroll(readyStrollId);
  return verified?.id === readyStrollId && verified.status === "ready" ? verified : null;
}

export function buildHeroStrollTransitionPlan(input: {
  card: HeroCardData;
  strolls: PersistentStrollSummary[];
  source: HeroStrollTransitionSource | null;
  prefersReducedMotion: boolean;
  featureEnabled?: boolean;
}) {
  const readyStroll = findReadyHeroStroll(input.card, input.strolls);
  if (!readyStroll) return null;

  const reducedMotion = input.prefersReducedMotion;
  const durationMs = getHeroStrollTransitionDuration(reducedMotion);
  const featureEnabled = isHeroStrollTransitionEnabled(input.featureEnabled);
  const shouldTransition = featureEnabled && Boolean(input.source);

  return {
    kind: shouldTransition ? "transition" : "direct",
    strollId: readyStroll.id,
    durationMs,
    reducedMotion,
    source: shouldTransition ? input.source : null,
  } satisfies HeroStrollTransitionPlan;
}

export function createHeroStrollTransitionCoordinator(options: {
  onSettled: (key: string) => void;
  schedule?: (callback: () => void, delayMs: number) => number;
  clearSchedule?: (timerId: number) => void;
}) {
  const schedule = options.schedule ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
  const clearSchedule = options.clearSchedule ?? ((timerId) => window.clearTimeout(timerId));
  let activeKey: string | null = null;
  let timerId: number | null = null;

  const clear = () => {
    if (timerId !== null) {
      clearSchedule(timerId);
      timerId = null;
    }
    activeKey = null;
  };

  return {
    arm(request: Pick<HeroStrollTransitionRequest, "key" | "durationMs">) {
      if (activeKey === request.key) return false;
      clear();
      activeKey = request.key;
      timerId = schedule(() => {
        const settledKey = activeKey;
        clear();
        if (settledKey) {
          options.onSettled(settledKey);
        }
      }, request.durationMs);
      return true;
    },
    clear,
    destroy() {
      clear();
    },
  };
}
