import { Bookmark } from "lucide-react";

type HeroCardMode = "empty-memory" | "city-memory";

export function HeroCard({
  mode,
  title,
  subtitle,
  ctaLabel,
  onCtaClick,
  isBookmarked = false,
  isBookmarkBusy = false,
  onBookmarkToggle,
}: {
  mode: HeroCardMode;
  title: string;
  subtitle: string;
  ctaLabel?: string;
  onCtaClick?: () => void;
  isBookmarked?: boolean;
  isBookmarkBusy?: boolean;
  onBookmarkToggle?: () => void;
}) {
  return (
    <section className={`wr-hero-card wr-hero-card-${mode}`}>
      <div className={`wr-hero-overlay wr-hero-overlay-${mode}`} />
      <div className="wr-hero-glow wr-hero-glow-right" />
      <div className="wr-hero-glow wr-hero-glow-left" />
      {onBookmarkToggle ? (
        <button
          type="button"
          className={`wr-hero-bookmark-btn ${isBookmarked ? "is-bookmarked" : ""}`}
          aria-label={isBookmarked ? "Remove saved hero idea" : "Save hero idea"}
          aria-pressed={isBookmarked}
          disabled={isBookmarkBusy}
          onClick={onBookmarkToggle}
        >
          <Bookmark size={18} fill={isBookmarked ? "currentColor" : "none"} aria-hidden="true" />
        </button>
      ) : null}
      <div className="wr-hero-content">
        <div className="wr-hero-copy">
          <h2>{title}</h2>
          <p>{subtitle}</p>
          {ctaLabel ? (
            <button type="button" className="wr-hero-cta" onClick={onCtaClick}>
              {ctaLabel}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
