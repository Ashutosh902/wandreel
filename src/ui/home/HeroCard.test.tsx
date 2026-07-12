/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HeroCard } from "./HeroCard";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

test("HeroCard renders bookmark icon button with unbookmarked accessible label", () => {
  const html = renderToStaticMarkup(
    <HeroCard
      mode="city-memory"
      title="Turn your Patna saves into a weekend Stroll"
      subtitle="Your saved places can shape a calm route for today."
      ctaLabel="Create Stroll"
      onCtaClick={() => undefined}
      onBookmarkToggle={() => undefined}
    />,
  );

  assert.match(html, /aria-label="Save hero idea"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, />Create Stroll</);
});

test("HeroCard renders bookmarked accessible label without changing primary CTA", () => {
  const html = renderToStaticMarkup(
    <HeroCard
      mode="city-memory"
      title="Your Patna food Stroll is ready"
      subtitle="3 Taste saves can shape today's route."
      ctaLabel="Begin Here"
      onCtaClick={() => undefined}
      isBookmarked
      onBookmarkToggle={() => undefined}
    />,
  );

  assert.match(html, /aria-label="Remove saved hero idea"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, />Begin Here</);
});
