import { Bookmark, Compass, MapPin } from "lucide-react";
import type { CategoryLabel } from "./home.data";
import type { SavedPlaceRecord } from "./savedPlaces";

const categoryColors: Record<CategoryLabel, string> = {
  Taste: "#B45309",
  Activity: "#D97706",
  Stay: "#6D28D9",
  Explore: "#0E7490",
};

export function RecentlyAddedCarousel({
  places,
  onAddLink,
}: {
  places: SavedPlaceRecord[];
  onAddLink: () => void;
}) {
  const recentPlaces = [...places]
    .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
    .slice(0, 8);

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
              <button type="button" aria-label={`${card.title} saved`} className="wr-recent-save">
                <Bookmark size={17} className="wr-recent-save-icon" />
              </button>
              <span className="wr-recent-pill" style={{ backgroundColor: `${categoryColors[card.category]}CC` }}>{card.category}</span>
            </div>
            <div className="wr-recent-body">
              <p className="wr-recent-title">{card.title}</p>
              <p className="wr-recent-meta">{card.metaPrimary} · {card.metaSecondary}</p>
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
