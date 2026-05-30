import { MapPin } from "lucide-react";
import { useUx } from "../layout/UxProvider";

export function LocationSelector({ inline = false }: { inline?: boolean }) {
  const { currentLocationLabel, isLocating, requestCurrentLocation } = useUx();
  return (
    <section className={`wr-location-section${inline ? " wr-location-section-inline" : ""}`}>
      <div className="wr-location-pill">
        <div className="wr-location-main">
          <MapPin size={16} className="wr-location-icon" />
          <p className="wr-location-text">{currentLocationLabel}</p>
        </div>
        <button type="button" className="wr-location-change" onClick={() => void requestCurrentLocation()}>
          {isLocating ? "Locating..." : "Change"}
        </button>
      </div>
    </section>
  );
}
