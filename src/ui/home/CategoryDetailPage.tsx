import { ArrowLeft } from "lucide-react";
import { categories } from "./home.data";
import type { CategoryLabel } from "./home.data";

const categorySubheads: Record<CategoryLabel, string> = {
  Taste: "Food picks, cafes, and local must-try plates.",
  Activity: "Things to do, adventure spots, and weekend plans.",
  Stay: "Hotels, homestays, and comfort-first stays.",
  Explore: "Culture, landmarks, and hidden gems to discover.",
};

const categoryHighlights: Record<CategoryLabel, string[]> = {
  Taste: ["6 trending", "4 budget", "2 date-night"],
  Activity: ["3 weekend", "4 adventure", "2 family"],
  Stay: ["2 premium", "3 mid-range", "1 budget"],
  Explore: ["5 heritage", "3 sunset", "4 local gems"],
};

const categoryPlaces: Record<CategoryLabel, Array<{ title: string; meta: string; place: string }>> = {
  Taste: [
    { title: "Biryani by the Ganges", meta: "Mughlai | Dinner", place: "Boring Road" },
    { title: "Kulhad Chai Junction", meta: "Street bites | Evening", place: "Kankarbagh" },
    { title: "Litti Courtyard", meta: "Local classic | Lunch", place: "Patna City" },
  ],
  Activity: [
    { title: "Eco Park Cycle Loop", meta: "Cycling | Morning", place: "Rajbansi Nagar" },
    { title: "Ganga Cruise Ride", meta: "Boating | Sunset", place: "Collectorate Ghat" },
    { title: "Funtasia Sprint Pass", meta: "Waterpark | Weekend", place: "Danapur" },
  ],
  Stay: [
    { title: "Riverfront Suites", meta: "4-star | River view", place: "Ashok Rajpath" },
    { title: "Patliputra Residency", meta: "Business | Central", place: "Bailey Road" },
    { title: "Old City Courtyard", meta: "Heritage stay | Cozy", place: "Patna City" },
  ],
  Explore: [
    { title: "Golghar Walkthrough", meta: "Landmark | Morning", place: "Gandhi Maidan" },
    { title: "Bihar Museum Trail", meta: "Culture | 2-3 hrs", place: "Jawaharlal Nehru Marg" },
    { title: "Takht Sri Patna Sahib", meta: "Spiritual | Heritage", place: "Patna Sahib" },
  ],
};

export function CategoryDetailPage({
  category,
  onBack,
}: {
  category: CategoryLabel;
  onBack: () => void;
}) {
  const item = categories.find((entry) => entry.label === category);
  if (!item) return null;

  return (
    <section className="wr-category-page" aria-label={`${category} category page`}>
      <button type="button" className="wr-category-back" onClick={onBack}>
        <ArrowLeft size={16} />
        Back to Discover
      </button>

      <article className="wr-category-hero">
        <img src={item.image} alt={item.label} className="wr-category-hero-image" />
        <div className="wr-category-hero-overlay" />
        <div className="wr-category-hero-content">
          <p className="wr-category-kicker">{item.count} saved</p>
          <h2>{item.label}</h2>
          <p>{categorySubheads[category]}</p>
        </div>
      </article>

      <section className="wr-category-panel" aria-label={`${category} quick highlights`}>
        <div className="wr-category-highlights">
          {categoryHighlights[category].map((pill) => (
            <span key={pill} className="wr-category-pill">{pill}</span>
          ))}
        </div>

        <div className="wr-category-list">
          {categoryPlaces[category].map((entry) => (
            <article key={entry.title} className="wr-category-row">
              <p className="wr-category-row-title">{entry.title}</p>
              <p className="wr-category-row-meta">{entry.meta}</p>
              <p className="wr-category-row-place">{entry.place}</p>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
