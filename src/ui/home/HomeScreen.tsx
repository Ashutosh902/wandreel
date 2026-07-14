import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bell } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { BottomNav } from "./BottomNav";
import { BucketlistSummary } from "./BucketlistSummary";
import { CategoryDetailPage } from "./CategoryDetailPage";
import { AddScreen } from "./AddScreen";
import { FoodTrailScreen } from "./FoodTrailScreen";
import { HeroStrollTransitionCoordinator } from "./HeroStrollTransitionCoordinator";
import {
  buildHeroStrollTransitionPlan,
  captureHeroStrollTransitionSource,
  createHeroStrollTransitionCoordinator,
  resolveReadyHeroStroll,
  type HeroStrollTransitionSource,
  type HeroStrollTransitionRequest,
  type HeroTransitionCardMode,
} from "./heroStrollTransition";
import {
  createFoodTrailDemoPlaces,
  FOOD_TRAIL_DEMO_QUERY_PARAM,
} from "./foodTrailPlannerDemo";
import { normalizeHeroCardContent } from "./heroCardContent";
import { HeroCard } from "./HeroCard";
import { LocationSelector } from "./LocationSelector";
import { RecentlyAddedCarousel } from "./RecentlyAddedCarousel";
import { WeekendPlannerScreen } from "./WeekendPlannerScreen";
import { ConnectScreen } from "./ConnectScreen";
import { StrollLibrarySection } from "./StrollLibrarySection";
import type { CategoryLabel, NavLabel } from "./home.data";
import { runHomeDataChecks } from "./home.data";
import { LoginProfileScreen } from "../profile/LoginProfileScreen";
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
  addReadyNotification,
  mapEntitiesToPlaces,
  readPersistedAddDraft,
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
import { filterPlacesByResolvedCity, resolveLocationContext } from "./locationContext";
import { isWeekendPlannerAction } from "./weekendPlanner";
import { createWeekendPlannerDemoPlaces } from "./weekendPlannerDemo";
import {
  getStrollDetailRoute,
  getStrollEditRoute,
  getStrollIdFromPlannerRoute,
} from "./homeNavigation";
import {
  canShowManualStrollEntry,
  fetchStrollOnboarding,
  shouldShowStrollOnboardingPrompt,
  updateStrollOnboardingDecision,
  type DraftStrollSeed,
  type DraftStrollSummary,
  type StrollOnboardingDecision,
} from "./strollOnboarding";
import type { PersistentStrollSummary, StrollLibraryLoadState } from "./strollLibrary";
import { deriveHeroCardKey, useHeroCard, type HeroCardData } from "./useHeroCard";
import { useHeroBookmarks } from "./useHeroBookmarks";
import { useDialogFocus } from "./useDialogFocus";
import { useHomeGestures } from "./useHomeGestures";
import { useHomeNavigation } from "./useHomeNavigation";
import { useReadyNotifications } from "./useReadyNotifications";
import { useStrollLibrary } from "./useStrollLibrary";
import { fetchStrollDetail } from "./strollLibrary";
import "./home.css";

runHomeDataChecks();
const NAV_ORDER: NavLabel[] = ["Discover", "Map", "Add", "Connect", "Login"];
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
const ADD_INTELLIGENCE_TIMEOUT_MS = 120000;
const IS_DEV = import.meta.env.DEV;

const LazyMapScreen = lazy(() => import("../map/MapScreen").then((module) => ({ default: module.MapScreen })));
const LazyStrollCreateScreen = lazy(() => import("./StrollCreateScreen").then((module) => ({ default: module.StrollCreateScreen })));
const LazyStrollDraftEditorScreen = lazy(() => import("./StrollDraftEditorScreen").then((module) => ({ default: module.StrollDraftEditorScreen })));
const LazyStrollDetailScreen = lazy(() => import("./StrollDetailScreen").then((module) => ({ default: module.StrollDetailScreen })));

type HeroMode = "empty-memory" | "city-memory";
type HeroNavigationContext = {
  filteredPlaceIds: string[] | null;
  filteredCity: string | null;
  mapPlaces: SavedPlaceRecord[] | null;
  mapCategories: CategoryLabel[] | null;
};

type FoodTrailPlannerContext = {
  matchingPlaceIds: string[] | null;
};

type WeekendPlannerContext = {
  matchingPlaceIds: string[] | null;
  cityName: string | null;
};


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
  heroBookmarkKeys,
  pendingHeroBookmarkCardKey,
  onHeroBookmarkToggle,
  showStrollLibrary,
  strolls,
  strollLibraryState,
  strollLibraryError,
  retryingStrollId,
  archivingStrollId,
  onCreateStroll,
  onRetryStroll,
  onArchiveStroll,
  onOpenStroll,
  onStartStroll,
  currentLocationLabel,
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
  onHeroCta: (card: HeroCardData, source: HeroStrollTransitionSource | null, mode: HeroTransitionCardMode) => void;
  heroBookmarkKeys: string[];
  pendingHeroBookmarkCardKey: string | null;
  onHeroBookmarkToggle: (card: HeroCardData) => void;
  showStrollLibrary: boolean;
  strolls: PersistentStrollSummary[];
  strollLibraryState: StrollLibraryLoadState;
  strollLibraryError: string | null;
  retryingStrollId: string | null;
  archivingStrollId: string | null;
  onCreateStroll: () => void;
  onRetryStroll: (strollId: string) => void;
  onArchiveStroll: (strollId: string) => void;
  onOpenStroll: (stroll: PersistentStrollSummary) => void;
  onStartStroll: (stroll: PersistentStrollSummary) => void;
  currentLocationLabel: string;
}) {
  const heroCardRef = useRef<HTMLElement | null>(null);
  const counts = getSavedPlaceCounts(savedPlacesByCategory);
  const displayHeroCard = heroCard ? normalizeHeroCardContent(heroCard, currentLocationLabel, flattenSavedPlaces(savedPlacesByCategory)) : null;
  const displayHeroCardKey = displayHeroCard ? deriveHeroCardKey(displayHeroCard) : null;
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
          {displayHeroCard ? (
            <HeroCard
              mode={heroMode}
              title={displayHeroCard.title}
              subtitle={displayHeroCard.subtitle}
              ctaLabel={displayHeroCard.ctaLabel}
              onCtaClick={() => onHeroCta(
                displayHeroCard,
                captureHeroStrollTransitionSource({
                  element: heroCardRef.current,
                  mode: heroMode,
                  card: displayHeroCard,
                }),
                heroMode,
              )}
              isBookmarked={displayHeroCardKey ? heroBookmarkKeys.includes(displayHeroCardKey) : false}
              isBookmarkBusy={displayHeroCardKey ? pendingHeroBookmarkCardKey === displayHeroCardKey : false}
              onBookmarkToggle={() => onHeroBookmarkToggle(displayHeroCard)}
              containerRef={heroCardRef}
            />
          ) : null}
          {showStrollLibrary ? (
            <StrollLibrarySection
              strolls={strolls}
              loadState={strollLibraryState}
              error={strollLibraryError}
              retryingStrollId={retryingStrollId}
              archivingStrollId={archivingStrollId}
              onCreateStroll={onCreateStroll}
              onRetryStroll={onRetryStroll}
              onArchiveStroll={onArchiveStroll}
              onOpenStroll={onOpenStroll}
              onStartStroll={onStartStroll}
            />
          ) : null}
          <BucketlistSummary counts={counts} onSelectCategory={onSelectCategory} onAddLink={onAddLink} />
          <RecentlyAddedCarousel places={recentSavedPlaces} onAddLink={onAddLink} />
        </>
      )}
    </>
  );
}

function StrollOnboardingPrompt({
  isBusy,
  onAccept,
  onDecline,
}: {
  isBusy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLElement>(true, onDecline);

  return (
    <div className="wr-stroll-prompt-layer" role="presentation">
      <section
        ref={dialogRef}
        className="wr-stroll-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wr-stroll-prompt-title"
        aria-describedby="wr-stroll-prompt-description"
        tabIndex={-1}
      >
        <p>NEW PLANNER</p>
        <h3 id="wr-stroll-prompt-title">Want Wandreel to shape your saved places into Strolls?</h3>
        <span id="wr-stroll-prompt-description">We will start with a draft you control. No auto-curation or map route yet.</span>
        <div className="wr-stroll-prompt-actions">
          <button type="button" className="wr-stroll-prompt-secondary" disabled={isBusy} onClick={onDecline}>
            Not now
          </button>
          <button type="button" className="wr-stroll-prompt-primary" disabled={isBusy} onClick={onAccept}>
            {isBusy ? "Saving..." : "Create a Stroll"}
          </button>
        </div>
      </section>
    </div>
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
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);

  return (
    <div className="wr-ready-sheet-layer" role="presentation">
      <button type="button" className="wr-ready-sheet-backdrop" aria-label="Close notifications" onClick={onClose} />
      <section
        ref={dialogRef}
        className="wr-ready-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wr-ready-sheet-title"
        tabIndex={-1}
      >
        <div className="wr-ready-sheet-head">
          <div>
            <p>READY TO SAVE</p>
            <h3 id="wr-ready-sheet-title">Your Wandreels</h3>
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

function normalizeCreatedStrollSummary(stroll: DraftStrollSummary): PersistentStrollSummary {
  const full = stroll as Partial<PersistentStrollSummary>;
  return {
    id: stroll.id,
    name: stroll.name,
    description: full.description ?? null,
    city: stroll.city,
    status: stroll.status,
    source: stroll.source,
    startDate: full.startDate ?? null,
    endDate: full.endDate ?? null,
    requestedStartTime: full.requestedStartTime ?? null,
    travellerCount: full.travellerCount ?? null,
    interests: full.interests ?? [],
    latitude: full.latitude ?? null,
    longitude: full.longitude ?? null,
    totalDistanceMeters: full.totalDistanceMeters ?? null,
    estimatedDurationMinutes: full.estimatedDurationMinutes ?? null,
    stopCount: stroll.stopCount,
    failureCode: full.failureCode ?? null,
    failureMessage: full.failureMessage ?? null,
    createdAt: stroll.createdAt,
    updatedAt: stroll.updatedAt,
    curatedAt: full.curatedAt ?? null,
    archivedAt: full.archivedAt ?? null,
  };
}

export function HomeScreen() {
  const prefersReducedMotion = useReducedMotion();
  const { currentLocationLabel, isLocating, requestCurrentLocation, searchLocations, showToast } = useUx();
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
  const {
    plannerRoute,
    setPlannerPath,
    isFoodTrailDemoPreview,
    isWeekendPlannerDemoPreview,
  } = useHomeNavigation({
    isDev: IS_DEV,
    foodTrailDemoQueryParam: FOOD_TRAIL_DEMO_QUERY_PARAM,
  });
  const [foodTrailPlannerContext, setFoodTrailPlannerContext] = useState<FoodTrailPlannerContext>({
    matchingPlaceIds: null,
  });
  const [weekendPlannerContext, setWeekendPlannerContext] = useState<WeekendPlannerContext>({
    matchingPlaceIds: null,
    cityName: null,
  });
  const [heroNavigationContext, setHeroNavigationContext] = useState<HeroNavigationContext>({
    filteredPlaceIds: null,
    filteredCity: null,
    mapPlaces: null,
    mapCategories: null,
  });
  const [isReadySheetOpen, setIsReadySheetOpen] = useState(false);
  const [strollOnboardingDecision, setStrollOnboardingDecision] = useState<StrollOnboardingDecision | null>(null);
  const [isStrollPromptDismissed, setIsStrollPromptDismissed] = useState(false);
  const [strollOnboardingAction, setStrollOnboardingAction] = useState<"accept" | "decline" | null>(null);
  const [transitionDirection, setTransitionDirection] = useState(1);
  const [isScrolled, setIsScrolled] = useState(false);
  const [heroStrollTransition, setHeroStrollTransition] = useState<HeroStrollTransitionRequest | null>(null);
  const [pendingDraftSeeds, setPendingDraftSeeds] = useState<Record<string, DraftStrollSeed>>({});
  const [pendingDraftSummaries, setPendingDraftSummaries] = useState<Record<string, DraftStrollSummary>>({});
  const isPollingAddJobsRef = useRef(false);
  const heroStrollTransitionCoordinatorRef = useRef(
    createHeroStrollTransitionCoordinator({
      onSettled: (key) => {
        setHeroStrollTransition((current) => (current?.key === key ? null : current));
      },
    }),
  );
  const isMapTab = activeTab === "Map";
  const isAddTab = activeTab === "Add";
  const isCategoryView = activeTab === "Discover" && activeCategory !== null;
  const isFoodTrailRoute = plannerRoute === "food-trail";
  const pageKey = isFoodTrailRoute
    ? "trail-food"
    : plannerRoute === "stroll-create"
      ? "stroll-create"
    : plannerRoute.startsWith("stroll-edit:")
      ? `stroll-edit-${getStrollIdFromPlannerRoute(plannerRoute) || "missing"}`
    : plannerRoute.startsWith("stroll-detail:")
      ? `stroll-detail-${getStrollIdFromPlannerRoute(plannerRoute) || "missing"}`
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
  const {
    visibleReadyNotifications,
    refreshReadyNotifications,
    dismissNotification,
  } = useReadyNotifications();
  const { heroCard } = useHeroCard({
    apiBaseUrl: API_BASE_URL,
    currentLocationLabel,
    isAuthenticated,
    userId: sessionUser?.userId ?? null,
    visibleSavedPlaces,
  });
  const {
    heroBookmarkKeys,
    pendingHeroBookmarkCardKey,
    handleHeroBookmarkToggle,
  } = useHeroBookmarks<HeroCardData>({
    apiBaseUrl: API_BASE_URL,
    isAuthenticated,
    userId: sessionUser?.userId ?? null,
    showToast,
    deriveCardKey: deriveHeroCardKey,
    buildBookmarkPayload: (card, cardKey) => ({
      cardKey,
      heroType: card.type,
      ctaAction: card.ctaAction,
      title: card.title,
      subtitle: card.subtitle,
      metadata: card.metadata || {},
    }),
  });
  const {
    strolls,
    strollLibraryState,
    strollLibraryError,
    retryingStrollId,
    archivingStrollId,
    refreshStrollLibrary,
    mergeLocalStroll,
    handleRetryStroll,
    handleArchiveStroll,
  } = useStrollLibrary({
    apiBaseUrl: API_BASE_URL,
    isAuthenticated,
    userId: sessionUser?.userId ?? null,
    showToast,
  });
  const clearHeroNavigationContext = useCallback(() => {
    setHeroNavigationContext({
      filteredPlaceIds: null,
      filteredCity: null,
      mapPlaces: null,
      mapCategories: null,
    });
  }, []);
  const openStrollCreate = useCallback(() => {
    setHeroStrollTransition(null);
    clearHeroNavigationContext();
    setTransitionDirection(1);
    setActiveTab("Discover");
    setActiveCategory(null);
    setMapEntryMode("global");
    setMapSourceCategory(null);
    setPlannerPath("stroll-create");
  }, [clearHeroNavigationContext, setPlannerPath]);

  const refreshSavedPlaces = useCallback(() => {
    setSavedPlacesByCategory(isAuthenticated ? readSavedPlacesByCategory() : createEmptySavedPlacesByCategory());
  }, [isAuthenticated]);

  useEffect(() => {
    const transitionCoordinator = heroStrollTransitionCoordinatorRef.current;
    return () => {
      transitionCoordinator.destroy();
    };
  }, []);

  useEffect(() => {
    if (!heroStrollTransition) return;
    heroStrollTransitionCoordinatorRef.current.arm(heroStrollTransition);
  }, [heroStrollTransition]);

  useEffect(() => {
    if (!heroStrollTransition) return;
    const activeStrollId = getStrollIdFromPlannerRoute(plannerRoute);
    if (!plannerRoute.startsWith("stroll-detail:") || activeStrollId !== heroStrollTransition.strollId) {
      setHeroStrollTransition(null);
    }
  }, [heroStrollTransition, plannerRoute]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let cancelled = false;
    fetchStrollOnboarding(API_BASE_URL)
      .then((onboarding) => {
        if (!cancelled) {
          setStrollOnboardingDecision(onboarding.decision);
          setIsStrollPromptDismissed(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStrollOnboardingDecision(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, sessionUser?.userId]);

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
    setHeroStrollTransition(null);
    setReviewRunId(runId);
    setTransitionDirection(getTabOrderIndex("Add") >= getTabOrderIndex(activeTab) ? 1 : -1);
    setActiveCategory(null);
    setMapEntryMode("global");
    setMapSourceCategory(null);
    setActiveTab("Add");
    setIsReadySheetOpen(false);
  }, [activeTab]);
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
    if (!isAuthenticated) {
      setSavedPlacesByCategory(createEmptySavedPlacesByCategory());
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

  const handleBackGesture = useCallback(() => {
    if (activeTab === "Discover" && activeCategory) {
      clearHeroNavigationContext();
      setTransitionDirection(-1);
      setActiveCategory(null);
      return;
    }

    if (plannerRoute === "food-trail") {
      setHeroStrollTransition(null);
      setTransitionDirection(-1);
      setPlannerPath("home", true);
      return;
    }

    if (plannerRoute === "stroll-create") {
      setHeroStrollTransition(null);
      setTransitionDirection(-1);
      setPlannerPath("home", true);
      return;
    }

    if (plannerRoute.startsWith("stroll-edit:")) {
      setHeroStrollTransition(null);
      setTransitionDirection(-1);
      setPlannerPath("home", true);
      return;
    }

    if (plannerRoute.startsWith("stroll-detail:")) {
      setHeroStrollTransition(null);
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
  }, [activeCategory, activeTab, clearHeroNavigationContext, mapEntryMode, mapSourceCategory, plannerRoute, setPlannerPath]);

  const {
    isRefreshing,
    surfaceRef,
    touchHandlers,
  } = useHomeGestures({
    isMapTab,
    onBackGesture: handleBackGesture,
    showToast,
  });

  const isStrollPromptEligible = shouldShowStrollOnboardingPrompt({
    isAuthenticated,
    decision: strollOnboardingDecision,
    activeTab,
    activeCategory,
    plannerRoute,
    isReadySheetOpen,
    isPromptDismissed: isStrollPromptDismissed,
  });

  const showManualStrollEntry = canShowManualStrollEntry({
    isAuthenticated,
    activeTab,
    activeCategory,
  });

  const handleStrollOnboardingAccept = async () => {
    if (strollOnboardingAction) return;
    setStrollOnboardingAction("accept");
    try {
      const onboarding = await updateStrollOnboardingDecision(API_BASE_URL, "accepted");
      setStrollOnboardingDecision(onboarding.decision);
      setIsStrollPromptDismissed(true);
      openStrollCreate();
    } catch {
      showToast({ message: "Could not save Stroll preference. Try again.", variant: "error", durationMs: 2600 });
    } finally {
      setStrollOnboardingAction(null);
    }
  };

  const handleStrollOnboardingDecline = async () => {
    if (strollOnboardingAction) return;
    setStrollOnboardingAction("decline");
    try {
      const onboarding = await updateStrollOnboardingDecision(API_BASE_URL, "declined");
      setStrollOnboardingDecision(onboarding.decision);
      setIsStrollPromptDismissed(true);
    } catch {
      showToast({ message: "Could not save Stroll preference. Try again.", variant: "error", durationMs: 2600 });
    } finally {
      setStrollOnboardingAction(null);
    }
  };

  const handleStartStroll = useCallback((stroll: PersistentStrollSummary) => {
    setHeroStrollTransition(null);
    clearHeroNavigationContext();
    setTransitionDirection(1);
    setActiveTab("Discover");
    setActiveCategory(null);
    setMapEntryMode("global");
    setMapSourceCategory(null);
    setPlannerPath(getStrollDetailRoute(stroll.id));
  }, [clearHeroNavigationContext, setPlannerPath]);

  const handleOpenStroll = useCallback((stroll: PersistentStrollSummary) => {
    setHeroStrollTransition(null);
    clearHeroNavigationContext();
    setTransitionDirection(1);
    setActiveTab("Discover");
    setActiveCategory(null);
    setMapEntryMode("global");
    setMapSourceCategory(null);
    setPlannerPath(getStrollEditRoute(stroll.id));
  }, [clearHeroNavigationContext, setPlannerPath]);

  const handleCreateStrollDraft = useCallback((input: {
    stroll: DraftStrollSummary;
    seed: DraftStrollSeed;
    mode: "draft" | "generate";
    curationStarted: boolean;
  }) => {
    const { stroll, seed, mode, curationStarted } = input;
    setPendingDraftSeeds((current) => ({ ...current, [stroll.id]: seed }));
    setPendingDraftSummaries((current) => ({ ...current, [stroll.id]: stroll }));
    mergeLocalStroll(normalizeCreatedStrollSummary(stroll));
    showToast({
      message: mode === "generate"
        ? curationStarted
          ? `${stroll.name} is being prepared.`
          : `${stroll.name} saved. Start generation from the card.`
        : `${stroll.name} saved as a draft.`,
      variant: mode === "generate" && !curationStarted ? "info" : "success",
      durationMs: 2600,
    });
    setTransitionDirection(-1);
    setPlannerPath("home", true);
    void refreshStrollLibrary({ silent: true });
  }, [mergeLocalStroll, refreshStrollLibrary, setPlannerPath, showToast]);

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
    if (isFoodTrailDemoPreview) {
      return createFoodTrailDemoPlaces();
    }
    if (!foodTrailPlannerContext.matchingPlaceIds?.length) {
      return visibleSavedPlacesByCategory.Taste;
    }
    const allowedIds = new Set(foodTrailPlannerContext.matchingPlaceIds);
    return visibleSavedPlacesByCategory.Taste.filter((place) => allowedIds.has(String(place.placeId || place.id || "").trim()));
  }, [foodTrailPlannerContext.matchingPlaceIds, isFoodTrailDemoPreview, visibleSavedPlacesByCategory]);
  const weekendPlannerPlaces = useMemo(() => {
    if (isWeekendPlannerDemoPreview) {
      return createWeekendPlannerDemoPlaces();
    }
    if (!weekendPlannerContext.matchingPlaceIds?.length) {
      return filterPlacesByResolvedCity(visibleSavedPlaces, currentLocationLabel, weekendPlannerContext.cityName).places;
    }
    const allowedIds = new Set(weekendPlannerContext.matchingPlaceIds);
    return visibleSavedPlaces.filter((place) => allowedIds.has(String(place.placeId || place.id || "").trim()));
  }, [currentLocationLabel, isWeekendPlannerDemoPreview, visibleSavedPlaces, weekendPlannerContext.cityName, weekendPlannerContext.matchingPlaceIds]);

  const page = useMemo(() => {
    if (plannerRoute === "food-trail") {
      return (
        <FoodTrailScreen
          savedPlaces={foodTrailPlannerPlaces}
          isDemoPreview={isFoodTrailDemoPreview}
          onBack={() => {
            setTransitionDirection(-1);
            setPlannerPath("home", true);
          }}
          onAddTaste={() => {
            setTransitionDirection(1);
            setPlannerPath("home", true);
            setActiveCategory(null);
            setActiveTab("Add");
          }}
        />
      );
    }

    if (plannerRoute === "weekend-plan") {
      return (
        <WeekendPlannerScreen
          savedPlaces={weekendPlannerPlaces}
          cityName={
            isWeekendPlannerDemoPreview
              ? "Patna"
              : weekendPlannerContext.cityName ||
                resolveLocationContext(currentLocationLabel, visibleSavedPlaces).cityName ||
                resolveLocationContext(currentLocationLabel, visibleSavedPlaces).localityName ||
                "Your city"
          }
          isDemoPreview={isWeekendPlannerDemoPreview}
          onBack={() => {
            setTransitionDirection(-1);
            setPlannerPath("home", true);
          }}
          onAddPlaces={() => {
            setTransitionDirection(1);
            setPlannerPath("home", true);
            setActiveCategory(null);
            setActiveTab("Add");
          }}
        />
      );
    }

    if (plannerRoute === "stroll-create") {
      return (
          <LazyStrollCreateScreen
            currentLocationLabel={currentLocationLabel}
            isLocating={isLocating}
            searchLocations={searchLocations}
            requestCurrentLocation={requestCurrentLocation}
            onBack={() => {
            setTransitionDirection(-1);
            setPlannerPath("home", true);
          }}
          onCreated={handleCreateStrollDraft}
        />
      );
    }

    if (plannerRoute.startsWith("stroll-edit:")) {
      const strollId = getStrollIdFromPlannerRoute(plannerRoute);
      return strollId ? (
          <LazyStrollDraftEditorScreen
          strollId={strollId}
          seed={pendingDraftSeeds[strollId] ?? null}
          initialStrollSummary={pendingDraftSummaries[strollId] ?? null}
          currentLocationLabel={currentLocationLabel}
          searchLocations={searchLocations}
          onBack={() => {
            setHeroStrollTransition(null);
            setTransitionDirection(-1);
            setPlannerPath("home", true);
          }}
          onStartStroll={handleStartStroll}
          onArchiveComplete={() => {
            setPendingDraftSeeds((current) => {
              const next = { ...current };
              delete next[strollId];
              return next;
            });
            setPendingDraftSummaries((current) => {
              const next = { ...current };
              delete next[strollId];
              return next;
            });
            setTransitionDirection(-1);
            setPlannerPath("home", true);
            void refreshStrollLibrary({ silent: true });
          }}
        />
      ) : null;
    }

    if (plannerRoute.startsWith("stroll-detail:")) {
      const strollId = getStrollIdFromPlannerRoute(plannerRoute);
      return strollId ? (
        <LazyStrollDetailScreen
          strollId={strollId}
          userId={sessionUser?.userId ?? null}
          allowInitialJourneyMotionStart={heroStrollTransition?.strollId !== strollId}
          onBack={() => {
            setHeroStrollTransition(null);
            setTransitionDirection(-1);
            setPlannerPath("home", true);
          }}
        />
      ) : null;
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
          currentLocationLabel={currentLocationLabel}
          heroBookmarkKeys={heroBookmarkKeys}
          pendingHeroBookmarkCardKey={pendingHeroBookmarkCardKey}
          onHeroBookmarkToggle={handleHeroBookmarkToggle}
          showStrollLibrary={showManualStrollEntry}
          strolls={strolls}
          strollLibraryState={strollLibraryState}
          strollLibraryError={strollLibraryError}
          retryingStrollId={retryingStrollId}
          archivingStrollId={archivingStrollId}
          onCreateStroll={openStrollCreate}
          onRetryStroll={handleRetryStroll}
          onArchiveStroll={handleArchiveStroll}
          onOpenStroll={handleOpenStroll}
          onStartStroll={handleStartStroll}
          onHeroCta={(card, source) => {
            console.info("[hero-card] selected action", card.ctaAction, card.metadata);
            const plannerSelection = resolveHeroCardPlannerSelection(
              card,
              createLocalSavedPlacesPlannerDataSource(visibleSavedPlaces),
            );
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

            const openWeekendPlanFromHero = (sourcePlaces: SavedPlaceRecord[]) => {
              if (!sourcePlaces.length) {
                showToast({ message: "No matching saved places found for this city plan yet.", variant: "info", durationMs: 2200 });
                return;
              }
              const sourcePlaceIds = sourcePlaces.map((place) => String(place.placeId || place.id || "").trim()).filter(Boolean);
              const resolvedCityName = filterPlacesByResolvedCity(
                sourcePlaces,
                currentLocationLabel,
                plannerSelection.targetCity,
              ).cityName || plannerSelection.targetCity || null;
              setWeekendPlannerContext({
                matchingPlaceIds: sourcePlaceIds.length ? sourcePlaceIds : null,
                cityName: resolvedCityName,
              });
              clearHeroNavigationContext();
              setHeroStrollTransition(null);
              setTransitionDirection(1);
              setActiveCategory(null);
              setActiveTab("Discover");
              setPlannerPath("weekend-plan");
            };

            const runFallbackHeroAction = () => {
              if (card.ctaAction === "add_first_place" || card.ctaAction === "grow_saved_places") {
                setHeroStrollTransition(null);
                clearHeroNavigationContext();
                setTransitionDirection(1);
                setActiveCategory(null);
                setActiveTab("Add");
                return;
              }

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
                  setHeroStrollTransition(null);
                  setTransitionDirection(1);
                  setActiveTab("Discover");
                  setActiveCategory(null);
                  setPlannerPath("food-trail");
                  return;
                }
                openCategoryFromHero("Taste", plannerSelection.getCategoryPlaces("Taste"));
                return;
              }

              if (isWeekendPlannerAction(card.ctaAction, plannerSelection.targetCategory)) {
                openWeekendPlanFromHero(plannerSelection.getCityPlaces());
                return;
              }

              if (card.ctaAction === "view_dominant_category" && plannerSelection.targetCategory) {
                openCategoryFromHero(plannerSelection.targetCategory, plannerSelection.getCategoryPlaces(plannerSelection.targetCategory));
                return;
              }

              showToast({ message: `${card.ctaLabel} coming soon`, variant: "success", durationMs: 1800 });
            };

            const attemptReadyHeroTransition = async () => {
              const readyHeroStroll = await resolveReadyHeroStroll({
                card,
                strolls,
                strollLibraryState,
                verifyStroll: async (strollId) => {
                  try {
                    return await fetchStrollDetail(API_BASE_URL, strollId);
                  } catch {
                    return null;
                  }
                },
              });
              const heroReadyStrollPlan = readyHeroStroll
                ? buildHeroStrollTransitionPlan({
                    card,
                    strolls: [readyHeroStroll],
                    source,
                    prefersReducedMotion: Boolean(prefersReducedMotion),
                  })
                : null;

              if (!heroReadyStrollPlan) {
                runFallbackHeroAction();
                return;
              }

              clearHeroNavigationContext();
              setTransitionDirection(1);
              setActiveTab("Discover");
              setActiveCategory(null);
              setMapEntryMode("global");
              setMapSourceCategory(null);
              if (heroReadyStrollPlan.kind === "transition" && heroReadyStrollPlan.source) {
                setHeroStrollTransition({
                  key: `${heroReadyStrollPlan.strollId}:${Date.now()}`,
                  strollId: heroReadyStrollPlan.strollId,
                  source: heroReadyStrollPlan.source,
                  durationMs: heroReadyStrollPlan.durationMs,
                  reducedMotion: heroReadyStrollPlan.reducedMotion,
                });
              } else {
                setHeroStrollTransition(null);
              }
              setPlannerPath(getStrollDetailRoute(heroReadyStrollPlan.strollId));
            };

            void attemptReadyHeroTransition();
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
        <LazyMapScreen
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
    weekendPlannerPlaces,
    weekendPlannerContext.cityName,
    isFoodTrailDemoPreview,
    isWeekendPlannerDemoPreview,
    isLocating,
    activeCategory,
    activeTab,
    allSavedPlaces,
    clearHeroNavigationContext,
    globalMapActiveCategories,
    heroFilteredPlacesByCategory,
    heroCard,
    heroBookmarkKeys,
    heroStrollTransition?.strollId,
    heroNavigationContext.mapCategories,
    heroNavigationContext.mapPlaces,
    handleHeroBookmarkToggle,
    handleArchiveStroll,
    handleCreateStrollDraft,
    handleOpenStroll,
    handleRetryStroll,
    handleStartStroll,
    mapEntryMode,
    mapSourceCategory,
    openStrollCreate,
    pendingHeroBookmarkCardKey,
    pendingDraftSeeds,
    pendingDraftSummaries,
    visibleReadyNotifications.length,
    recentSavedPlaces,
    requestCurrentLocation,
    refreshStrollLibrary,
    showToast,
    showManualStrollEntry,
    strollLibraryError,
    strollLibraryState,
      strolls,
      retryingStrollId,
      currentLocationLabel,
      searchLocations,
      prefersReducedMotion,
    visibleSavedPlaces,
    visibleSavedPlacesByCategory,
    plannerRoute,
    setPlannerPath,
    archivingStrollId,
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
          {...touchHandlers}
        >
          {!isMapTab && isRefreshing ? (
            <div className={`wr-pull-refresh-indicator ${isRefreshing ? "is-active" : ""}`} aria-live="polite">
              Refreshing...
            </div>
          ) : null}
          {activeTab !== "Login" && activeTab !== "Map" ? <div className="wr-bg-blob one" /> : null}
          {activeTab !== "Login" && activeTab !== "Map" ? <div className="wr-bg-blob two" /> : null}
          {activeTab !== "Login" && activeTab !== "Map" ? <div className="wr-bg-blob three" /> : null}
          <HeroStrollTransitionCoordinator transition={heroStrollTransition} />

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
            <Suspense fallback={<div className="wr-page-loading" aria-live="polite">Loading...</div>}>
              {page}
            </Suspense>
          </motion.section>
          {isReadySheetOpen ? (
            <ReadyNotificationsSheet
              items={visibleReadyNotifications}
              onClose={() => setIsReadySheetOpen(false)}
              onReview={openAddForReview}
              onDismissNotification={dismissNotification}
            />
          ) : null}
          {isStrollPromptEligible ? (
            <StrollOnboardingPrompt
              isBusy={strollOnboardingAction !== null}
              onAccept={() => void handleStrollOnboardingAccept()}
              onDecline={() => void handleStrollOnboardingDecline()}
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

