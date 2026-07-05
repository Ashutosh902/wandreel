import { useEffect, useRef, useState } from "react";
import type { NavLabel } from "./home.data";
import { navItems } from "./home.data";

type BottomNavProps = {
  activeTab: NavLabel;
  onTabChange: (tab: NavLabel) => void;
};

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  const navRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicatorLeft, setIndicatorLeft] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

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
      if (!navNode || !activeNode) return;
      const navRect = navNode.getBoundingClientRect();
      const btnRect = activeNode.getBoundingClientRect();
      const centerX = btnRect.left - navRect.left + btnRect.width / 2;
      setIndicatorLeft(centerX - 24);
    };

    updateIndicator();
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [activeTab]);

  return (
    <nav ref={navRef} className="wr-bottom-nav" aria-label="Bottom navigation">
      <span
        className={`wr-nav-active-slider ${reduceMotion ? "is-reduced-motion" : ""}`}
        style={{ left: `${indicatorLeft}px` }}
        aria-hidden="true"
      />
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = item.label === activeTab;

        return (
          <button
            type="button"
            key={item.label}
            className={`wr-nav-item ${isActive ? "is-active" : ""}`}
            onClick={() => onTabChange(item.label)}
            ref={(node) => {
              itemRefs.current[item.label] = node;
            }}
            aria-current={isActive ? "page" : undefined}
            aria-label={item.label}
          >
            <Icon size={28} strokeWidth={isActive ? 2.3 : 2.1} />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

