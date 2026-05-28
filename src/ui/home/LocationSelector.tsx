import { MapPin } from "lucide-react";

export function LocationSelector({ inline = false }: { inline?: boolean }) {
  return (
    <section className={`wr-location-section${inline ? " wr-location-section-inline" : ""}`}>
      <div className="wr-location-pill">
        <div className="wr-location-main">
          <MapPin size={16} className="wr-location-icon" />
          <p className="wr-location-text">Patna, Bihar</p>
        </div>
        <button type="button" className="wr-location-change">Change</button>
      </div>
    </section>
  );
}
