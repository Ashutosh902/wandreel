import { useMemo, useState } from "react";
import { ArrowLeft, Bell } from "lucide-react";
import { motion } from "framer-motion";
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
import "./home.css";

runHomeDataChecks();

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
}: {
  activeCategory: CategoryLabel | null;
  onSelectCategory: (category: CategoryLabel) => void;
  onViewMap: (category: CategoryLabel) => void;
}) {
  if (activeCategory) {
    return <CategoryDetailPage category={activeCategory} onViewMap={onViewMap} />;
  }

  return (
    <>
      <HeroCard />
      <BucketlistSummary onSelectCategory={onSelectCategory} />
      <RecentlyAddedCarousel />
    </>
  );
}

export function HomeScreen() {
  const [activeTab, setActiveTab] = useState<NavLabel>("Discover");
  const [activeCategory, setActiveCategory] = useState<CategoryLabel | null>(null);
  const [mapFocusedCategory, setMapFocusedCategory] = useState<CategoryLabel | null>(null);
  const isMapTab = activeTab === "Map";
  const isAddTab = activeTab === "Add";
  const isCategoryView = activeTab === "Discover" && activeCategory !== null;

  const page = useMemo(() => {
    if (activeTab === "Discover") {
      return (
        <DiscoverPage
          activeCategory={activeCategory}
          onSelectCategory={setActiveCategory}
          onViewMap={(category) => {
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
          onBack={() => {
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
  }, [activeCategory, activeTab]);

  return (
    <div className="wr-home-page">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className={`wr-phone-shell ${isMapTab ? "wr-phone-shell-map" : ""}`}
      >
        <div className={`wr-home-surface ${isMapTab ? "wr-home-surface-map" : ""} ${isCategoryView ? "is-category-view" : ""} ${isAddTab ? "is-add-view" : ""}`}>
          {activeTab !== "Login" && activeTab !== "Map" ? <div className="wr-bg-blob one" /> : null}
          {activeTab !== "Login" && activeTab !== "Map" ? <div className="wr-bg-blob two" /> : null}
          {activeTab !== "Login" && activeTab !== "Map" ? <div className="wr-bg-blob three" /> : null}

          {activeTab !== "Login" && activeTab !== "Map" && activeTab !== "Add" ? (
            <header className="wr-home-header">
              {isCategoryView ? (
                <button
                  type="button"
                  className="wr-header-back"
                  aria-label="Back"
                  onClick={() => setActiveCategory(null)}
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
          ) : null}

          {page}
        </div>
        <BottomNav
          activeTab={activeTab}
          onTabChange={(nextTab) => {
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
