import { Bookmark } from "lucide-react";
import type { Ref } from "react";

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
  containerRef,
  isPresentationOnly = false,
}: {
  mode: HeroCardMode;
  title: string;
  subtitle: string;
  ctaLabel?: string;
  onCtaClick?: () => void;
  isBookmarked?: boolean;
  isBookmarkBusy?: boolean;
  onBookmarkToggle?: () => void;
  containerRef?: Ref<HTMLElement>;
  isPresentationOnly?: boolean;
}) {
  return (
    <section
      ref={containerRef}
      className={`wr-hero-card wr-hero-card-${mode} ${isPresentationOnly ? "is-presentation-only" : ""}`}
    >
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
            <button type="button" className="wr-hero-cta" onClick={onCtaClick} tabIndex={isPresentationOnly ? -1 : 0}>
              {ctaLabel}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
