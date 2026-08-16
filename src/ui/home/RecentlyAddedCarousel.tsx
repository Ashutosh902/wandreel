import { Compass, MapPin } from "lucide-react";
import type { CategoryLabel } from "./home.data";
import { SafePlaceImage } from "./SafePlaceImage";
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
  const recentPlaces = places;

  return (
    <section className="wr-recent-wrap">
      <div className="wr-section-title-row">
        <h3>Recently added</h3>
        <span className="wr-section-view-all" aria-hidden="true">View all</span>
      </div>
      <div className="wr-recent-scroll" aria-label="Recently added carousel">
        {recentPlaces.length ? recentPlaces.map((card) => (
          <article key={card.id} className="wr-recent-card">
            <div className="wr-recent-image">
              <SafePlaceImage
                src={card.imageUrl}
                category={card.category}
                alt={card.title}
                className="wr-recent-image-photo"
              />
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
