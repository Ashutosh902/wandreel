import { Compass, MapPin } from "lucide-react";
import type { CategoryLabel } from "./home.data";
import type { SavedPlaceRecord } from "./savedPlaces";

const categoryColors: Record<CategoryLabel, string> = {
  Taste: "#E85D75",
  Activity: "#F59E0B",
  Stay: "#7C3AED",
  Explore: "#0891B2",
};

export function RecentlyAddedCarousel({
  places,
  onAddLink,
}: {
  places: SavedPlaceRecord[];
  onAddLink: () => void;
}) {
  const getRecentTimestamp = (place: SavedPlaceRecord) => {
    const legacyPlace = place as SavedPlaceRecord & {
      createdAt?: string | number | null;
      savedAt?: string | number | null;
      addedAt?: string | number | null;
    };
    const candidates = [
      typeof place.createdAtMs === "number" ? place.createdAtMs : null,
      legacyPlace.createdAt ?? null,
      legacyPlace.savedAt ?? null,
      legacyPlace.addedAt ?? null,
    ];

    for (const value of candidates) {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim()) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
      }
    }

    return 0;
  };

  const recentPlaces = [...places]
    .sort((a, b) => getRecentTimestamp(b) - getRecentTimestamp(a))
    .slice(0, 7);

  return (
    <section className="wr-recent-wrap">
      <div className="wr-section-head"><h3>Recently added</h3></div>
      <div className="wr-recent-scroll" aria-label="Recently added carousel">
        {recentPlaces.length ? recentPlaces.map((card) => (
          <article key={card.id} className="wr-recent-card">
            <div className="wr-recent-image">
              <img
                src={card.imageUrl}
                alt={card.title}
                className="wr-recent-image-photo"
                loading="lazy"
              />
              <div className="wr-recent-image-overlay" />
            </div>
            <div className="wr-recent-body">
              <p className="wr-recent-title">{card.title}</p>
              <p className="wr-recent-meta" style={{ color: categoryColors[card.category] }}>{card.category}</p>
              <div className="wr-recent-place"><MapPin size={13} className="wr-recent-place-icon" />{card.locality}</div>
            </div>
          </article>
        )) : (
          <article className="wr-recent-empty-card" aria-live="polite">
            <div className="wr-recent-view-all-icon"><Compass size={22} /></div>
            <div>
              <p className="wr-recent-view-all-title">No places added yet</p>
              <p className="wr-recent-view-all-sub">Save your first reel or place to see it here.</p>
            </div>
            <button type="button" className="wr-category-empty-cta" onClick={onAddLink}>
              Add place
            </button>
          </article>
        )}
      </div>
    </section>
  );
}
