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
  metadata: Record<string, unknown>;
}> = {}) {
  return {
    title: "Verbose title",
    subtitle: "Verbose subtitle",
    ctaLabel: "Very long CTA label",
    ctaAction: "add_first_place",
    metadata: {},
    ...overrides,
  };
}

test("build food trail cards become short and city-specific", () => {
  const card = normalizeHeroCardContent(createCard({
    ctaAction: "build_food_trail",
    metadata: {
      targetCity: "Bengaluru",
      matchingPlaceIds: ["1", "2", "3"],
    },
  }), "Mumbai, Maharashtra");

  assert.equal(card.title, "Bengaluru food trail is ready");
  assert.equal(card.subtitle, "3 Taste saves can become a route for today.");
  assert.equal(card.ctaLabel, "Build trail");
});

test("city plan cards use the calm weekend pattern", () => {
  const card = normalizeHeroCardContent(createCard({
    ctaAction: "view_city_plan",
    metadata: { targetCity: "Bengaluru" },
  }), "Mumbai, Maharashtra");

  assert.equal(card.title, "Bengaluru plan is ready");
  assert.equal(card.subtitle, "Your saved places can shape a weekend route.");
  assert.equal(card.ctaLabel, "Plan weekend");
});

test("almost-ready food trail cards stay short and city-specific", () => {
  const card = normalizeHeroCardContent(createCard({
    ctaAction: "grow_saved_places",
    metadata: {
      targetCity: "Bengaluru",
      remainingTastePlaces: 2,
    },
  }), "Mumbai, Maharashtra");

  assert.equal(card.title, "Food trail almost ready");
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

  assert.equal(card.title, "Jaipur plan is ready");
  assert.equal(card.ctaLabel, "Plan weekend");
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

  assert.equal(card.title, "Patna plan is ready");
});
