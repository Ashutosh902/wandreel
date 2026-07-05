import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bell } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { BottomNav } from "./BottomNav";
import { BucketlistSummary } from "./BucketlistSummary";
import { CategoryDetailPage } from "./CategoryDetailPage";
import { AddScreen } from "./AddScreen";
import { FoodTrailScreen } from "./FoodTrailScreen";
import { HeroCard } from "./HeroCard";
import { LocationSelector } from "./LocationSelector";
import { RecentlyAddedCarousel } from "./RecentlyAddedCarousel";
import { ConnectScreen } from "./ConnectScreen";
import type { CategoryLabel, NavLabel } from "./home.data";
import { runHomeDataChecks } from "./home.data";
import { LoginProfileScreen } from "../profile/LoginProfileScreen";
import { MapScreen } from "../map/MapScreen";
import { useUx } from "../layout/UxProvider";
import { useAuth } from "../auth/AuthProvider";
import {
  SHARED_INTENT_ADD_TAB_VALUE,
  SHARED_INTENT_QUERY_KEY,
  SHARED_INTENT_RECEIVED_EVENT,
  SHARED_INTENT_TAB_KEY,
} from "../../pwa/shareTarget";
import {
  ADD_DRAFT_UPDATED_EVENT,
  ADD_PROCESSING_STARTED_EVENT,
  ADD_READY_UPDATED_EVENT,
  addReadyNotification,
  mapEntitiesToPlaces,
  readPersistedAddDraft,
  readReadyNotifications,
  setReviewRunId,
  writePersistedAddDraft,
  type AddReadyNotification,
  type IntelligenceEntity,
} from "./addFlowState";
import {
  createEmptySavedPlacesByCategory,
  flattenSavedPlaces,
  getSavedPlaceCounts,
  getRecentlyAddedSavedPlaces,
  mergeSavedPlacesFromApi,
  readSavedPlacesByCategory,
  SAVED_PLACES_UPDATED_EVENT,
  type SavedPlaceApiItem,
  type SavedPlaceRecord,
} from "./savedPlaces";
import {
  createLocalSavedPlacesPlannerDataSource,
  resolveHeroCardPlannerSelection,
} from "./heroCardPlannerData";
import "./home.css";

runHomeDataChecks();
const NAV_ORDER: NavLabel[] = ["Discover", "Map", "Add", "Connect", "Login"];
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
const ADD_INTELLIGENCE_TIMEOUT_MS = 120000;
const DISMISSED_READY_NOTIFICATION_IDS_KEY = "wr_dismissed_ready_notification_ids_v1";
const HERO_CARD_FRESHNESS_STATE_KEY = "wr_hero_card_freshness_v1";
const HERO_CARD_SAVED_IDEAS_KEY = "wr_hero_card_saved_ideas_v1";
const HERO_CARD_COOLDOWN_MS = 24 * 60 * 60 * 1000;

type HeroMode = "empty-memory" | "city-memory";
type HeroCardData = {
  type: "city_category_insight";
  cardKey?: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaAction: string;
  priorityScore?: number;
  reasonCodes?: string[];
  metadata: Record<string, unknown>;
  alternatives?: HeroCardData[];
};

type HeroNavigationContext = {
  filteredPlaceIds: string[] | null;
  filteredCity: string | null;
  mapPlaces: SavedPlaceRecord[] | null;
  mapCategories: CategoryLabel[] | null;
};

type PlannerRoute = "home" | "food-trail";

type FoodTrailPlannerContext = {
  matchingPlaceIds: string[] | null;
};

type HeroCardFreshnessState = {
  lastShownCardKey: string | null;
  lastShownAtMs: number;
  dismissedCardKeys: string[];
};

type SavedHeroIdea = {
  cardKey: string;
  title: string;
  subtitle: string;
  ctaAction: string;
  metadata: Record<string, unknown>;
  matchingPlaceIds: string[];
  createdAtMs: number;
};

const DEFAULT_DISCOVER_HERO_CARD: HeroCardData = {
  type: "city_category_insight",
  title: "Your memories will start here",
  subtitle: "Save places, reels, and ideas to build your city memories.",
  ctaLabel: "Add a place",
  ctaAction: "add_first_place",
  metadata: { rule: "default" },
};

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

function deriveHeroCardKey(card: HeroCardData): string {
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

function buildHeroCardSavedIdeasStorageKey(userId: string | null) {
  const normalizedUserId = String(userId || "").trim();
  return normalizedUserId ? `${HERO_CARD_SAVED_IDEAS_KEY}:${normalizedUserId}` : HERO_CARD_SAVED_IDEAS_KEY;
}

function readSavedHeroIdeas(userId: string | null): SavedHeroIdea[] {
  try {
    const raw = window.localStorage.getItem(buildHeroCardSavedIdeasStorageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedHeroIdea => (
      item &&
      typeof item === "object" &&
      typeof item.cardKey === "string" &&
      typeof item.title === "string" &&
      typeof item.subtitle === "string" &&
      typeof item.ctaAction === "string" &&
      item.metadata &&
      typeof item.metadata === "object" &&
      Array.isArray(item.matchingPlaceIds) &&
      typeof item.createdAtMs === "number"
    ));
  } catch {
    return [];
  }
}

function writeSavedHeroIdeas(userId: string | null, ideas: SavedHeroIdea[]) {
  try {
    window.localStorage.setItem(buildHeroCardSavedIdeasStorageKey(userId), JSON.stringify(ideas));
  } catch {
    // Ignore persistence failures to keep the hero card safe in constrained environments.
  }
}

function buildSavedHeroIdea(card: HeroCardData): SavedHeroIdea {
  const matchingPlaceIds = Array.isArray(card.metadata?.matchingPlaceIds)
    ? card.metadata.matchingPlaceIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  return {
    cardKey: deriveHeroCardKey(card),
    title: card.title,
    subtitle: card.subtitle,
    ctaAction: card.ctaAction,
    metadata: card.metadata || {},
    matchingPlaceIds,
    createdAtMs: Date.now(),
  };
}

function getPlannerRouteFromPathname(pathname: string): PlannerRoute {
  return pathname.startsWith("/trail/food") ? "food-trail" : "home";
}

function DiscoverPage({
  activeCategory,
  onSelectCategory,
  onViewMap,
  onAddLink,
  onBackCategory,
  notificationCount,
  onNotificationsClick,
  savedPlacesByCategory,
  recentSavedPlaces,
  heroCard,
  onHeroCta,
  onHeroSaveIdea,
}: {
  activeCategory: CategoryLabel | null;
  onSelectCategory: (category: CategoryLabel) => void;
  onViewMap: (category: CategoryLabel) => void;
  onAddLink: () => void;
  onBackCategory: () => void;
  notificationCount: number;
  onNotificationsClick: () => void;
  savedPlacesByCategory: Record<CategoryLabel, SavedPlaceRecord[]>;
  recentSavedPlaces: SavedPlaceRecord[];
  heroCard: HeroCardData | null;
  onHeroCta: (card: HeroCardData) => void;
  onHeroSaveIdea: (card: HeroCardData) => void;
}) {
  const counts = getSavedPlaceCounts(savedPlacesByCategory);
  const heroMode: HeroMode = heroCard?.metadata.rule === "fallback" || heroCard?.metadata.rule === "default"
    ? "empty-memory"
    : "city-memory";

  return (
    <>
      <header className="wr-home-header">
        {activeCategory ? (
          <button
            type="button"
            className="wr-header-back"
            aria-label="Back"
            onClick={onBackCategory}
          >
            <ArrowLeft size={18} />
          </button>
        ) : (
          <div className="wr-brand" aria-hidden="true" />
        )}
        <LocationSelector inline />
        <button
          type="button"
          aria-label={notificationCount ? `${notificationCount} ready notifications` : "Notifications"}
          className={`wr-notify-btn ${notificationCount ? "is-ready" : ""}`}
          onClick={onNotificationsClick}
        >
          <Bell size={18} className="wr-notify-icon" />
          {notificationCount ? <span className="wr-notify-badge">{notificationCount}</span> : null}
        </button>
      </header>
      {activeCategory ? (
        <CategoryDetailPage
          category={activeCategory}
          onViewMap={onViewMap}
          onAddLink={onAddLink}
          savedPlaces={savedPlacesByCategory[activeCategory]}
        />
      ) : (
        <>
          {heroCard ? (
            <HeroCard
              mode={heroMode}
              title={heroCard.title}
              subtitle={heroCard.subtitle}
              ctaLabel={heroCard.ctaLabel}
              onCtaClick={() => onHeroCta(heroCard)}
              onSaveIdeaClick={() => onHeroSaveIdea(heroCard)}
            />
          ) : null}
          <BucketlistSummary counts={counts} onSelectCategory={onSelectCategory} onAddLink={onAddLink} />
          <RecentlyAddedCarousel places={recentSavedPlaces} onAddLink={onAddLink} />
        </>
      )}
    </>
  );
}

function ReadyNotificationsSheet({
  items,
  onClose,
  onReview,
  onDismissNotification,
}: {
  items: AddReadyNotification[];
  onClose: () => void;
  onReview: (runId: number) => void;
  onDismissNotification: (id: string) => void;
}) {
  return (
    <div className="wr-ready-sheet-layer" role="presentation">
      <button type="button" className="wr-ready-sheet-backdrop" aria-label="Close notifications" onClick={onClose} />
      <section className="wr-ready-sheet" role="dialog" aria-modal="false" aria-label="Ready to save notifications">
        <div className="wr-ready-sheet-head">
          <div>
            <p>READY TO SAVE</p>
            <h3>Your Wandreels</h3>
          </div>
          <button type="button" className="wr-ready-sheet-close" aria-label="Close notifications" onClick={onClose}>
            x
          </button>
        </div>
        {items.length ? (
          <div className="wr-ready-list">
            {items.map((item) => (
              <article className="wr-ready-item" key={item.id}>
                <button
                  type="button"
                  className="wr-ready-item-dismiss"
                  aria-label={`Dismiss ${item.placeName} notification`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDismissNotification(item.id);
                  }}
                >
                  x
                </button>
                <img src={item.imageUrl} alt="" className="wr-ready-item-image" />
                <div className="wr-ready-item-body">
                  <h4>{item.placeName}</h4>
                  <p>{item.placeName} is ready to save in {item.category}.</p>
                  <span>{item.locality} - {item.source}</span>
                  <button type="button" className="wr-ready-review-btn" onClick={() => onReview(item.runId)}>
                    Review & save
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="wr-ready-empty">No Wandreels are waiting right now.</p>
        )}
      </section>
    </div>
  );
}

export function HomeScreen() {
  const prefersReducedMotion = useReducedMotion();
  const { showToast } = useUx();
  const { isAuthenticated, sessionUser } = useAuth();
  const [activeTab, setActiveTab] = useState<NavLabel>("Discover");
  const [activeCategory, setActiveCategory] = useState<CategoryLabel | null>(null);
  const [mapEntryMode, setMapEntryMode] = useState<"global" | "category">("global");
  const [mapSourceCategory, setMapSourceCategory] = useState<CategoryLabel | null>(null);
  const [globalMapActiveCategories, setGlobalMapActiveCategories] = useState<CategoryLabel[]>([
    "Taste",
    "Activity",
    "Stay",
    "Explore",
  ]);
  const [savedPlacesByCategory, setSavedPlacesByCategory] = useState(createEmptySavedPlacesByCategory);
  const [readyNotifications, setReadyNotifications] = useState<AddReadyNotification[]>(() => readReadyNotifications());
  const [heroCard, setHeroCard] = useState<HeroCardData | null>(DEFAULT_DISCOVER_HERO_CARD);
  const [plannerRoute, setPlannerRoute] = useState<PlannerRoute>(() => (
    typeof window !== "undefined" ? getPlannerRouteFromPathname(window.location.pathname) : "home"
  ));
  const [foodTrailPlannerContext, setFoodTrailPlannerContext] = useState<FoodTrailPlannerContext>({
    matchingPlaceIds: null,
  });
  const [heroNavigationContext, setHeroNavigationContext] = useState<HeroNavigationContext>({
    filteredPlaceIds: null,
    filteredCity: null,
    mapPlaces: null,
    mapCategories: null,
  });
  const [dismissedNotificationIds, setDismissedNotificationIds] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(DISMISSED_READY_NOTIFICATION_IDS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  });
  const [isReadySheetOpen, setIsReadySheetOpen] = useState(false);
  const [transitionDirection, setTransitionDirection] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const isPollingAddJobsRef = useRef(false);
  const visibleHeroCardKeyRef = useRef<string | null>(deriveHeroCardKey(DEFAULT_DISCOVER_HERO_CARD));
  const touchStartRef = useRef<{ x: number; y: number; edge: "left" | "right" } | null>(null);
  const pullStartYRef = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const isMapTab = activeTab === "Map";
  const isAddTab = activeTab === "Add";
  const isCategoryView = activeTab === "Discover" && activeCategory !== null;
  const isFoodTrailRoute = plannerRoute === "food-trail";
  const pageKey = isFoodTrailRoute
    ? "trail-food"
    : activeTab === "Discover" && activeCategory
      ? `Discover-${activeCategory}`
      : activeTab;
  const getTabOrderIndex = (tab: NavLabel) => NAV_ORDER.indexOf(tab);
  const effectiveSavedPlacesByCategory = useMemo(
    () => (isAuthenticated ? savedPlacesByCategory : createEmptySavedPlacesByCategory()),
    [isAuthenticated, savedPlacesByCategory],
  );
  const allSavedPlaces = useMemo(
    () => flattenSavedPlaces(effectiveSavedPlacesByCategory),
    [effectiveSavedPlacesByCategory],
  );
  const visibleSavedPlaces = useMemo(
    () => (isAuthenticated ? allSavedPlaces : []),
    [allSavedPlaces, isAuthenticated],
  );
  const recentSavedPlaces = useMemo(
    () => getRecentlyAddedSavedPlaces(visibleSavedPlaces, 7),
    [visibleSavedPlaces],
  );
  const visibleSavedPlacesByCategory = useMemo(() => {
    if (!isAuthenticated) return createEmptySavedPlacesByCategory();
    return effectiveSavedPlacesByCategory;
  }, [effectiveSavedPlacesByCategory, isAuthenticated]);
  const visibleReadyNotifications = useMemo(
    () => readyNotifications.filter((item) => !dismissedNotificationIds.includes(item.id)),
    [dismissedNotificationIds, readyNotifications],
  );
  const clearHeroNavigationContext = useCallback(() => {
    setHeroNavigationContext({
      filteredPlaceIds: null,
      filteredCity: null,
      mapPlaces: null,
      mapCategories: null,
    });
  }, []);
  const setPlannerPath = useCallback((nextRoute: PlannerRoute, replace = false) => {
    if (typeof window === "undefined") return;
    const nextPath = nextRoute === "food-trail" ? "/trail/food" : "/";
    const nextUrl = `${nextPath}${window.location.search}${window.location.hash}`;
    if (replace) {
      window.history.replaceState({}, "", nextUrl);
    } else {
      window.history.pushState({}, "", nextUrl);
    }
    setPlannerRoute(nextRoute);
  }, []);
  const refreshSavedPlaces = useCallback(() => {
    setSavedPlacesByCategory(isAuthenticated ? readSavedPlacesByCategory() : createEmptySavedPlacesByCategory());
  }, [isAuthenticated]);

  const refreshReadyNotifications = useCallback(() => {
    setReadyNotifications(readReadyNotifications());
  }, []);
  const persistDismissedNotificationIds = useCallback((nextIds: string[]) => {
    setDismissedNotificationIds(nextIds);
    window.localStorage.setItem(DISMISSED_READY_NOTIFICATION_IDS_KEY, JSON.stringify(nextIds));
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setPlannerRoute(getPlannerRouteFromPathname(window.location.pathname));
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const requestedTab = url.searchParams.get(SHARED_INTENT_TAB_KEY);
    const hasSharedFlag = url.searchParams.get(SHARED_INTENT_QUERY_KEY) === "1";
    if (requestedTab !== SHARED_INTENT_ADD_TAB_VALUE && !hasSharedFlag) return;

    setActiveTab("Add");
    setActiveCategory(null);
    setMapEntryMode("global");
    setMapSourceCategory(null);

    url.searchParams.delete(SHARED_INTENT_TAB_KEY);
    url.searchParams.delete(SHARED_INTENT_QUERY_KEY);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    const handleSharedIntent = () => {
      setTransitionDirection(getTabOrderIndex("Add") >= getTabOrderIndex(activeTab) ? 1 : -1);
      setActiveCategory(null);
      setMapEntryMode("global");
      setMapSourceCategory(null);
      setActiveTab("Add");
    };

    window.addEventListener(SHARED_INTENT_RECEIVED_EVENT, handleSharedIntent);
    return () => window.removeEventListener(SHARED_INTENT_RECEIVED_EVENT, handleSharedIntent);
  }, [activeTab]);

  const openAddForReview = useCallback((runId: number) => {
    setReviewRunId(runId);
    setTransitionDirection(getTabOrderIndex("Add") >= getTabOrderIndex(activeTab) ? 1 : -1);
    setActiveCategory(null);
    setMapEntryMode("global");
    setMapSourceCategory(null);
    setActiveTab("Add");
    setIsReadySheetOpen(false);
  }, [activeTab]);
  const dismissNotification = useCallback((id: string) => {
    persistDismissedNotificationIds(
      dismissedNotificationIds.includes(id) ? dismissedNotificationIds : [...dismissedNotificationIds, id],
    );
  }, [dismissedNotificationIds, persistDismissedNotificationIds]);

  const requestNotificationPermission = useCallback(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    void Notification.requestPermission().catch(() => undefined);
  }, []);

  const notifyReadyToSave = useCallback((item: AddReadyNotification) => {
    addReadyNotification(item);
    refreshReadyNotifications();

    const body = `${item.placeName} is ready to save in ${item.category}.`;
    if (document.visibilityState === "hidden" && "Notification" in window && Notification.permission === "granted") {
      const notification = new Notification("Your Wandreel is ready", {
        body,
        icon: "/favicon.svg",
        tag: `wr-add-ready-${item.runId}`,
      });
      notification.onclick = () => {
        window.focus();
        openAddForReview(item.runId);
        notification.close();
      };
      return;
    }

    if (activeTab !== "Add") {
      showToast({ message: body, variant: "success", durationMs: 3600 });
    }
  }, [activeTab, openAddForReview, refreshReadyNotifications, showToast]);

  const pollPendingAddJobs = useCallback(async () => {
    if (isPollingAddJobsRef.current) return;
    const draft = readPersistedAddDraft();
    if (!draft?.pendingJobs.length) return;

    isPollingAddJobsRef.current = true;
    try {
      let didChange = false;
      let nextPlaces = draft.detectedPlaces;
      let nextPendingJobs = draft.pendingJobs;

      for (const pending of draft.pendingJobs) {
        if (!pending.jobId) continue;
        try {
          const response = await fetch(`${API_BASE_URL}/api/intelligence/jobs/${pending.jobId}`);
          const payload = await response.json();
          const job = payload?.job;
          if (!response.ok || !job) continue;

          if (job.status === "completed") {
            const entities = (job.result?.output?.structuredEntities || []) as IntelligenceEntity[];
            const resolvedPlaces = mapEntitiesToPlaces(
              entities,
              {
                source: pending.source,
                imageUrl: pending.imageUrl,
                videoUrl: pending.videoUrl,
                sourceUrl: pending.sourceUrl,
                retryCount: pending.retryCount,
              },
              pending.runId,
            );
            const withoutRun = nextPlaces.filter((item) => item.runId !== pending.runId);
            nextPlaces = resolvedPlaces.length ? [...resolvedPlaces, ...withoutRun] : [pending.fallbackPlace, ...withoutRun];
            nextPendingJobs = nextPendingJobs.filter((item) => item.jobId !== pending.jobId);
            didChange = true;

            const readyPlace = resolvedPlaces[0] || pending.fallbackPlace;
            if (readyPlace) {
              notifyReadyToSave({
                id: `ready-${pending.jobId}`,
                runId: pending.runId,
                jobId: pending.jobId,
                placeId: readyPlace.placeId || readyPlace.id,
                placeName: readyPlace.name,
                category: readyPlace.category,
                locality: readyPlace.locality,
                source: readyPlace.source,
                imageUrl: readyPlace.imageUrl,
                createdAtMs: Date.now(),
              });
            }
          } else if (job.status === "failed") {
            const withoutRun = nextPlaces.filter((item) => item.runId !== pending.runId);
            nextPlaces = [pending.fallbackPlace, ...withoutRun];
            nextPendingJobs = nextPendingJobs.filter((item) => item.jobId !== pending.jobId);
            didChange = true;
          } else if (Date.now() - pending.startedAtMs >= ADD_INTELLIGENCE_TIMEOUT_MS) {
            const withoutRun = nextPlaces.filter((item) => item.runId !== pending.runId);
            nextPlaces = [pending.fallbackPlace, ...withoutRun];
            nextPendingJobs = nextPendingJobs.filter((item) => item.jobId !== pending.jobId);
            didChange = true;
          }
        } catch {
          if (Date.now() - pending.startedAtMs >= ADD_INTELLIGENCE_TIMEOUT_MS) {
            const withoutRun = nextPlaces.filter((item) => item.runId !== pending.runId);
            nextPlaces = [pending.fallbackPlace, ...withoutRun];
            nextPendingJobs = nextPendingJobs.filter((item) => item.jobId !== pending.jobId);
            didChange = true;
          }
        }
      }

      if (didChange) {
        writePersistedAddDraft({
          ...draft,
          detectedPlaces: nextPlaces,
          pendingJobs: nextPendingJobs,
          selectedDetectedCategory: "Auto-detect",
          selectedPreviewIndex: 0,
          isPreviewVisible: true,
        });
      }
    } finally {
      isPollingAddJobsRef.current = false;
    }
  }, [notifyReadyToSave]);

  useEffect(() => {
    refreshSavedPlaces();
    const onSavedPlacesUpdate = () => refreshSavedPlaces();
    window.addEventListener(SAVED_PLACES_UPDATED_EVENT, onSavedPlacesUpdate);
    window.addEventListener("storage", onSavedPlacesUpdate);
    return () => {
      window.removeEventListener(SAVED_PLACES_UPDATED_EVENT, onSavedPlacesUpdate);
      window.removeEventListener("storage", onSavedPlacesUpdate);
    };
  }, [refreshSavedPlaces]);

  useEffect(() => {
    visibleHeroCardKeyRef.current = heroCard ? deriveHeroCardKey(heroCard) : null;
  }, [heroCard]);

  useEffect(() => {
    if (!isAuthenticated) {
      setSavedPlacesByCategory(createEmptySavedPlacesByCategory());
      setHeroCard(DEFAULT_DISCOVER_HERO_CARD);
      return;
    }

    let cancelled = false;
    setSavedPlacesByCategory(readSavedPlacesByCategory());

    const syncSavedPlaces = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/saved-places`, { credentials: "include" });
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as { ok?: boolean; items?: SavedPlaceApiItem[] };
        if (!payload?.ok || !Array.isArray(payload.items) || cancelled) return;
        mergeSavedPlacesFromApi(payload.items);
      } catch {
        if (cancelled) return;
      }
    };

    void syncSavedPlaces();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setHeroCard(DEFAULT_DISCOVER_HERO_CARD);
      return;
    }

    let cancelled = false;

    const syncHeroCard = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/hero-card`, { credentials: "include" });
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as HeroCardData | null;
        if (!payload || !payload.title || cancelled) return;
        const userId = sessionUser?.userId ?? null;
        const freshnessState = readHeroCardFreshnessState(userId);
        const orderedCandidates = [payload, ...(Array.isArray(payload.alternatives) ? payload.alternatives : [])];
        const selectedCandidate = orderedCandidates.find((candidate) => {
          const nextCardKey = deriveHeroCardKey(candidate);
          const isInCooldown =
            freshnessState.lastShownCardKey === nextCardKey &&
            Date.now() - freshnessState.lastShownAtMs < HERO_CARD_COOLDOWN_MS;
          return !isInCooldown || visibleHeroCardKeyRef.current === nextCardKey;
        }) || null;

        if (!selectedCandidate) {
          setHeroCard(null);
          return;
        }

        const nextCardKey = deriveHeroCardKey(selectedCandidate);
        setHeroCard(selectedCandidate);
        writeHeroCardFreshnessState(userId, {
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
  }, [effectiveSavedPlacesByCategory, isAuthenticated, sessionUser?.userId]);

  useEffect(() => {
    refreshReadyNotifications();
    const onReadyUpdate = () => refreshReadyNotifications();
    window.addEventListener(ADD_READY_UPDATED_EVENT, onReadyUpdate);
    window.addEventListener("storage", onReadyUpdate);
    return () => {
      window.removeEventListener(ADD_READY_UPDATED_EVENT, onReadyUpdate);
      window.removeEventListener("storage", onReadyUpdate);
    };
  }, [refreshReadyNotifications]);

  useEffect(() => {
    const validIds = new Set(readyNotifications.map((item) => item.id));
    const nextDismissedIds = dismissedNotificationIds.filter((id) => validIds.has(id));
    if (nextDismissedIds.length !== dismissedNotificationIds.length) {
      persistDismissedNotificationIds(nextDismissedIds);
    }
  }, [dismissedNotificationIds, persistDismissedNotificationIds, readyNotifications]);

  useEffect(() => {
    window.addEventListener(ADD_PROCESSING_STARTED_EVENT, requestNotificationPermission);
    return () => window.removeEventListener(ADD_PROCESSING_STARTED_EVENT, requestNotificationPermission);
  }, [requestNotificationPermission]);

  useEffect(() => {
    void pollPendingAddJobs();
    const intervalId = window.setInterval(() => void pollPendingAddJobs(), 1800);
    const onResume = () => void pollPendingAddJobs();
    window.addEventListener(ADD_DRAFT_UPDATED_EVENT, onResume);
    window.addEventListener("online", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener(ADD_DRAFT_UPDATED_EVENT, onResume);
      window.removeEventListener("online", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [pollPendingAddJobs]);

  const handleBackGesture = () => {
    if (activeTab === "Discover" && activeCategory) {
      clearHeroNavigationContext();
      setTransitionDirection(-1);
      setActiveCategory(null);
      return;
    }

    if (plannerRoute === "food-trail") {
      setTransitionDirection(-1);
      setPlannerPath("home", true);
      return;
    }

    if (activeTab === "Map") {
      clearHeroNavigationContext();
      setTransitionDirection(-1);
      setActiveTab("Discover");
      if (mapEntryMode === "category" && mapSourceCategory) {
        setActiveCategory(mapSourceCategory);
      } else {
        setActiveCategory(null);
      }
      return;
    }

    if (activeTab !== "Discover") {
      clearHeroNavigationContext();
      setTransitionDirection(-1);
      setActiveTab("Discover");
      setActiveCategory(null);
      setMapEntryMode("global");
      setMapSourceCategory(null);
    }
  };

  const heroFilteredPlacesByCategory = useMemo(() => {
    if (!heroNavigationContext.filteredPlaceIds?.length) return visibleSavedPlacesByCategory;
    const allowedIds = new Set(heroNavigationContext.filteredPlaceIds);
    return {
      Taste: visibleSavedPlacesByCategory.Taste.filter((place) => allowedIds.has(String(place.placeId || place.id || "").trim())),
      Activity: visibleSavedPlacesByCategory.Activity.filter((place) => allowedIds.has(String(place.placeId || place.id || "").trim())),
      Stay: visibleSavedPlacesByCategory.Stay.filter((place) => allowedIds.has(String(place.placeId || place.id || "").trim())),
      Explore: visibleSavedPlacesByCategory.Explore.filter((place) => allowedIds.has(String(place.placeId || place.id || "").trim())),
    };
  }, [heroNavigationContext.filteredPlaceIds, visibleSavedPlacesByCategory]);
  const foodTrailPlannerPlaces = useMemo(() => {
    if (!foodTrailPlannerContext.matchingPlaceIds?.length) {
      return visibleSavedPlacesByCategory.Taste;
    }
    const allowedIds = new Set(foodTrailPlannerContext.matchingPlaceIds);
    return visibleSavedPlacesByCategory.Taste.filter((place) => allowedIds.has(String(place.placeId || place.id || "").trim()));
  }, [foodTrailPlannerContext.matchingPlaceIds, visibleSavedPlacesByCategory]);

  const page = useMemo(() => {
    if (plannerRoute === "food-trail") {
      return (
        <FoodTrailScreen
          savedPlaces={foodTrailPlannerPlaces}
          onBack={() => {
            setTransitionDirection(-1);
            setPlannerPath("home", true);
          }}
        />
      );
    }

    if (activeTab === "Discover") {
      return (
          <DiscoverPage
          activeCategory={activeCategory}
          onSelectCategory={(category) => {
            clearHeroNavigationContext();
            setActiveCategory(category);
          }}
          onBackCategory={() => {
            clearHeroNavigationContext();
            setTransitionDirection(-1);
            setActiveCategory(null);
          }}
          onAddLink={() => {
            clearHeroNavigationContext();
            setTransitionDirection(1);
            setActiveCategory(null);
            setActiveTab("Add");
          }}
          notificationCount={visibleReadyNotifications.length}
          onNotificationsClick={() => setIsReadySheetOpen(true)}
          savedPlacesByCategory={heroFilteredPlacesByCategory}
          recentSavedPlaces={recentSavedPlaces}
          heroCard={heroCard}
          onHeroCta={(card) => {
            console.info("[hero-card] selected action", card.ctaAction, card.metadata);
            const plannerSelection = resolveHeroCardPlannerSelection(
              card,
              createLocalSavedPlacesPlannerDataSource(visibleSavedPlaces),
            );

            if (card.ctaAction === "add_first_place" || card.ctaAction === "grow_saved_places") {
              clearHeroNavigationContext();
              setTransitionDirection(1);
              setActiveCategory(null);
              setActiveTab("Add");
              return;
            }

            const openCategoryFromHero = (category: CategoryLabel, sourcePlaces: SavedPlaceRecord[]) => {
              const categoryPlaces = sourcePlaces.filter((place) => place.category === category);
              if (!categoryPlaces.length) {
                showToast({ message: "No matching saved places found for this card yet.", variant: "info", durationMs: 2200 });
                return;
              }
              setHeroNavigationContext({
                filteredPlaceIds: categoryPlaces.map((place) => String(place.placeId || place.id || "").trim()),
                filteredCity: plannerSelection.targetCity,
                mapPlaces: null,
                mapCategories: null,
              });
              setTransitionDirection(1);
              setActiveTab("Discover");
              setActiveCategory(category);
            };

            const openCityPlanFromHero = (sourcePlaces: SavedPlaceRecord[]) => {
              if (!sourcePlaces.length) {
                showToast({ message: "No matching saved places found for this city plan yet.", variant: "info", durationMs: 2200 });
                return;
              }
              const presentCategories = Array.from(new Set(sourcePlaces.map((place) => place.category))) as CategoryLabel[];
              setHeroNavigationContext({
                filteredPlaceIds: null,
                filteredCity: plannerSelection.targetCity,
                mapPlaces: sourcePlaces,
                mapCategories: presentCategories.length ? presentCategories : ["Taste", "Activity", "Stay", "Explore"],
              });
              if (presentCategories.length) {
                setGlobalMapActiveCategories(presentCategories);
              }
              setTransitionDirection(1);
              setActiveCategory(null);
              setMapEntryMode("global");
              setMapSourceCategory(null);
              setActiveTab("Map");
            };

            if (
              card.ctaAction === "build_food_trail" ||
              card.ctaAction === "view_dominant_category" && plannerSelection.targetCategory === "Taste"
            ) {
              if (card.ctaAction === "build_food_trail") {
                const tastePlaces = plannerSelection.getCategoryPlaces("Taste");
                const tastePlaceIds = tastePlaces.map((place) => String(place.placeId || place.id || "").trim()).filter(Boolean);
                setFoodTrailPlannerContext({
                  matchingPlaceIds: tastePlaceIds.length ? tastePlaceIds : null,
                });
                clearHeroNavigationContext();
                setTransitionDirection(1);
                setActiveTab("Discover");
                setActiveCategory(null);
                setPlannerPath("food-trail");
                return;
              }
              openCategoryFromHero("Taste", plannerSelection.getCategoryPlaces("Taste"));
              return;
            }

            if (
              card.ctaAction === "plan_weekend_explore" ||
              card.ctaAction === "view_dominant_category" && plannerSelection.targetCategory === "Explore"
            ) {
              openCategoryFromHero("Explore", plannerSelection.getCategoryPlaces("Explore"));
              return;
            }

            if (card.ctaAction === "view_dominant_category" && plannerSelection.targetCategory) {
              openCategoryFromHero(plannerSelection.targetCategory, plannerSelection.getCategoryPlaces(plannerSelection.targetCategory));
              return;
            }

            if (card.ctaAction === "view_city_plan") {
              openCityPlanFromHero(plannerSelection.getCityPlaces());
              return;
            }

            if (card.ctaAction === "create_itinerary") {
              showToast({ message: "Planner coming soon", variant: "success", durationMs: 1800 });
              return;
            }

            showToast({ message: `${card.ctaLabel} coming soon`, variant: "success", durationMs: 1800 });
          }}
          onHeroSaveIdea={(card) => {
            const userId = sessionUser?.userId ?? null;
            const nextIdea = buildSavedHeroIdea(card);
            const existingIdeas = readSavedHeroIdeas(userId);
            if (existingIdeas.some((idea) => idea.cardKey === nextIdea.cardKey)) {
              showToast({ message: "Idea already saved.", variant: "info", durationMs: 1800 });
              return;
            }
            writeSavedHeroIdeas(userId, [nextIdea, ...existingIdeas]);
            showToast({ message: "Idea saved for later.", variant: "success", durationMs: 1800 });
          }}
          onViewMap={(category) => {
            clearHeroNavigationContext();
            setTransitionDirection(1);
            setMapEntryMode("category");
            setMapSourceCategory(category);
            setActiveTab("Map");
          }}
        />
      );
    }

    if (activeTab === "Map") {
      return (
        <MapScreen
          entryMode={mapEntryMode}
          sourceCategory={mapSourceCategory}
          globalActiveCategories={heroNavigationContext.mapCategories || globalMapActiveCategories}
          onGlobalActiveCategoriesChange={setGlobalMapActiveCategories}
          savedPlaces={heroNavigationContext.mapPlaces || allSavedPlaces}
          onAddLink={() => {
            clearHeroNavigationContext();
            setTransitionDirection(1);
            setActiveTab("Add");
            setActiveCategory(null);
            setMapEntryMode("global");
            setMapSourceCategory(null);
          }}
          onBack={() => {
            clearHeroNavigationContext();
            setTransitionDirection(-1);
            setActiveTab("Discover");
            if (mapEntryMode === "category" && mapSourceCategory) {
              setActiveCategory(mapSourceCategory);
            } else {
              setActiveCategory(null);
            }
          }}
        />
      );
    }

    if (activeTab === "Add") {
      return <AddScreen />;
    }

    if (activeTab === "Connect") {
      return (
        <ConnectScreen
          savedPlacesByCategory={visibleSavedPlacesByCategory}
          onViewSavedPlaces={() => {
            clearHeroNavigationContext();
            setTransitionDirection(-1);
            setActiveCategory(null);
            setMapEntryMode("global");
            setMapSourceCategory(null);
            setActiveTab("Discover");
          }}
        />
      );
    }

    return <LoginProfileScreen />;
  }, [
    foodTrailPlannerPlaces,
    activeCategory,
    activeTab,
    allSavedPlaces,
    clearHeroNavigationContext,
    foodTrailPlannerContext.matchingPlaceIds,
    globalMapActiveCategories,
    heroFilteredPlacesByCategory,
    heroCard,
    heroNavigationContext.mapCategories,
    heroNavigationContext.mapPlaces,
    mapEntryMode,
    mapSourceCategory,
    readyNotifications.length,
    recentSavedPlaces,
    showToast,
    visibleSavedPlaces,
    visibleSavedPlacesByCategory,
    plannerRoute,
    setPlannerPath,
  ]);

  return (
    <div className="wr-home-page">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className={`wr-phone-shell ${isMapTab ? "wr-phone-shell-map" : ""}`}
      >
        <div
          ref={surfaceRef}
          className={`wr-home-surface ${isMapTab ? "wr-home-surface-map" : ""} ${isCategoryView ? "is-category-view" : ""} ${isAddTab ? "is-add-view" : ""} ${isScrolled ? "is-scrolled" : ""}`}
          onScroll={(event) => {
            const target = event.currentTarget;
            setIsScrolled(target.scrollTop > 10);
          }}
          onTouchStart={(event) => {
            const touch = event.touches[0];
            const viewportWidth = window.innerWidth || 390;
            const isLeftEdge = touch.clientX <= 28;
            const isRightEdge = touch.clientX >= viewportWidth - 28;
            if (isLeftEdge) {
              touchStartRef.current = { x: touch.clientX, y: touch.clientY, edge: "left" };
              return;
            }
            if (isRightEdge) {
              touchStartRef.current = { x: touch.clientX, y: touch.clientY, edge: "right" };
            } else {
              touchStartRef.current = null;
            }
            const canPullRefresh =
              !isMapTab &&
              surfaceRef.current &&
              surfaceRef.current.scrollTop <= 0 &&
              touch.clientY <= 112;
            pullStartYRef.current = canPullRefresh ? touch.clientY : null;
            pullDistanceRef.current = 0;
          }}
          onTouchMove={(event) => {
            if (pullStartYRef.current === null) return;
            const deltaY = event.touches[0].clientY - pullStartYRef.current;
            pullDistanceRef.current = Math.max(0, deltaY);
          }}
          onTouchEnd={(event) => {
            if (touchStartRef.current) {
              const touch = event.changedTouches[0];
              const deltaX = touch.clientX - touchStartRef.current.x;
              const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);
              const edge = touchStartRef.current.edge;
              touchStartRef.current = null;
              const isLeftEdgeBack = edge === "left" && deltaX > 56;
              const isRightEdgeBack = edge === "right" && deltaX < -56;
              if ((isLeftEdgeBack || isRightEdgeBack) && deltaY < 48) {
                handleBackGesture();
              }
            }
            if (pullStartYRef.current !== null && pullDistanceRef.current > 72 && !isRefreshing) {
              setIsRefreshing(true);
              window.setTimeout(() => {
                setIsRefreshing(false);
                showToast({ message: "Refreshed", variant: "success", durationMs: 1800 });
              }, 650);
            }
            pullStartYRef.current = null;
            pullDistanceRef.current = 0;
          }}
        >
          {!isMapTab && isRefreshing ? (
            <div className={`wr-pull-refresh-indicator ${isRefreshing ? "is-active" : ""}`} aria-live="polite">
              Refreshing...
            </div>
          ) : null}
          {activeTab !== "Login" && activeTab !== "Map" ? <div className="wr-bg-blob one" /> : null}
          {activeTab !== "Login" && activeTab !== "Map" ? <div className="wr-bg-blob two" /> : null}
          {activeTab !== "Login" && activeTab !== "Map" ? <div className="wr-bg-blob three" /> : null}

          <motion.section
            key={pageKey}
            className={`wr-page-transition-layer ${isMapTab ? "is-map-page" : ""}`}
            initial={
              prefersReducedMotion || activeTab === "Login"
                ? { opacity: 0.98 }
                : { x: transitionDirection > 0 ? 16 : -16, opacity: 0.94 }
            }
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: prefersReducedMotion || activeTab === "Login" ? 0.01 : 0.2, ease: [0.22, 0.61, 0.36, 1] }}
          >
            {page}
          </motion.section>
          {isReadySheetOpen ? (
            <ReadyNotificationsSheet
              items={visibleReadyNotifications}
              onClose={() => setIsReadySheetOpen(false)}
              onReview={openAddForReview}
              onDismissNotification={dismissNotification}
            />
          ) : null}
        </div>
        <BottomNav
          activeTab={activeTab}
          onTabChange={(nextTab) => {
            if (plannerRoute !== "home") {
              setPlannerPath("home", true);
            }
            setTransitionDirection(getTabOrderIndex(nextTab) >= getTabOrderIndex(activeTab) ? 1 : -1);
            if (activeTab === "Map" && mapEntryMode === "category" && mapSourceCategory && nextTab === "Discover") {
              clearHeroNavigationContext();
              setActiveTab("Discover");
              setActiveCategory(mapSourceCategory);
              return;
            }
            if (nextTab === "Map") {
              clearHeroNavigationContext();
              setMapEntryMode("global");
              setMapSourceCategory(null);
            }
            setActiveTab(nextTab);
            setActiveCategory(null);
            if (nextTab !== "Map") {
              clearHeroNavigationContext();
              setMapEntryMode("global");
              setMapSourceCategory(null);
            }
          }}
        />
      </motion.div>
    </div>
  );
}

