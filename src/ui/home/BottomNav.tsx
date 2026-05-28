import type { NavLabel } from "./home.data";
import { navItems } from "./home.data";

type BottomNavProps = {
  activeTab: NavLabel;
  onTabChange: (tab: NavLabel) => void;
};

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav className="wr-bottom-nav" aria-label="Bottom navigation">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = item.label === activeTab;

        return (
          <button
            type="button"
            key={item.label}
            className={`wr-nav-item ${isActive ? "is-active" : ""}`}
            onClick={() => onTabChange(item.label)}
            aria-current={isActive ? "page" : undefined}
            aria-label={item.label}
          >
            {isActive ? <span className="wr-nav-active-indicator" /> : null}
            <Icon size={25} strokeWidth={isActive ? 2.3 : 2.1} />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
