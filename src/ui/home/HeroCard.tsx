import { Footprints } from "lucide-react";

export function HeroCard() {
  return (
    <section className="wr-hero-card">
      <div className="wr-hero-overlay" />
      <div className="wr-hero-glow wr-hero-glow-right" />
      <div className="wr-hero-glow wr-hero-glow-left" />
      <div className="wr-hero-content">
        <h2>
          Patna memories, ready to stroll
          <Footprints size={25} className="wr-hero-footprints" aria-hidden="true" />
        </h2>
      </div>
    </section>
  );
}
