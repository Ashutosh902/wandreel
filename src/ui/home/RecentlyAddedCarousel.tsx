import { Bookmark, Compass, MapPin } from "lucide-react";
import { cards } from "./home.data";

export function RecentlyAddedCarousel() {
  return (
    <section className="wr-recent-wrap">
      <div className="wr-section-head"><h3>Recently added</h3></div>
      <div className="wr-recent-scroll" aria-label="Recently added carousel">
        {cards.map((card) => (
          <article key={card.title} className="wr-recent-card">
            <div className="wr-recent-image">
              <img
                src={card.image}
                alt={card.title}
                className="wr-recent-image-photo"
                loading="lazy"
              />
              <div className="wr-recent-image-overlay" />
              <button type="button" aria-label={`Save ${card.title}`} className="wr-recent-save">
                <Bookmark size={17} className="wr-recent-save-icon" />
              </button>
              <span className="wr-recent-pill" style={{ backgroundColor: `${card.color}CC` }}>{card.category}</span>
            </div>
            <div className="wr-recent-body">
              <p className="wr-recent-title">{card.title}</p>
              <p className="wr-recent-meta">{card.meta}</p>
              <div className="wr-recent-place"><MapPin size={13} className="wr-recent-place-icon" />{card.place}</div>
            </div>
          </article>
        ))}

        <button type="button" className="wr-recent-view-all">
          <div className="wr-recent-view-all-icon"><Compass size={22} /></div>
          <div>
            <p className="wr-recent-view-all-title">View all</p>
            <p className="wr-recent-view-all-sub">See every saved place</p>
          </div>
        </button>
      </div>
    </section>
  );
}
