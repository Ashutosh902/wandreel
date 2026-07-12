/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHeroCardContent } from "./heroCardContent";
import type { SavedPlaceRecord } from "./savedPlaces";

function createPlace(overrides: Partial<SavedPlaceRecord> = {}): SavedPlaceRecord {
  return {
    id: overrides.id || "place-1",
    placeId: overrides.placeId || overrides.id || "place-1",
    title: overrides.title || "Sample Place",
    category: overrides.category || "Explore",
    distanceKm: 0.1,
    metaPrimary: "",
    metaSecondary: "",
    locality: overrides.locality || "Dhanaut",
    city: overrides.city || "Patna",
    state: overrides.state || "Bihar",
    country: null,
    fullAddress: "",
    videoUrl: "",
    imageUrl: "",
    tags: [],
    createdAtMs: 1,
    ...overrides,
  };
}

function createCard(overrides: Partial<{
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaAction: string;
  heroState: "suggestion" | "ready_stroll";
  metadata: Record<string, unknown>;
}> = {}) {
  return {
    title: "Verbose title",
    subtitle: "Verbose subtitle",
    ctaLabel: "Very long CTA label",
    ctaAction: "add_first_place",
    heroState: "suggestion" as const,
    metadata: {},
    ...overrides,
  };
}

test("suggestion food trail cards become invitation copy", () => {
  const card = normalizeHeroCardContent(createCard({
    ctaAction: "build_food_trail",
    metadata: {
      targetCity: "Bengaluru",
      matchingPlaceIds: ["1", "2", "3"],
    },
  }), "Mumbai, Maharashtra");

  assert.equal(card.title, "Build a Bengaluru food Stroll");
  assert.equal(card.subtitle, "3 Taste saves can shape today's route.");
  assert.equal(card.ctaLabel, "Build Stroll");
});

test("suggestion city plan cards use invitation language", () => {
  const card = normalizeHeroCardContent(createCard({
    ctaAction: "view_city_plan",
    metadata: { targetCity: "Bengaluru" },
  }), "Mumbai, Maharashtra");

  assert.equal(card.title, "Turn your Bengaluru saves into a weekend Stroll");
  assert.equal(card.subtitle, "Your saved places can shape a calm route for today.");
  assert.equal(card.ctaLabel, "Create Stroll");
});

test("suggestion grow-saved cards stay calm and avoid ready language", () => {
  const card = normalizeHeroCardContent(createCard({
    ctaAction: "grow_saved_places",
    metadata: {
      targetCity: "Bengaluru",
      remainingTastePlaces: 2,
    },
  }), "Mumbai, Maharashtra");

  assert.equal(card.title, "Food trail taking shape");
  assert.equal(card.subtitle, "Save 2 more food places in Bengaluru.");
  assert.equal(card.ctaLabel, "Add places");
});

test("default add-place card uses the current city", () => {
  const card = normalizeHeroCardContent(createCard({
    ctaAction: "add_first_place",
  }), "Bengaluru, Karnataka");

  assert.equal(card.title, "Start your Bengaluru list");
  assert.equal(card.subtitle, "Save places from reels and plan them later.");
  assert.equal(card.ctaLabel, "Add a place");
});

test("explore-dominant cards map to the weekend plan pattern", () => {
  const card = normalizeHeroCardContent(createCard({
    ctaAction: "view_dominant_category",
    metadata: {
      targetCity: "Jaipur",
      targetCategory: "Explore",
    },
  }), "Mumbai, Maharashtra");

  assert.equal(card.title, "Turn your Jaipur saves into a weekend Stroll");
  assert.equal(card.ctaLabel, "Create Stroll");
});

test("planning copy uses city over locality when the location label starts with a locality", () => {
  const card = normalizeHeroCardContent(
    createCard({ ctaAction: "view_city_plan" }),
    "Dhanaut, Bihar",
    [
      createPlace({ locality: "Dhanaut", city: "Patna", state: "Bihar" }),
      createPlace({ id: "2", locality: "Kankarbagh", city: "Patna", state: "Bihar" }),
    ],
  );

  assert.equal(card.title, "Turn your Patna saves into a weekend Stroll");
});

test("ready-stroll copy keeps the ready language", () => {
  const card = normalizeHeroCardContent(createCard({
    heroState: "ready_stroll",
    ctaAction: "view_city_plan",
    metadata: { targetCity: "Bengaluru" },
  }), "Mumbai, Maharashtra");

  assert.equal(card.title, "Your Bengaluru Weekend Stroll is ready");
  assert.equal(card.ctaLabel, "Begin Here");
});

test("Patna Division normalizes to Patna in hero copy", () => {
  const card = normalizeHeroCardContent(
    createCard({
      ctaAction: "view_city_plan",
      metadata: { targetCity: "Patna Division" },
    }),
    "Patna Division, Bihar",
  );

  assert.equal(card.title, "Turn your Patna saves into a weekend Stroll");
});

test("legitimate city names remain intact", () => {
  const card = normalizeHeroCardContent(
    createCard({
      ctaAction: "view_city_plan",
      metadata: { targetCity: "New Delhi" },
    }),
    "New Delhi, Delhi",
  );

  assert.equal(card.title, "Turn your New Delhi saves into a weekend Stroll");
});
