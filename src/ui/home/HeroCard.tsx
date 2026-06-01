import { Camera, Compass, Footprints, MapPinned } from "lucide-react";

type HeroCardMode = "empty-memory" | "city-memory";

export function HeroCard({
  mode,
  title,
  subtitle,
}: {
  mode: HeroCardMode;
  title: string;
  subtitle: string;
}) {
  return (
    <section className={`wr-hero-card wr-hero-card-${mode}`}>
      <div className={`wr-hero-overlay wr-hero-overlay-${mode}`} />
      {mode === "empty-memory" ? (
        <div className="wr-hero-illustration" aria-hidden="true">
          <div className="wr-hero-cloud wr-hero-cloud-one" />
          <div className="wr-hero-cloud wr-hero-cloud-two" />
          <div className="wr-hero-globe-ring wr-hero-globe-ring-back" />
          <div className="wr-hero-globe">
            <div className="wr-hero-globe-continents wr-hero-globe-continents-one" />
            <div className="wr-hero-globe-continents wr-hero-globe-continents-two" />
            <div className="wr-hero-globe-shine" />
          </div>
          <div className="wr-hero-globe-ring wr-hero-globe-ring-front" />
          <div className="wr-hero-trail wr-hero-trail-one" />
          <div className="wr-hero-trail wr-hero-trail-two" />
          <div className="wr-hero-doodle wr-hero-doodle-pin">
            <MapPinned size={16} />
          </div>
          <div className="wr-hero-doodle wr-hero-doodle-camera">
            <Camera size={15} />
          </div>
          <div className="wr-hero-doodle wr-hero-doodle-compass">
            <Compass size={15} />
          </div>
          <div className="wr-hero-postcard wr-hero-postcard-one" />
          <div className="wr-hero-postcard wr-hero-postcard-two" />
          <div className="wr-hero-skyline" />
        </div>
      ) : null}
      <div className="wr-hero-glow wr-hero-glow-right" />
      <div className="wr-hero-glow wr-hero-glow-left" />
      <div className="wr-hero-content">
        <div className="wr-hero-copy">
          <h2>
            {title}
            <Footprints size={25} className="wr-hero-footprints" aria-hidden="true" />
          </h2>
          <p>{subtitle}</p>
        </div>
      </div>
    </section>
  );
}
