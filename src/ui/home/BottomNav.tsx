import { useEffect, useMemo, useRef, useState } from "react";
import type { NavLabel } from "./home.data";
import { addFabIcon, navItems } from "./home.data";

type BottomNavProps = {
  activeTab: NavLabel;
  onTabChange: (tab: NavLabel) => void;
};

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  const navRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicatorLeft, setIndicatorLeft] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const AddIcon = addFabIcon;

  const leftItems = useMemo(() => navItems.slice(0, 2), []);
  const rightItems = useMemo(() => navItems.slice(2), []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const updateIndicator = () => {
      const navNode = navRef.current;
      const activeNode = itemRefs.current[activeTab];
      if (!navNode || !activeNode || activeTab === "Add") return;
      const navRect = navNode.getBoundingClientRect();
      const btnRect = activeNode.getBoundingClientRect();
      const centerX = btnRect.left - navRect.left + btnRect.width / 2;
      setIndicatorLeft(centerX - 24);
    };

    updateIndicator();
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [activeTab]);

  const renderItem = (label: Exclude<NavLabel, "Add">, Icon: typeof navItems[number]["icon"]) => {
    const isActive = label === activeTab;
    return (
      <button
        type="button"
        key={label}
        className={`wr-nav-item ${isActive ? "is-active" : ""}`}
        onClick={() => onTabChange(label)}
        ref={(node) => {
          itemRefs.current[label] = node;
        }}
        aria-current={isActive ? "page" : undefined}
        aria-label={label}
      >
        <Icon size={21} strokeWidth={isActive ? 2.3 : 2.05} />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <nav ref={navRef} className="wr-bottom-nav" aria-label="Bottom navigation">
      <span
        className={`wr-nav-active-slider ${reduceMotion ? "is-reduced-motion" : ""} ${activeTab === "Add" ? "is-hidden" : ""}`}
        style={{ left: `${indicatorLeft}px` }}
        aria-hidden="true"
      />
      <div className="wr-bottom-nav-side is-left">
        {leftItems.map((item) => renderItem(item.label, item.icon))}
      </div>
      <button
        type="button"
        className={`wr-nav-fab ${activeTab === "Add" ? "is-active" : ""}`}
        onClick={() => onTabChange("Add")}
        aria-current={activeTab === "Add" ? "page" : undefined}
        aria-label="Add"
      >
        <AddIcon size={22} strokeWidth={2.4} />
      </button>
      <div className="wr-bottom-nav-side is-right">
        {rightItems.map((item) => renderItem(item.label, item.icon))}
      </div>
    </nav>
  );
}
