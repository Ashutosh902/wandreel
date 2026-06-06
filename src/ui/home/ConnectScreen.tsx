import { useMemo, useState } from "react";
import { Camera, Globe2, Share2, Sparkles, Users } from "lucide-react";
import { categories, type CategoryLabel } from "./home.data";
import {
  getGlobalSavedPlaces,
  togglePlaceGlobalPersisted,
  type SavedPlaceRecord,
} from "./savedPlaces";
import { shareAppExternally, sharePlaceExternally } from "./shareHelpers";
import { useUx } from "../layout/UxProvider";

type ConnectTab = "shared-with-me" | "shared-by-me";

const categoryImageByLabel = categories.reduce<Record<CategoryLabel, string>>((acc, category) => {
  acc[category.label] = category.image;
  return acc;
}, {} as Record<CategoryLabel, string>);

export function ConnectScreen({
  savedPlacesByCategory,
  onViewSavedPlaces,
}: {
  savedPlacesByCategory: Record<CategoryLabel, SavedPlaceRecord[]>;
  onViewSavedPlaces: () => void;
}) {
  const { showToast } = useUx();
  const [activeTab, setActiveTab] = useState<ConnectTab>("shared-with-me");
  const sharedByMe = useMemo(() => getGlobalSavedPlaces(savedPlacesByCategory), [savedPlacesByCategory]);

  const handleInviteFriend = async () => {
    try {
      const result = await shareAppExternally();
      if (result === "copied") {
        showToast({ message: "Invite link copied", variant: "success" });
      }
    } catch {
      showToast({ message: "Could not open share sheet right now.", variant: "error" });
    }
  };

  const handleSharePlace = async (place: SavedPlaceRecord) => {
    try {
      const result = await sharePlaceExternally(place);
      if (result === "copied") {
        showToast({ message: "Share link copied", variant: "success" });
      }
    } catch {
      showToast({ message: "Could not share this place right now.", variant: "error" });
    }
  };

  const handleRemoveSharedPlace = async (place: SavedPlaceRecord) => {
    try {
      await togglePlaceGlobalPersisted(place, false);
      showToast({ message: "Removed from global recommendations.", variant: "info" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update global recommendations.";
      showToast({ message, variant: "error" });
    }
  };

  return (
    <section className="wr-connect-screen" aria-label="Connect page">
      <header className="wr-connect-header">
        <div className="wr-connect-kicker">
          <Globe2 size={14} />
          <span>Connect</span>
        </div>
        <h2>Share places. Discover through people.</h2>
        <p>Places recommended by friends and the Wandreel community.</p>
      </header>

      <div className="wr-connect-segmented" role="tablist" aria-label="Connect tabs">
        <button
          type="button"
          className={`wr-connect-segment ${activeTab === "shared-with-me" ? "is-active" : ""}`}
          role="tab"
          aria-selected={activeTab === "shared-with-me"}
          onClick={() => setActiveTab("shared-with-me")}
        >
          Shared with me
        </button>
        <button
          type="button"
          className={`wr-connect-segment ${activeTab === "shared-by-me" ? "is-active" : ""}`}
          role="tab"
          aria-selected={activeTab === "shared-by-me"}
          onClick={() => setActiveTab("shared-by-me")}
        >
          Shared by me
        </button>
      </div>

      <div className="wr-connect-body">
        {activeTab === "shared-with-me" ? (
          <article className="wr-connect-empty-card" aria-live="polite">
            <div className="wr-connect-empty-icon">
              <Users size={20} />
            </div>
            <h3>Nothing shared yet</h3>
            <p>When friends send you Wandreel places, they’ll appear here.</p>
            <button type="button" className="wr-connect-cta" onClick={handleInviteFriend}>
              Invite a friend
            </button>
          </article>
        ) : sharedByMe.length ? (
          <div className="wr-connect-shared-list">
            {sharedByMe.map((place) => (
              <article key={place.id} className="wr-connect-place-card">
                <img
                  src={place.imageUrl || categoryImageByLabel[place.category]}
                  alt={place.title}
                  className="wr-connect-place-image"
                />
                <div className="wr-connect-place-body">
                  <div className="wr-connect-place-top">
                    <div>
                      <p className="wr-connect-place-label">{place.category}</p>
                      <h3>{place.title}</h3>
                    </div>
                    <span className="wr-connect-global-badge">
                      <Sparkles size={11} />
                      Global
                    </span>
                  </div>
                  <p className="wr-connect-place-location">{place.locality || place.fullAddress}</p>
                  <div className="wr-connect-place-actions">
                    <button type="button" className="wr-connect-card-btn" onClick={() => void handleSharePlace(place)}>
                      <Share2 size={14} />
                      Share
                    </button>
                    <button
                      type="button"
                      className="wr-connect-card-btn is-secondary"
                      onClick={() => void handleRemoveSharedPlace(place)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <article className="wr-connect-empty-card" aria-live="polite">
            <div className="wr-connect-empty-icon">
              <Camera size={20} />
            </div>
            <h3>You haven’t shared anything yet</h3>
            <p>Make a saved place global to help others discover it.</p>
            <button type="button" className="wr-connect-cta" onClick={onViewSavedPlaces}>
              View saved places
            </button>
          </article>
        )}
      </div>
    </section>
  );
}
