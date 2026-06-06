import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Globe2, Pencil, Search, Share2, Trash2, X } from "lucide-react";
import type { CategoryLabel } from "./home.data";
import { useUx } from "../layout/UxProvider";
import { distanceKm } from "../geo";
import {
  isPlaceGlobal,
  removeSavedPlace,
  togglePlaceGlobalPersisted,
  upsertSavedPlace,
  type SavedPlaceRecord,
} from "./savedPlaces";
import { buildPlaceMapsUrl, sharePlaceExternally } from "./shareHelpers";

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
  | "Dorm"
  | "Heritage"
  | "Nature"
  | "Photo spots"
  | "Veg-only"
  | "Cafe"
  | "Comedy"
  | "Workshop"
  | "Free"
  | "Spiritual";

type CategoryPlaceRow = SavedPlaceRecord;
type CategorySortOption = "distance" | "alphabetical" | "recent";

type CategoryScreenConfig = {
  searchPlaceholder: string;
  chips: CategoryFilterChip[];
};

const CATEGORY_LEVEL2_ENABLED = String(import.meta.env.VITE_CATEGORY_LEVEL2_ENABLED ?? "true").toLowerCase() !== "false";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";

const categoryOrder: CategoryLabel[] = ["Taste", "Activity", "Stay", "Explore"];

const categoryConfigs: Record<CategoryLabel, CategoryScreenConfig> = {
  Taste: {
    searchPlaceholder: "Search saved restaurants...",
    chips: CATEGORY_LEVEL2_ENABLED ? ["All", "Saved", "Visited"] : ["All", "Saved"],
  },
  Activity: {
    searchPlaceholder: "Search saved activities...",
    chips: CATEGORY_LEVEL2_ENABLED ? ["All", "Saved", "Visited"] : ["All", "Saved"],
  },
  Stay: {
    searchPlaceholder: "Search saved stays...",
    chips: CATEGORY_LEVEL2_ENABLED ? ["All", "Saved", "Visited"] : ["All", "Saved"],
  },
  Explore: {
    searchPlaceholder: "Search saved places...",
    chips: CATEGORY_LEVEL2_ENABLED ? ["All", "Saved", "Visited"] : ["All", "Saved"],
  },
};

const CATEGORY_COLORS: Record<CategoryLabel, string> = {
  Taste: "#E85D75",
  Activity: "#F59E0B",
  Stay: "#7C3AED",
  Explore: "#0891B2",
};

function getPlaceDistanceValue(place: CategoryPlaceRow): number {
  if (typeof place.lat !== "number" || typeof place.lng !== "number") {
    return Number.POSITIVE_INFINITY;
  }
  return Number.isFinite(place.distanceKm) ? place.distanceKm : Number.POSITIVE_INFINITY;
}

function getPlaceRecentValue(place: CategoryPlaceRow): number {
  const legacySavedAt =
    typeof (place as { savedAt?: number | string }).savedAt !== "undefined"
      ? new Date((place as { savedAt?: number | string }).savedAt as number | string).getTime()
      : Number.NaN;
  const legacyCreatedAt =
    typeof (place as { createdAt?: number | string }).createdAt !== "undefined"
      ? new Date((place as { createdAt?: number | string }).createdAt as number | string).getTime()
      : Number.NaN;
  const legacyDateAdded =
    typeof (place as { dateAdded?: number | string }).dateAdded !== "undefined"
      ? new Date((place as { dateAdded?: number | string }).dateAdded as number | string).getTime()
      : Number.NaN;

  if (Number.isFinite(legacySavedAt)) return legacySavedAt;
  if (Number.isFinite(legacyCreatedAt)) return legacyCreatedAt;
  if (Number.isFinite(legacyDateAdded)) return legacyDateAdded;
  return place.createdAtMs;
}

function sortPlaces(places: CategoryPlaceRow[], sortBy: CategorySortOption): CategoryPlaceRow[] {
  const items = [...places];

  if (sortBy === "distance") {
    return items.sort((a, b) => getPlaceDistanceValue(a) - getPlaceDistanceValue(b));
  }

  if (sortBy === "alphabetical") {
    return items.sort((a, b) =>
      String(a.title || "").localeCompare(String(b.title || ""), undefined, {
        sensitivity: "base",
      }),
    );
  }

  return items.sort((a, b) => getPlaceRecentValue(b) - getPlaceRecentValue(a));
}

export function CategoryDetailPage({
  category,
  onViewMap,
  onAddLink,
  savedPlaces,
}: {
  category: CategoryLabel;
  onViewMap: (category: CategoryLabel) => void;
  onAddLink: () => void;
  savedPlaces: SavedPlaceRecord[];
}) {
  const { currentCoords, showToast } = useUx();
  const config = categoryConfigs[category];
  const [activePlace, setActivePlace] = useState<CategoryPlaceRow | null>(null);
  const [editingCategoryPlace, setEditingCategoryPlace] = useState<CategoryPlaceRow | null>(null);
  const [deleteConfirmPlace, setDeleteConfirmPlace] = useState<CategoryPlaceRow | null>(null);
  const [categoryEditTitle, setCategoryEditTitle] = useState("");
  const [categoryEditLocality, setCategoryEditLocality] = useState("");
  const [categoryEditAddress, setCategoryEditAddress] = useState("");
  const [categoryEditCategory, setCategoryEditCategory] = useState<CategoryLabel>(category);
  const [isSheetClosing, setIsSheetClosing] = useState(false);
  const sheetTouchStartYRef = useRef<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChip, setSelectedChip] = useState<CategoryFilterChip>("All");
  const [sortBy] = useState<CategorySortOption>("distance");

  useEffect(() => {
    if (!isSheetClosing) return;
    const timer = window.setTimeout(() => {
      setActivePlace(null);
      setIsSheetClosing(false);
    }, 190);
    return () => window.clearTimeout(timer);
  }, [isSheetClosing]);

  const hasOverlayOpen = Boolean(activePlace || editingCategoryPlace || deleteConfirmPlace);

  useEffect(() => {
    if (!hasOverlayOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const surface = document.querySelector(".wr-home-surface") as HTMLDivElement | null;
    const previousSurfaceOverflow = surface?.style.overflow;
    const previousSurfaceTouchAction = surface?.style.touchAction;
    const previousSurfaceOverscroll = surface?.style.overscrollBehavior;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    if (surface) {
      surface.style.overflow = "hidden";
      surface.style.touchAction = "none";
      surface.style.overscrollBehavior = "none";
    }

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      if (surface) {
        surface.style.overflow = previousSurfaceOverflow || "";
        surface.style.touchAction = previousSurfaceTouchAction || "";
        surface.style.overscrollBehavior = previousSurfaceOverscroll || "";
      }
    };
  }, [hasOverlayOpen]);

  const distanceAwarePlaces = useMemo(() => {
    if (!currentCoords) return savedPlaces;
    return savedPlaces.map((place) => {
      if (typeof place.lat !== "number" || typeof place.lng !== "number") return place;
      return {
        ...place,
        distanceKm: Number(distanceKm(currentCoords, { lat: place.lat, lng: place.lng }).toFixed(1)),
      };
    });
  }, [savedPlaces, currentCoords]);

  const closeSheet = () => {
    if (!activePlace || isSheetClosing) return;
    setIsSheetClosing(true);
  };

  const openCategoryEdit = (place: CategoryPlaceRow) => {
    setCategoryEditTitle(place.title);
    setCategoryEditLocality(place.locality);
    setCategoryEditAddress(place.fullAddress);
    setCategoryEditCategory(category);
    setEditingCategoryPlace(place);
  };

  const updateSavedFeedPlace = (place: CategoryPlaceRow, nextCategory: CategoryLabel, remove = false) => {
    if (remove) {
      removeSavedPlace(place);
      return;
    }
    upsertSavedPlace({ ...place, category: nextCategory, metaPrimary: nextCategory });
  };

  const saveCategoryEdit = () => {
    if (!editingCategoryPlace) return;
    const title = categoryEditTitle.trim();
    const locality = categoryEditLocality.trim();
    const fullAddress = categoryEditAddress.trim() || locality;
    if (!title || !locality) {
      showToast({ message: "Title and location are required.", variant: "error" });
      return;
    }
    const updated = {
      ...editingCategoryPlace,
      title,
      locality,
      fullAddress,
      metaPrimary: categoryEditCategory,
      category: categoryEditCategory,
    };
    updateSavedFeedPlace(updated, categoryEditCategory, false);
    setActivePlace(updated);
    setEditingCategoryPlace(null);
    showToast({ message: "Card updated", variant: "success" });
  };

  const deleteCategoryPlace = async (place: CategoryPlaceRow) => {
    updateSavedFeedPlace(place, category, true);
    if (place.placeId) {
      fetch(`${API_BASE_URL}/api/saved-places/${encodeURIComponent(place.placeId)}`, {
        method: "DELETE",
        credentials: "include",
      }).catch(() => undefined);
    }
    setActivePlace(null);
    setEditingCategoryPlace(null);
    showToast({ message: "Card deleted", variant: "info" });
  };

  const handleRecommendPlace = async (place: CategoryPlaceRow) => {
    try {
      const nextPlace = await togglePlaceGlobalPersisted(place);
      setActivePlace(nextPlace);
      showToast({
        message: isPlaceGlobal(nextPlace)
          ? "This place is now global. Others can discover it in Connect."
          : "Removed from global recommendations.",
        variant: isPlaceGlobal(nextPlace) ? "success" : "info",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update global recommendations.";
      showToast({ message, variant: "error" });
    }
  };

  const handleSharePlace = async (place: CategoryPlaceRow) => {
    try {
      const result = await sharePlaceExternally(place);
      if (result === "copied") {
        showToast({ message: "Share link copied", variant: "success" });
      }
    } catch {
      showToast({ message: "Could not open the share sheet right now.", variant: "error" });
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const allChipLabel = `All ${distanceAwarePlaces.length}`;
  const filteredPlaces = useMemo(
    () =>
      distanceAwarePlaces.filter((place) => {
        const matchesChip = selectedChip === "All" || place.tags.includes(selectedChip);
        const matchesSearch =
          normalizedQuery.length === 0 ||
          place.title.toLowerCase().includes(normalizedQuery) ||
          place.metaPrimary.toLowerCase().includes(normalizedQuery) ||
          place.metaSecondary.toLowerCase().includes(normalizedQuery) ||
          place.locality.toLowerCase().includes(normalizedQuery);
        return matchesChip && matchesSearch;
      }),
    [distanceAwarePlaces, normalizedQuery, selectedChip],
  );
  const sortedPlaces = useMemo(() => sortPlaces(filteredPlaces, sortBy), [filteredPlaces, sortBy]);

  const overlays = (
    <>
      {activePlace ? (
        <div className={`wr-taste-sheet-layer ${isSheetClosing ? "is-closing" : ""}`} onClick={closeSheet} role="presentation">
          <article
            className="wr-taste-sheet"
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => {
              sheetTouchStartYRef.current = event.touches[0].clientY;
            }}
            onTouchEnd={(event) => {
              if (sheetTouchStartYRef.current === null) return;
              const deltaY = event.changedTouches[0].clientY - sheetTouchStartYRef.current;
              sheetTouchStartYRef.current = null;
              if (deltaY > 72) closeSheet();
            }}
            aria-label={`${activePlace.title} details`}
          >
            <div className="wr-taste-sheet-toolbar">
              <button
                type="button"
                className={`wr-taste-sheet-icon-btn ${isPlaceGlobal(activePlace) ? "is-active" : ""}`}
                aria-label={isPlaceGlobal(activePlace) ? "Remove from global recommendations" : "Recommend place"}
                onClick={() => void handleRecommendPlace(activePlace)}
              >
                <Globe2 size={15} />
              </button>
              <button
                type="button"
                className="wr-taste-sheet-icon-btn"
                aria-label="Share place"
                onClick={() => void handleSharePlace(activePlace)}
              >
                <Share2 size={15} />
              </button>
              <button
                type="button"
                className="wr-taste-sheet-icon-btn"
                aria-label="Edit card"
                onClick={() => openCategoryEdit(activePlace)}
              >
                <Pencil size={15} />
              </button>
              <button
                type="button"
                className="wr-taste-sheet-icon-btn is-delete"
                aria-label="Delete card"
                onClick={() => setDeleteConfirmPlace(activePlace)}
              >
                <Trash2 size={15} />
              </button>
              <button type="button" className="wr-taste-sheet-icon-btn" aria-label="Close details" onClick={closeSheet}>
                <X size={16} />
              </button>
            </div>
            <div className="wr-taste-sheet-body">
              <img src={activePlace.imageUrl} alt={activePlace.title} className="wr-taste-sheet-image" />
              <h3 className="wr-taste-sheet-title">{activePlace.title}</h3>
              <p className="wr-taste-sheet-address">Full address: {activePlace.fullAddress}</p>
              <div className="wr-taste-sheet-actions">
                <a
                  href={buildPlaceMapsUrl(activePlace)}
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
            </div>
          </article>
        </div>
      ) : null}
      {editingCategoryPlace ? (
        <div className="wr-add-edit-layer" role="presentation">
          <button
            type="button"
            className="wr-add-edit-backdrop"
            aria-label="Cancel edit"
            onClick={() => setEditingCategoryPlace(null)}
          />
          <section
            className="wr-add-edit-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Edit card"
          >
            <div className="wr-add-edit-head">
              <div>
                <p>EDIT CARD</p>
                <h3>Update the details</h3>
              </div>
              <button
                type="button"
                className="wr-add-edit-close"
                aria-label="Cancel edit"
                onClick={() => setEditingCategoryPlace(null)}
              >
                x
              </button>
            </div>
            <label className="wr-add-edit-field">
              <span>Title</span>
              <input
                value={categoryEditTitle}
                onChange={(e) => setCategoryEditTitle(e.target.value)}
                placeholder="Card title"
              />
            </label>
            <label className="wr-add-edit-field">
              <span>Category</span>
              <select
                value={categoryEditCategory}
                onChange={(e) => setCategoryEditCategory(e.target.value as CategoryLabel)}
              >
                {categoryOrder.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </label>
            <label className="wr-add-edit-field">
              <span>Location</span>
              <input
                value={categoryEditLocality}
                onChange={(e) => setCategoryEditLocality(e.target.value)}
                placeholder="Locality"
              />
            </label>
            <label className="wr-add-edit-field">
              <span>Full address</span>
              <input
                value={categoryEditAddress}
                onChange={(e) => setCategoryEditAddress(e.target.value)}
                placeholder="Full address"
              />
            </label>
            <div className="wr-add-edit-actions">
              <button
                type="button"
                className="wr-add-preview-btn"
                onClick={() => setEditingCategoryPlace(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="wr-add-preview-btn is-primary"
                onClick={saveCategoryEdit}
              >
                Save changes
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {deleteConfirmPlace ? (
        <div className="wr-add-edit-layer" role="presentation">
          <button
            type="button"
            className="wr-add-edit-backdrop"
            aria-label="Cancel delete"
            onClick={() => setDeleteConfirmPlace(null)}
          />
          <section
            className="wr-delete-confirm-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm delete"
          >
            <div className="wr-delete-confirm-head">
              <div>
                <p>DELETE CARD</p>
                <h3>Are you sure?</h3>
              </div>
              <button
                type="button"
                className="wr-delete-confirm-close"
                aria-label="Cancel delete"
                onClick={() => setDeleteConfirmPlace(null)}
              >
                x
              </button>
            </div>
            <p className="wr-delete-confirm-message">
              This will permanently delete "{deleteConfirmPlace.title}" from your saved places.
            </p>
            <div className="wr-delete-confirm-actions">
              <button
                type="button"
                className="wr-add-preview-btn"
                onClick={() => setDeleteConfirmPlace(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="wr-add-preview-btn is-primary"
                onClick={() => {
                  void deleteCategoryPlace(deleteConfirmPlace);
                  setDeleteConfirmPlace(null);
                  closeSheet();
                }}
              >
                Delete
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );

  const overlayTarget =
    typeof document !== "undefined" ? document.querySelector(".wr-phone-shell") ?? document.body : null;

  return (
    <>
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
        <div className="wr-taste-top-actions">
          <button type="button" className="wr-taste-view-map" onClick={() => onViewMap(category)}>View map</button>
        </div>
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
        {sortedPlaces.length === 0 ? (
          <article className="wr-category-empty-state" aria-live="polite">
            <h3>{category === "Taste" ? "No restaurants yet" : category === "Activity" ? "No activities yet" : category === "Stay" ? "No stays yet" : "No places yet"}</h3>
            <p>
              {category === "Taste"
                ? "Paste a reel to save your first food spot."
                : category === "Activity"
                  ? "Save reels for things to do around you."
                  : category === "Stay"
                    ? "Save hotels, homestays, and stay ideas from reels."
                    : "Save sights, hidden gems, and weekend spots."}
            </p>
            <button type="button" className="wr-category-empty-cta" onClick={onAddLink}>
              Add place
            </button>
          </article>
        ) : sortedPlaces.map((place) => (
          <article
            key={place.id}
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
            <div className="wr-taste-row-thumb-wrap">
              <img src={place.imageUrl} alt={place.title} className="wr-taste-row-thumb" />
              {isPlaceGlobal(place) ? (
                <span className="wr-taste-row-global-marker" aria-label="Globally recommended place">
                  <Globe2 size={11} />
                </span>
              ) : null}
            </div>
            <div className="wr-taste-row-main">
              <div className="wr-taste-row-top">
                <p className="wr-taste-row-name">{place.title}</p>
                <p className="wr-taste-row-distance">{place.distanceKm.toFixed(1)} km</p>
              </div>
              <p className="wr-taste-row-category" style={{ color: CATEGORY_COLORS[place.category] }}>{place.category}</p>
              <p className="wr-taste-row-line">
                {place.metaSecondary && place.metaSecondary !== "Saved"
                  ? `${place.metaSecondary} · ${place.locality}`
                  : place.locality}
              </p>
            </div>
          </article>
        ))}
      </section>

      </section>
      {overlayTarget ? createPortal(overlays, overlayTarget) : null}
    </>
  );
}


