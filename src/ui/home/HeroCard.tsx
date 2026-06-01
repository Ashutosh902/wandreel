import { Footprints } from "lucide-react";

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
