import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { CategoryLabel } from "./home.data";

type CategoryFilterChip =
  | "All"
  | "Trending"
  | "Visited"
  | "Date-night"
  | "Budget"
  | "Street-style"
  | "Iconic"
  | "Outdoor"
  | "Adventure"
  | "Weekend"
  | "Family"
  | "Hidden gem"
  | "Saved"
  | "Premium"
  | "Couple-friendly"
  | "Workation"
  | "Pool"
  | "Heritage"
  | "Nature"
  | "Photo spots";

type CategoryPlaceRow = {
  title: string;
  distanceKm: number;
  metaPrimary: string;
  metaSecondary: string;
  locality: string;
  fullAddress: string;
  videoUrl: string;
  imageUrl: string;
  tags: Exclude<CategoryFilterChip, "All">[];
};

type CategoryScreenConfig = {
  searchPlaceholder: string;
  chips: CategoryFilterChip[];
  places: CategoryPlaceRow[];
};

const img = {
  tasteA: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=1200",
  tasteB: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&q=80&w=1200",
  tasteC: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=1200",
  actA: "https://images.unsplash.com/photo-1541625602330-2277a4c46182?auto=format&fit=crop&q=80&w=1200",
  actB: "https://images.unsplash.com/photo-1520975916090-3105956dac38?auto=format&fit=crop&q=80&w=1200",
  actC: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&q=80&w=1200",
  stayA: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&q=80&w=1200",
  stayB: "https://images.unsplash.com/photo-1455587734955-081b22074882?auto=format&fit=crop&q=80&w=1200",
  stayC: "https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&q=80&w=1200",
  expA: "https://images.unsplash.com/photo-1527631746610-bca00a040d60?auto=format&fit=crop&q=80&w=1200",
  expB: "https://images.unsplash.com/photo-1539650116574-75c0c6d73f4e?auto=format&fit=crop&q=80&w=1200",
  expC: "https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&q=80&w=1200",
};

const categoryConfigs: Record<CategoryLabel, CategoryScreenConfig> = {
  Taste: {
    searchPlaceholder: "Search saved restaurants...",
    chips: ["All", "Trending", "Visited", "Date-night", "Budget", "Street-style", "Iconic"],
    places: [
      { title: "Litti Courtyard", distanceKm: 0.8, metaPrimary: "Local classic", metaSecondary: "Lunch", locality: "Patna City", fullAddress: "Near Ashok Rajpath, Patna City, Patna, Bihar 800008", videoUrl: "https://www.instagram.com/", imageUrl: img.tasteA, tags: ["Trending", "Iconic"] },
      { title: "Biryani by the Ganges", distanceKm: 1.2, metaPrimary: "Mughlai", metaSecondary: "Dinner", locality: "Boring Road", fullAddress: "Boring Canal Road, Boring Road Crossing, Patna, Bihar 800001", videoUrl: "https://www.youtube.com/", imageUrl: img.tasteB, tags: ["Date-night", "Iconic"] },
      { title: "Kulhad Chai Junction", distanceKm: 2.1, metaPrimary: "Street bites", metaSecondary: "Evening", locality: "Kankarbagh", fullAddress: "Main Road, Kankarbagh Colony More, Patna, Bihar 800020", videoUrl: "https://www.instagram.com/", imageUrl: img.tasteC, tags: ["Street-style", "Budget"] },
      { title: "Sattu & Spice House", distanceKm: 2.6, metaPrimary: "Bihari", metaSecondary: "Lunch", locality: "Rajendra Nagar", fullAddress: "Road No. 3, Rajendra Nagar, Patna, Bihar 800016", videoUrl: "https://www.youtube.com/shorts/", imageUrl: img.tasteA, tags: ["Budget"] },
      { title: "Tandoor & Tales", distanceKm: 3.4, metaPrimary: "North Indian", metaSecondary: "Date-night", locality: "Bailey Road", fullAddress: "Saguna More to Bailey Road stretch, Patna, Bihar 801503", videoUrl: "https://www.instagram.com/", imageUrl: img.tasteB, tags: ["Date-night", "Trending"] },
      { title: "Ghatside Chaat Studio", distanceKm: 4.1, metaPrimary: "Street food", metaSecondary: "Snacks", locality: "Gandhi Maidan", fullAddress: "Near Gandhi Maidan North Gate, Patna, Bihar 800001", videoUrl: "https://www.youtube.com/", imageUrl: img.tasteC, tags: ["Street-style", "Visited"] },
      { title: "Mint Leaf Cafe", distanceKm: 5.3, metaPrimary: "Cafe", metaSecondary: "Brunch", locality: "Patliputra Colony", fullAddress: "Patliputra Colony Main Road, Patna, Bihar 800013", videoUrl: "https://www.instagram.com/", imageUrl: img.tasteA, tags: ["Visited", "Trending"] },
    ],
  },
  Activity: {
    searchPlaceholder: "Search saved activities...",
    chips: ["All", "Trending", "Visited", "Outdoor", "Adventure", "Weekend", "Family", "Hidden gem"],
    places: [
      { title: "Eco Park Patna", distanceKm: 1.1, metaPrimary: "Outdoor", metaSecondary: "Cycling", locality: "Bailey Road", fullAddress: "Eco Park Gate 2, Rajbansi Nagar, Patna, Bihar 800015", videoUrl: "https://www.youtube.com/", imageUrl: img.actA, tags: ["Outdoor", "Family"] },
      { title: "Gandhi Maidan Walk", distanceKm: 1.7, metaPrimary: "Walking", metaSecondary: "Evening", locality: "Gandhi Maidan", fullAddress: "Gandhi Maidan Circular Road, Patna, Bihar 800001", videoUrl: "https://www.instagram.com/", imageUrl: img.actB, tags: ["Trending", "Weekend"] },
      { title: "Bihar Museum Visit", distanceKm: 2.2, metaPrimary: "Culture", metaSecondary: "Indoor", locality: "Bailey Road", fullAddress: "Bihar Museum, Jawaharlal Nehru Marg, Patna, Bihar 800001", videoUrl: "https://www.youtube.com/", imageUrl: img.actC, tags: ["Family", "Visited"] },
      { title: "Ganga Riverfront Cycling", distanceKm: 2.9, metaPrimary: "Outdoor", metaSecondary: "Adventure", locality: "Collectorate Ghat", fullAddress: "Riverfront Track, Near Collectorate Ghat, Patna, Bihar 800001", videoUrl: "https://www.instagram.com/", imageUrl: img.actA, tags: ["Outdoor", "Adventure"] },
      { title: "Patna Zoo", distanceKm: 3.3, metaPrimary: "Nature", metaSecondary: "Family", locality: "Raj Bhavan", fullAddress: "Sanjay Gandhi Biological Park, Raj Bhavan Road, Patna, Bihar 800015", videoUrl: "https://www.youtube.com/", imageUrl: img.actB, tags: ["Family", "Weekend"] },
      { title: "Indoor Climbing Studio", distanceKm: 4.4, metaPrimary: "Fitness", metaSecondary: "Adventure", locality: "Kankarbagh", fullAddress: "Near Main Road, Kankarbagh, Patna, Bihar 800020", videoUrl: "https://www.instagram.com/", imageUrl: img.actC, tags: ["Adventure"] },
      { title: "Weekend Pottery Workshop", distanceKm: 5.1, metaPrimary: "Creative", metaSecondary: "Weekend", locality: "Patliputra", fullAddress: "Community Art Space, Patliputra Colony, Patna, Bihar 800013", videoUrl: "https://www.youtube.com/", imageUrl: img.actA, tags: ["Weekend", "Hidden gem"] },
    ],
  },
  Stay: {
    searchPlaceholder: "Search saved stays...",
    chips: ["All", "Saved", "Visited", "Budget", "Premium", "Couple-friendly", "Workation", "Pool"],
    places: [
      { title: "The Panache", distanceKm: 1.8, metaPrimary: "Premium hotel", metaSecondary: "Business", locality: "Fraser Road", fullAddress: "The Panache, West Gandhi Maidan, Patna, Bihar 800001", videoUrl: "https://www.youtube.com/", imageUrl: img.stayA, tags: ["Premium", "Saved"] },
      { title: "Hotel Maurya", distanceKm: 2.1, metaPrimary: "Premium hotel", metaSecondary: "City center", locality: "South Gandhi Maidan", fullAddress: "Hotel Maurya, South Gandhi Maidan, Patna, Bihar 800001", videoUrl: "https://www.instagram.com/", imageUrl: img.stayB, tags: ["Premium", "Visited"] },
      { title: "Lemon Tree Premier Patna", distanceKm: 2.7, metaPrimary: "Business stay", metaSecondary: "Workation", locality: "Dak Bungalow", fullAddress: "Lemon Tree Premier, Exhibition Road, Patna, Bihar 800001", videoUrl: "https://www.youtube.com/", imageUrl: img.stayC, tags: ["Workation", "Premium"] },
      { title: "Budget Stay Boring Road", distanceKm: 3.2, metaPrimary: "Budget hotel", metaSecondary: "Solo", locality: "Boring Road", fullAddress: "Near Boring Road Crossing, Patna, Bihar 800001", videoUrl: "https://www.instagram.com/", imageUrl: img.stayA, tags: ["Budget"] },
      { title: "Boutique Homestay Patliputra", distanceKm: 4.0, metaPrimary: "Homestay", metaSecondary: "Couple-friendly", locality: "Patliputra Colony", fullAddress: "Patliputra Colony Main Road, Patna, Bihar 800013", videoUrl: "https://www.youtube.com/", imageUrl: img.stayB, tags: ["Couple-friendly", "Saved"] },
      { title: "Riverside Guest House", distanceKm: 4.7, metaPrimary: "Guest house", metaSecondary: "Pool", locality: "Digha", fullAddress: "Near Digha Ghat, Patna, Bihar 800011", videoUrl: "https://www.instagram.com/", imageUrl: img.stayC, tags: ["Pool", "Visited"] },
      { title: "Workation Stay Kankarbagh", distanceKm: 5.5, metaPrimary: "Apartment stay", metaSecondary: "Workation", locality: "Kankarbagh", fullAddress: "Road No. 7, Kankarbagh, Patna, Bihar 800020", videoUrl: "https://www.youtube.com/", imageUrl: img.stayA, tags: ["Workation", "Budget"] },
    ],
  },
  Explore: {
    searchPlaceholder: "Search saved places...",
    chips: ["All", "Trending", "Visited", "Heritage", "Nature", "Photo spots", "Hidden gem", "Weekend"],
    places: [
      { title: "Golghar", distanceKm: 1.4, metaPrimary: "Heritage", metaSecondary: "Photo spot", locality: "Patna City", fullAddress: "Golghar, Gandhi Maidan, Patna, Bihar 800001", videoUrl: "https://www.youtube.com/", imageUrl: img.expA, tags: ["Heritage", "Photo spots"] },
      { title: "Patna Sahib Gurudwara", distanceKm: 2.3, metaPrimary: "Spiritual", metaSecondary: "Heritage", locality: "Patna Sahib", fullAddress: "Takht Sri Harmandir Sahib, Patna Sahib, Bihar 800008", videoUrl: "https://www.instagram.com/", imageUrl: img.expB, tags: ["Heritage", "Visited"] },
      { title: "Bihar Museum", distanceKm: 2.8, metaPrimary: "Museum", metaSecondary: "Weekend", locality: "Bailey Road", fullAddress: "Bihar Museum, Jawaharlal Nehru Marg, Patna, Bihar 800001", videoUrl: "https://www.youtube.com/", imageUrl: img.expC, tags: ["Weekend", "Trending"] },
      { title: "Gandhi Ghat", distanceKm: 3.5, metaPrimary: "Riverfront", metaSecondary: "Sunset", locality: "Ashok Rajpath", fullAddress: "Gandhi Ghat, Ashok Rajpath, Patna, Bihar 800001", videoUrl: "https://www.instagram.com/", imageUrl: img.expA, tags: ["Nature", "Photo spots"] },
      { title: "Sabhyata Dwar", distanceKm: 4.2, metaPrimary: "Landmark", metaSecondary: "Photo spot", locality: "Digha", fullAddress: "Sabhyata Dwar, Near Samrat Ashok Convention, Patna, Bihar 800001", videoUrl: "https://www.youtube.com/", imageUrl: img.expB, tags: ["Photo spots", "Weekend"] },
      { title: "Buddha Smriti Park", distanceKm: 4.9, metaPrimary: "Peace park", metaSecondary: "Nature", locality: "Fraser Road", fullAddress: "Buddha Smriti Park, Fraser Road Area, Patna, Bihar 800001", videoUrl: "https://www.instagram.com/", imageUrl: img.expC, tags: ["Nature", "Hidden gem"] },
      { title: "Patna Planetarium", distanceKm: 5.4, metaPrimary: "Science", metaSecondary: "Family", locality: "Indira Gandhi Road", fullAddress: "Indira Gandhi Science Complex, Patna, Bihar 800001", videoUrl: "https://www.youtube.com/", imageUrl: img.expA, tags: ["Weekend", "Visited"] },
    ],
  },
};

export function CategoryDetailPage({
  category,
  onViewMap,
}: {
  category: CategoryLabel;
  onViewMap: (category: CategoryLabel) => void;
}) {
  const config = categoryConfigs[category];
  const [activePlace, setActivePlace] = useState<CategoryPlaceRow | null>(null);
  const [isSheetClosing, setIsSheetClosing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChip, setSelectedChip] = useState<CategoryFilterChip>("All");

  useEffect(() => {
    if (!isSheetClosing) return;
    const timer = window.setTimeout(() => {
      setActivePlace(null);
      setIsSheetClosing(false);
    }, 190);
    return () => window.clearTimeout(timer);
  }, [isSheetClosing]);

  const closeSheet = () => {
    if (!activePlace || isSheetClosing) return;
    setIsSheetClosing(true);
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const allChipLabel = `All ${config.places.length}`;
  const filteredPlaces = useMemo(
    () =>
      config.places.filter((place) => {
        const matchesChip = selectedChip === "All" || place.tags.includes(selectedChip);
        const matchesSearch =
          normalizedQuery.length === 0 ||
          place.title.toLowerCase().includes(normalizedQuery) ||
          place.metaPrimary.toLowerCase().includes(normalizedQuery) ||
          place.metaSecondary.toLowerCase().includes(normalizedQuery) ||
          place.locality.toLowerCase().includes(normalizedQuery);
        return matchesChip && matchesSearch;
      }),
    [config.places, normalizedQuery, selectedChip],
  );

  return (
    <section className={`wr-category-page is-${category}`} aria-label={`${category} category page`}>
      <label className="wr-taste-search" aria-label={`Search saved ${category.toLowerCase()} places`}>
        <Search size={15} className="wr-taste-search-icon" />
        <input
          type="search"
          placeholder={config.searchPlaceholder}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="wr-taste-search-input"
        />
      </label>
      <div className="wr-taste-top-row" aria-label={`${category} header controls`}>
        <div className="wr-taste-title-block">
          <h2 className="wr-taste-page-title">{category}</h2>
        </div>
        <button type="button" className="wr-taste-view-map" onClick={() => onViewMap(category)}>View map</button>
      </div>
        <div className="wr-taste-chip-row" aria-label={`${category} filters`}>
          {config.chips.map((chip) => (
            <button
              key={chip}
              type="button"
              className={`wr-taste-chip ${chip === selectedChip ? "is-selected" : ""}`}
              onClick={() => setSelectedChip(chip)}
            >
              {chip === "All" ? allChipLabel : chip}
            </button>
          ))}
        </div>

      <section className="wr-taste-list" aria-label={`${category} saved places nearest first`}>
        {filteredPlaces.map((place) => (
          <article
            key={place.title}
            className="wr-taste-row-card"
            onClick={() => setActivePlace(place)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setActivePlace(place);
              }
            }}
          >
            <img src={place.imageUrl} alt={place.title} className="wr-taste-row-thumb" />
            <div className="wr-taste-row-main">
              <div className="wr-taste-row-top">
                <p className="wr-taste-row-name">{place.title}</p>
                <p className="wr-taste-row-distance">{place.distanceKm.toFixed(1)} km</p>
              </div>
              <p className="wr-taste-row-line">{place.metaPrimary} · {place.metaSecondary}</p>
              <p className="wr-taste-row-line">{place.locality}</p>
            </div>
          </article>
        ))}
      </section>

      {activePlace ? (
        <div className={`wr-taste-sheet-layer ${isSheetClosing ? "is-closing" : ""}`} onClick={closeSheet} role="presentation">
          <article className="wr-taste-sheet" onClick={(event) => event.stopPropagation()} aria-label={`${activePlace.title} details`}>
            <button type="button" className="wr-taste-sheet-close" aria-label="Close details" onClick={closeSheet}>
              <X size={16} />
            </button>
            <img src={activePlace.imageUrl} alt={activePlace.title} className="wr-taste-sheet-image" />
            <h3 className="wr-taste-sheet-title">{activePlace.title}</h3>
            <p className="wr-taste-sheet-address">Full address: {activePlace.fullAddress}</p>
            <div className="wr-taste-sheet-actions">
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activePlace.fullAddress)}`}
                target="_blank"
                rel="noreferrer"
                className="wr-taste-sheet-action-btn"
              >
                Directions
              </a>
              <a
                href={activePlace.videoUrl}
                target="_blank"
                rel="noreferrer"
                className="wr-taste-sheet-action-btn is-video"
              >
                Watch video
              </a>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}
