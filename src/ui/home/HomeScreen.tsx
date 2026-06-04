import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bell } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { BottomNav } from "./BottomNav";
import { BucketlistSummary } from "./BucketlistSummary";
import { CategoryDetailPage } from "./CategoryDetailPage";
import { AddScreen } from "./AddScreen";
import { HeroCard } from "./HeroCard";
import { LocationSelector } from "./LocationSelector";
import { RecentlyAddedCarousel } from "./RecentlyAddedCarousel";
import { ConnectScreen } from "./ConnectScreen";
import type { CategoryLabel, NavLabel } from "./home.data";
import { runHomeDataChecks } from "./home.data";
import { LoginProfileScreen } from "../profile/LoginProfileScreen";
import { MapScreen } from "../map/MapScreen";
import { useUx } from "../layout/UxProvider";
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
  clearSavedPlacesByCategory,
  createEmptySavedPlacesByCategory,
  flattenSavedPlaces,
  getSavedPlaceCounts,
  mergeSavedPlacesFromApi,
  readSavedPlacesByCategory,
  SAVED_PLACES_UPDATED_EVENT,
  type SavedPlaceApiItem,
  type SavedPlaceRecord,
} from "./savedPlaces";
import "./home.css";

runHomeDataChecks();
const NAV_ORDER: NavLabel[] = ["Discover", "Map", "Add", "Connect", "Login"];
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
const AUTH_SESSION_UPDATED_EVENT = "wr:auth-session-updated";
const ADD_INTELLIGENCE_TIMEOUT_MS = 45000;

type HeroMode = "empty-memory" | "city-memory";
const DEFAULT_DISCOVER_HERO_MODE: HeroMode = "empty-memory";
const DEFAULT_DISCOVER_HERO_TITLE = "Your memories will start here";
const DEFAULT_DISCOVER_HERO_SUBTITLE = "Save places, reels, and ideas to build your city memories.";

function DiscoverPage({
  activeCategory,
  onSelectCategory,
  onViewMap,
  onAddLink,
  onBackCategory,
  notificationCount,
  onNotificationsClick,
  savedPlacesByCategory,
  visibleSavedPlaces,
  heroMode,
}: {
  activeCategory: CategoryLabel | null;
  onSelectCategory: (category: CategoryLabel) => void;
  onViewMap: (category: CategoryLabel) => void;
  onAddLink: () => void;
  onBackCategory: () => void;
  notificationCount: number;
  onNotificationsClick: () => void;
  savedPlacesByCategory: Record<CategoryLabel, SavedPlaceRecord[]>;
  visibleSavedPlaces: SavedPlaceRecord[];
  heroMode: HeroMode;
}) {
  const counts = getSavedPlaceCounts(savedPlacesByCategory);
  const heroTitle = DEFAULT_DISCOVER_HERO_TITLE;
  const heroSubtitle = DEFAULT_DISCOVER_HERO_SUBTITLE;

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
          <HeroCard mode={heroMode} title={heroTitle} subtitle={heroSubtitle} />
          <BucketlistSummary counts={counts} onSelectCategory={onSelectCategory} onAddLink={onAddLink} />
          <RecentlyAddedCarousel places={visibleSavedPlaces} onAddLink={onAddLink} />
        </>
      )}
    </>
  );
}

function ReadyNotificationsSheet({
  items,
  onClose,
  onReview,
}: {
  items: AddReadyNotification[];
  onClose: () => void;
  onReview: (runId: number) => void;
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
  const [activeTab, setActiveTab] = useState<NavLabel>("Discover");
  const [activeCategory, setActiveCategory] = useState<CategoryLabel | null>(null);
  const [mapFocusedCategory, setMapFocusedCategory] = useState<CategoryLabel | null>(null);
  const [savedPlacesByCategory, setSavedPlacesByCategory] = useState(createEmptySavedPlacesByCategory);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [readyNotifications, setReadyNotifications] = useState<AddReadyNotification[]>(() => readReadyNotifications());
  const [isReadySheetOpen, setIsReadySheetOpen] = useState(false);
  const [transitionDirection, setTransitionDirection] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const isPollingAddJobsRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number; edge: "left" | "right" } | null>(null);
  const pullStartYRef = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const isMapTab = activeTab === "Map";
  const isAddTab = activeTab === "Add";
  const isCategoryView = activeTab === "Discover" && activeCategory !== null;
  const pageKey = activeTab === "Discover" && activeCategory ? `Discover-${activeCategory}` : activeTab;
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
  const visibleSavedPlacesByCategory = useMemo(() => {
    if (!isAuthenticated) return createEmptySavedPlacesByCategory();
    return effectiveSavedPlacesByCategory;
  }, [effectiveSavedPlacesByCategory, isAuthenticated]);
  const heroMode: HeroMode = DEFAULT_DISCOVER_HERO_MODE;

  const refreshSavedPlaces = useCallback(() => {
    setSavedPlacesByCategory(isAuthenticated ? readSavedPlacesByCategory() : createEmptySavedPlacesByCategory());
  }, [isAuthenticated]);

  const refreshReadyNotifications = useCallback(() => {
    setReadyNotifications(readReadyNotifications());
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const requestedTab = url.searchParams.get(SHARED_INTENT_TAB_KEY);
    const hasSharedFlag = url.searchParams.get(SHARED_INTENT_QUERY_KEY) === "1";
    if (requestedTab !== SHARED_INTENT_ADD_TAB_VALUE && !hasSharedFlag) return;

    setActiveTab("Add");
    setActiveCategory(null);
    setMapFocusedCategory(null);

    url.searchParams.delete(SHARED_INTENT_TAB_KEY);
    url.searchParams.delete(SHARED_INTENT_QUERY_KEY);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    const handleSharedIntent = () => {
      setTransitionDirection(getTabOrderIndex("Add") >= getTabOrderIndex(activeTab) ? 1 : -1);
      setActiveCategory(null);
      setMapFocusedCategory(null);
      setActiveTab("Add");
    };

    window.addEventListener(SHARED_INTENT_RECEIVED_EVENT, handleSharedIntent);
    return () => window.removeEventListener(SHARED_INTENT_RECEIVED_EVENT, handleSharedIntent);
  }, [activeTab]);

  useEffect(() => {
    const syncAuthState = () => {
      void (async () => {
        try {
          const sessionResponse = await fetch(`${API_BASE_URL}/api/auth/session/me`, { credentials: "include" });
          if (!sessionResponse.ok) {
            setIsAuthenticated(false);
            clearSavedPlacesByCategory();
            setSavedPlacesByCategory(createEmptySavedPlacesByCategory());
            return;
          }
          const sessionPayload = (await sessionResponse.json()) as { ok?: boolean; user?: unknown };
          if (!sessionPayload?.ok || !sessionPayload.user) {
            setIsAuthenticated(false);
            clearSavedPlacesByCategory();
            setSavedPlacesByCategory(createEmptySavedPlacesByCategory());
            return;
          }
          setIsAuthenticated(true);
          setSavedPlacesByCategory(readSavedPlacesByCategory());
          const savedResponse = await fetch(`${API_BASE_URL}/api/saved-places`, { credentials: "include" });
          if (!savedResponse.ok) return;
          const savedPayload = (await savedResponse.json()) as { ok?: boolean; items?: SavedPlaceApiItem[] };
          if (!savedPayload?.ok || !Array.isArray(savedPayload.items)) return;
          mergeSavedPlacesFromApi(savedPayload.items);
        } catch {
          setIsAuthenticated(false);
          clearSavedPlacesByCategory();
          setSavedPlacesByCategory(createEmptySavedPlacesByCategory());
        }
      })();
    };

    window.addEventListener(AUTH_SESSION_UPDATED_EVENT, syncAuthState);
    return () => window.removeEventListener(AUTH_SESSION_UPDATED_EVENT, syncAuthState);
  }, []);

  const openAddForReview = useCallback((runId: number) => {
    setReviewRunId(runId);
    setTransitionDirection(getTabOrderIndex("Add") >= getTabOrderIndex(activeTab) ? 1 : -1);
    setActiveCategory(null);
    setMapFocusedCategory(null);
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
              { source: pending.source, imageUrl: pending.imageUrl, videoUrl: pending.videoUrl, sourceUrl: pending.sourceUrl },
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
    let cancelled = false;
    const syncAuthAndSavedPlaces = async () => {
      try {
        const sessionResponse = await fetch(`${API_BASE_URL}/api/auth/session/me`, { credentials: "include" });
        if (!sessionResponse.ok || cancelled) {
          setIsAuthenticated(false);
          clearSavedPlacesByCategory();
          setSavedPlacesByCategory(createEmptySavedPlacesByCategory());
          return;
        }
        const sessionPayload = (await sessionResponse.json()) as { ok?: boolean; user?: unknown };
        if (!sessionPayload?.ok || !sessionPayload.user || cancelled) {
          setIsAuthenticated(false);
          clearSavedPlacesByCategory();
          setSavedPlacesByCategory(createEmptySavedPlacesByCategory());
          return;
        }

        setIsAuthenticated(true);

        const response = await fetch(`${API_BASE_URL}/api/saved-places`, { credentials: "include" });
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as { ok?: boolean; items?: SavedPlaceApiItem[] };
        if (!payload?.ok || !Array.isArray(payload.items) || cancelled) return;
        mergeSavedPlacesFromApi(payload.items);
      } catch {
        if (cancelled) return;
        setIsAuthenticated(false);
        clearSavedPlacesByCategory();
        setSavedPlacesByCategory(createEmptySavedPlacesByCategory());
      }
    };
    void syncAuthAndSavedPlaces();
    return () => {
      cancelled = true;
    };
  }, []);

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
      setTransitionDirection(-1);
      setActiveCategory(null);
      return;
    }

    if (activeTab === "Map") {
      setTransitionDirection(-1);
      setActiveTab("Discover");
      if (mapFocusedCategory) {
        setActiveCategory(mapFocusedCategory);
      } else {
        setActiveCategory(null);
      }
      return;
    }

    if (activeTab !== "Discover") {
      setTransitionDirection(-1);
      setActiveTab("Discover");
      setActiveCategory(null);
      setMapFocusedCategory(null);
    }
  };

  const page = useMemo(() => {
    if (activeTab === "Discover") {
      return (
        <DiscoverPage
          activeCategory={activeCategory}
          onSelectCategory={setActiveCategory}
          onBackCategory={() => {
            setTransitionDirection(-1);
            setActiveCategory(null);
          }}
          onAddLink={() => {
            setTransitionDirection(1);
            setActiveCategory(null);
            setActiveTab("Add");
          }}
          notificationCount={readyNotifications.length}
          onNotificationsClick={() => setIsReadySheetOpen(true)}
          savedPlacesByCategory={visibleSavedPlacesByCategory}
          visibleSavedPlaces={visibleSavedPlaces}
          heroMode={heroMode}
          onViewMap={(category) => {
            setTransitionDirection(1);
            setMapFocusedCategory(category);
            setActiveCategory(null);
            setActiveTab("Map");
          }}
        />
      );
    }

    if (activeTab === "Map") {
      return (
        <MapScreen
          focusedCategory={mapFocusedCategory}
          savedPlaces={allSavedPlaces}
          onAddLink={() => {
            setTransitionDirection(1);
            setActiveTab("Add");
            setActiveCategory(null);
          }}
          onBack={() => {
            setTransitionDirection(-1);
            setActiveTab("Discover");
            if (mapFocusedCategory) {
              setActiveCategory(mapFocusedCategory);
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
            setTransitionDirection(-1);
            setActiveCategory(null);
            setMapFocusedCategory(null);
            setActiveTab("Discover");
          }}
        />
      );
    }

    return <LoginProfileScreen />;
  }, [
    activeCategory,
    activeTab,
    heroMode,
    mapFocusedCategory,
    readyNotifications.length,
    visibleSavedPlaces,
    visibleSavedPlacesByCategory,
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
              items={readyNotifications}
              onClose={() => setIsReadySheetOpen(false)}
              onReview={openAddForReview}
            />
          ) : null}
        </div>
        <BottomNav
          activeTab={activeTab}
          onTabChange={(nextTab) => {
            setTransitionDirection(getTabOrderIndex(nextTab) >= getTabOrderIndex(activeTab) ? 1 : -1);
            if (activeTab === "Map" && mapFocusedCategory && nextTab === "Discover") {
              setActiveTab("Discover");
              setActiveCategory(mapFocusedCategory);
              return;
            }
            setActiveTab(nextTab);
            setActiveCategory(null);
            if (nextTab !== "Map") {
              setMapFocusedCategory(null);
            }
          }}
        />
      </motion.div>
    </div>
  );
}

