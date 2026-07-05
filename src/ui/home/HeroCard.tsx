type HeroCardMode = "empty-memory" | "city-memory";

export function HeroCard({
  mode,
  title,
  subtitle,
  ctaLabel,
  onCtaClick,
  onSaveIdeaClick,
}: {
  mode: HeroCardMode;
  title: string;
  subtitle: string;
  ctaLabel?: string;
  onCtaClick?: () => void;
  onSaveIdeaClick?: () => void;
}) {
  return (
    <section className={`wr-hero-card wr-hero-card-${mode}`}>
      <div className={`wr-hero-overlay wr-hero-overlay-${mode}`} />
      <div className="wr-hero-glow wr-hero-glow-right" />
      <div className="wr-hero-glow wr-hero-glow-left" />
      <div className="wr-hero-content">
        <div className="wr-hero-copy">
          <h2>{title}</h2>
          <p>{subtitle}</p>
          {ctaLabel ? (
            <button type="button" className="wr-hero-cta" onClick={onCtaClick}>
              {ctaLabel}
            </button>
          ) : null}
          {onSaveIdeaClick ? (
            <button type="button" className="wr-hero-save-idea-btn" onClick={onSaveIdeaClick}>
              Save idea
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
