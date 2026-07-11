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
      title="Patna plan is ready"
      subtitle="Your saved places can shape a weekend route."
      ctaLabel="Plan weekend"
      onCtaClick={() => undefined}
      onBookmarkToggle={() => undefined}
    />,
  );

  assert.match(html, /aria-label="Save hero idea"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, />Plan weekend</);
});

test("HeroCard renders bookmarked accessible label without changing primary CTA", () => {
  const html = renderToStaticMarkup(
    <HeroCard
      mode="city-memory"
      title="Patna food trail is ready"
      subtitle="3 Taste saves can become a route for today."
      ctaLabel="Build trail"
      onCtaClick={() => undefined}
      isBookmarked
      onBookmarkToggle={() => undefined}
    />,
  );

  assert.match(html, /aria-label="Remove saved hero idea"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, />Build trail</);
});
