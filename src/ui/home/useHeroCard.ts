import { useCallback, useEffect, useRef, useState } from "react";
import { applyFoodTrailHeroEligibility, applyWeekendPlanHeroEligibility } from "./heroCardEligibility";
import { normalizeHeroCardContent } from "./heroCardContent";
import type { SavedPlaceRecord } from "./savedPlaces";

export type HeroCardData = {
  type: "city_category_insight";
  cardKey?: string;
  readyStrollId?: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaAction: string;
  priorityScore?: number;
  reasonCodes?: string[];
  metadata: Record<string, unknown>;
  alternatives?: HeroCardData[];
};

type HeroCardFreshnessState = {
  lastShownCardKey: string | null;
  lastShownAtMs: number;
  dismissedCardKeys: string[];
};

const HERO_CARD_FRESHNESS_STATE_KEY = "wr_hero_card_freshness_v1";
const HERO_CARD_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_DISCOVER_HERO_CARD: HeroCardData = {
  type: "city_category_insight",
  title: "Start your list",
  subtitle: "Save places from reels and plan them later.",
  ctaLabel: "Add a place",
  ctaAction: "add_first_place",
  metadata: { rule: "default" },
};

function isEquivalentHeroCard(current: HeroCardData | null, next: HeroCardData | null) {
  if (!current || !next) return current === next;
  return (
    deriveHeroCardKey(current) === deriveHeroCardKey(next) &&
    current.readyStrollId === next.readyStrollId &&
    current.title === next.title &&
    current.subtitle === next.subtitle &&
    current.ctaLabel === next.ctaLabel &&
    current.ctaAction === next.ctaAction
  );
}

function buildHeroCardFreshnessStorageKey(userId: string | null) {
  const normalizedUserId = String(userId || "").trim();
  return normalizedUserId ? `${HERO_CARD_FRESHNESS_STATE_KEY}:${normalizedUserId}` : HERO_CARD_FRESHNESS_STATE_KEY;
}

function readHeroCardFreshnessState(userId: string | null): HeroCardFreshnessState {
  try {
    const raw = window.localStorage.getItem(buildHeroCardFreshnessStorageKey(userId));
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      lastShownCardKey: typeof parsed?.lastShownCardKey === "string" ? parsed.lastShownCardKey : null,
      lastShownAtMs: typeof parsed?.lastShownAtMs === "number" && Number.isFinite(parsed.lastShownAtMs) ? parsed.lastShownAtMs : 0,
      dismissedCardKeys: Array.isArray(parsed?.dismissedCardKeys)
        ? parsed.dismissedCardKeys.filter((item: unknown): item is string => typeof item === "string")
        : [],
    };
  } catch {
    return {
      lastShownCardKey: null,
      lastShownAtMs: 0,
      dismissedCardKeys: [],
    };
  }
}

function writeHeroCardFreshnessState(userId: string | null, state: HeroCardFreshnessState) {
  try {
    window.localStorage.setItem(buildHeroCardFreshnessStorageKey(userId), JSON.stringify(state));
  } catch {
    // Ignore persistence failures to keep hero rendering resilient.
  }
}

export function deriveHeroCardKey(card: HeroCardData): string {
  if (typeof card.cardKey === "string" && card.cardKey.trim()) {
    return card.cardKey.trim();
  }
  const targetCategory = typeof card.metadata?.targetCategory === "string" ? card.metadata.targetCategory.trim() : "";
  const targetCity = typeof card.metadata?.targetCity === "string" ? card.metadata.targetCity.trim() : "";
  const matchingPlaceIds = Array.isArray(card.metadata?.matchingPlaceIds)
    ? card.metadata.matchingPlaceIds
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .sort()
    : [];
  return JSON.stringify({
    type: card.type,
    targetCategory,
    targetCity,
    matchingPlaceIds,
  });
}

function normalizeHeroCandidatesForHome(
  candidates: HeroCardData[],
  visibleSavedPlaces: SavedPlaceRecord[],
  currentLocationLabel: string,
): HeroCardData[] {
  return candidates
    .map((candidate) => applyFoodTrailHeroEligibility(candidate, visibleSavedPlaces, currentLocationLabel))
    .map((candidate) => candidate ? applyWeekendPlanHeroEligibility(candidate, visibleSavedPlaces, currentLocationLabel) : null)
    .map((candidate) => candidate ? normalizeHeroCardContent(candidate, currentLocationLabel, visibleSavedPlaces) : null)
    .filter((candidate): candidate is HeroCardData => candidate !== null);
}

export function selectHomeHeroCandidate(input: {
  payload: HeroCardData;
  visibleSavedPlaces: SavedPlaceRecord[];
  currentLocationLabel: string;
  freshnessState: HeroCardFreshnessState;
  visibleHeroCardKey: string | null;
}) {
  const orderedCandidates = normalizeHeroCandidatesForHome(
    [input.payload, ...(Array.isArray(input.payload.alternatives) ? input.payload.alternatives : [])],
    input.visibleSavedPlaces,
    input.currentLocationLabel,
  );

  const preferredCandidate = orderedCandidates.find((candidate) => {
    const nextCardKey = deriveHeroCardKey(candidate);
    const isInCooldown =
      input.freshnessState.lastShownCardKey === nextCardKey &&
      Date.now() - input.freshnessState.lastShownAtMs < HERO_CARD_COOLDOWN_MS;
    return !isInCooldown || input.visibleHeroCardKey === nextCardKey;
  });

  return preferredCandidate || orderedCandidates[0] || null;
}

export function useHeroCard(options: {
  apiBaseUrl: string;
  currentLocationLabel: string;
  isAuthenticated: boolean;
  userId: string | null;
  visibleSavedPlaces: SavedPlaceRecord[];
}) {
  const [heroCard, setHeroCard] = useState<HeroCardData | null>(() => (
    options.isAuthenticated ? null : DEFAULT_DISCOVER_HERO_CARD
  ));
  const visibleHeroCardKeyRef = useRef<string | null>(
    options.isAuthenticated ? null : deriveHeroCardKey(DEFAULT_DISCOVER_HERO_CARD),
  );
  const defaultHeroCardKey = deriveHeroCardKey(DEFAULT_DISCOVER_HERO_CARD);

  const setVisibleHeroCard = useCallback((nextHeroCard: HeroCardData | null) => {
    visibleHeroCardKeyRef.current = nextHeroCard ? deriveHeroCardKey(nextHeroCard) : null;
    setHeroCard((current) => (isEquivalentHeroCard(current, nextHeroCard) ? current : nextHeroCard));
  }, []);

  useEffect(() => {
    if (!options.isAuthenticated) {
      setVisibleHeroCard(DEFAULT_DISCOVER_HERO_CARD);
      return;
    }

    let cancelled = false;

    if (visibleHeroCardKeyRef.current === defaultHeroCardKey) {
      setVisibleHeroCard(null);
    }

    const syncHeroCard = async () => {
      try {
        const response = await fetch(`${options.apiBaseUrl}/api/hero-card`, { credentials: "include" });
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as HeroCardData | null;
        if (!payload || !payload.title || cancelled) return;
        const freshnessState = readHeroCardFreshnessState(options.userId);
        const selectedCandidate = selectHomeHeroCandidate({
          payload,
          visibleSavedPlaces: options.visibleSavedPlaces,
          currentLocationLabel: options.currentLocationLabel,
          freshnessState,
          visibleHeroCardKey: visibleHeroCardKeyRef.current,
        });

        if (!selectedCandidate) {
          setVisibleHeroCard(null);
          return;
        }

        const nextCardKey = deriveHeroCardKey(selectedCandidate);
        setVisibleHeroCard(selectedCandidate);
        writeHeroCardFreshnessState(options.userId, {
          ...freshnessState,
          lastShownCardKey: nextCardKey,
          lastShownAtMs: Date.now(),
        });
      } catch {
        if (cancelled) return;
      }
    };

    void syncHeroCard();
    return () => {
      cancelled = true;
    };
  }, [
    defaultHeroCardKey,
    options.apiBaseUrl,
    options.currentLocationLabel,
    options.isAuthenticated,
    options.userId,
    options.visibleSavedPlaces,
    setVisibleHeroCard,
  ]);

  return { heroCard };
}
