import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Bell } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { BottomNav } from "./BottomNav";
import { BucketlistSummary } from "./BucketlistSummary";
import { CategoryDetailPage } from "./CategoryDetailPage";
import { AddScreen } from "./AddScreen";
import { HeroCard } from "./HeroCard";
import { LocationSelector } from "./LocationSelector";
import { RecentlyAddedCarousel } from "./RecentlyAddedCarousel";
import type { CategoryLabel, NavLabel } from "./home.data";
import { runHomeDataChecks } from "./home.data";
import { LoginProfileScreen } from "../profile/LoginProfileScreen";
import { MapScreen } from "../map/MapScreen";
import { useUx } from "../layout/UxProvider";
import "./home.css";

runHomeDataChecks();
const NAV_ORDER: NavLabel[] = ["Discover", "Map", "Add", "Connect", "Login"];

function PlaceholderPage({
  title,
  message,
  fullHeight = false,
}: {
  title: string;
  message: string;
  fullHeight?: boolean;
}) {
  return (
    <section
      className={`wr-tab-placeholder ${fullHeight ? "wr-tab-placeholder-full" : ""}`}
      aria-label={`${title} page`}
    >
      <h2>{title}</h2>
      <p>{message}</p>
    </section>
  );
}

function DiscoverPage({
  activeCategory,
  onSelectCategory,
  onViewMap,
  onAddLink,
  onBackCategory,
}: {
  activeCategory: CategoryLabel | null;
  onSelectCategory: (category: CategoryLabel) => void;
  onViewMap: (category: CategoryLabel) => void;
  onAddLink: () => void;
  onBackCategory: () => void;
}) {
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
          aria-label="Notifications"
          className="wr-notify-btn"
        >
          <Bell size={18} className="wr-notify-icon" />
        </button>
      </header>
      {activeCategory ? (
        <CategoryDetailPage category={activeCategory} onViewMap={onViewMap} onAddLink={onAddLink} />
      ) : (
        <>
          <HeroCard />
          <BucketlistSummary onSelectCategory={onSelectCategory} />
          <RecentlyAddedCarousel />
        </>
      )}
    </>
  );
}

export function HomeScreen() {
  const prefersReducedMotion = useReducedMotion();
  const { showToast } = useUx();
  const [activeTab, setActiveTab] = useState<NavLabel>("Discover");
  const [activeCategory, setActiveCategory] = useState<CategoryLabel | null>(null);
  const [mapFocusedCategory, setMapFocusedCategory] = useState<CategoryLabel | null>(null);
  const [transitionDirection, setTransitionDirection] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number; edge: "left" | "right" } | null>(null);
  const pullStartYRef = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const isMapTab = activeTab === "Map";
  const isAddTab = activeTab === "Add";
  const isCategoryView = activeTab === "Discover" && activeCategory !== null;
  const pageKey = activeTab === "Discover" && activeCategory ? `Discover-${activeCategory}` : activeTab;
  const getTabOrderIndex = (tab: NavLabel) => NAV_ORDER.indexOf(tab);

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
        <PlaceholderPage
          title="Connect"
          message="Collaborate and share curated lists with your people."
          fullHeight
        />
      );
    }

    return <LoginProfileScreen />;
  }, [activeCategory, activeTab, mapFocusedCategory]);

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
            className="wr-page-transition-layer"
            initial={
              prefersReducedMotion
                ? { opacity: 0.98 }
                : { x: transitionDirection > 0 ? 16 : -16, opacity: 0.94 }
            }
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: prefersReducedMotion ? 0.14 : 0.2, ease: [0.22, 0.61, 0.36, 1] }}
          >
            {page}
          </motion.section>
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

