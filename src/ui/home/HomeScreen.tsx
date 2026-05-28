import { useMemo, useState } from "react";
import { Bell } from "lucide-react";
import { motion } from "framer-motion";
import { BottomNav } from "./BottomNav";
import { BucketlistSummary } from "./BucketlistSummary";
import { CategoryDetailPage } from "./CategoryDetailPage";
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
  onBackCategory,
}: {
  activeCategory: CategoryLabel | null;
  onSelectCategory: (category: CategoryLabel) => void;
  onBackCategory: () => void;
}) {
  if (activeCategory) {
    return <CategoryDetailPage category={activeCategory} onBack={onBackCategory} />;
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
  const isMapTab = activeTab === "Map";

  const page = useMemo(() => {
    if (activeTab === "Discover") {
      return (
        <DiscoverPage
          activeCategory={activeCategory}
          onSelectCategory={setActiveCategory}
          onBackCategory={() => setActiveCategory(null)}
        />
      );
    }

    if (activeTab === "Map") {
      return <MapScreen />;
    }

    if (activeTab === "Add") {
      return (
        <PlaceholderPage
          title="Add"
          message="Paste or share links here to create new Wandreel saves."
          fullHeight
        />
      );
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
        <div className={`wr-home-surface ${isMapTab ? "wr-home-surface-map" : ""}`}>
          {activeTab !== "Login" && activeTab !== "Map" ? <div className="wr-bg-blob one" /> : null}
          {activeTab !== "Login" && activeTab !== "Map" ? <div className="wr-bg-blob two" /> : null}
          {activeTab !== "Login" && activeTab !== "Map" ? <div className="wr-bg-blob three" /> : null}

          {activeTab !== "Login" && activeTab !== "Map" ? (
            <header className="wr-home-header">
              <div className="wr-brand" aria-hidden="true" />
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
          <BottomNav
            activeTab={activeTab}
            onTabChange={(nextTab) => {
              setActiveTab(nextTab);
              if (nextTab !== "Discover") {
                setActiveCategory(null);
              }
            }}
          />
        </div>
      </motion.div>
    </div>
  );
}
