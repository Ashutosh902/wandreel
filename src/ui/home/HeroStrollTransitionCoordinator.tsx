import { HeroCard } from "./HeroCard";
import type { HeroStrollTransitionRequest } from "./heroStrollTransition";

export function HeroStrollTransitionCoordinator({
  transition,
}: {
  transition: HeroStrollTransitionRequest | null;
}) {
  if (!transition) return null;

  const { rect } = transition.source;

  return (
    <div
      className={`wr-hero-stroll-transition-layer ${transition.reducedMotion ? "is-reduced-motion" : ""}`}
      aria-hidden="true"
      style={{
        ["--wr-hero-stroll-transition-duration" as string]: `${transition.durationMs}ms`,
      }}
    >
      <div className="wr-hero-stroll-transition-backdrop" />
      <div
        key={transition.key}
        className="wr-hero-stroll-transition-card"
        style={{
          top: `${rect.top}px`,
          left: `${rect.left}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        }}
      >
        <HeroCard
          mode={transition.source.mode}
          title={transition.source.title}
          subtitle={transition.source.subtitle}
          ctaLabel={transition.source.ctaLabel}
          onCtaClick={() => undefined}
          isPresentationOnly
        />
      </div>
    </div>
  );
}
