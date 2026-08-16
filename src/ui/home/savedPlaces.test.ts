/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptySavedPlacesByCategory,
  mapSavedPlaceApiItem,
  readSavedPlacesByCategory,
  sanitizeSavedPlaceImageForPersistence,
  setSavedPlacesCacheUser,
  writeSavedPlacesByCategory,
} from "./savedPlaces";
import { categoryFallbackImage } from "./addFlowState";

type MockStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function createMockStorage(): MockStorage {
  const store = new Map<string, string>();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

test("saved places cache is scoped by active user", () => {
  const localStorage = createMockStorage();
  Object.assign(globalThis, {
    window: {
      localStorage,
      dispatchEvent: () => true,
    },
    CustomEvent: class CustomEventMock {
      type: string;

      constructor(type: string) {
        this.type = type;
      }
    },
  });

  setSavedPlacesCacheUser("user_a");
  writeSavedPlacesByCategory({
    ...createEmptySavedPlacesByCategory(),
    Taste: [{
      id: "a-1",
      placeId: "a-1",
      title: "Cafe A",
      category: "Taste",
      distanceKm: 0.1,
      metaPrimary: "Cafe",
      metaSecondary: "",
      locality: "Anjuna",
      city: null,
      state: null,
      country: null,
      fullAddress: "Anjuna",
      videoUrl: "",
      imageUrl: "",
      tags: ["Saved"],
      lat: null,
      lng: null,
      isGlobal: false,
      sharedVisibility: "private",
      createdAtMs: 1,
    }],
  });

  setSavedPlacesCacheUser("user_b");
  assert.deepEqual(readSavedPlacesByCategory(), createEmptySavedPlacesByCategory());

  writeSavedPlacesByCategory({
    ...createEmptySavedPlacesByCategory(),
    Explore: [{
      id: "b-1",
      placeId: "b-1",
      title: "Fort B",
      category: "Explore",
      distanceKm: 0.1,
      metaPrimary: "Fort",
      metaSecondary: "",
      locality: "Jaipur",
      city: null,
      state: null,
      country: null,
      fullAddress: "Jaipur",
      videoUrl: "",
      imageUrl: "",
      tags: ["Saved"],
      lat: null,
      lng: null,
      isGlobal: false,
      sharedVisibility: "private",
      createdAtMs: 2,
    }],
  });

  assert.equal(readSavedPlacesByCategory().Explore[0]?.title, "Fort B");

  setSavedPlacesCacheUser("user_a");
  assert.equal(readSavedPlacesByCategory().Taste[0]?.title, "Cafe A");
  assert.equal(readSavedPlacesByCategory().Explore.length, 0);
});

test("saved place API mapping prefers alternate real image fields", () => {
  const mapped = mapSavedPlaceApiItem({
    placeId: "taste-1",
    title: "Craft Coffee",
    category: "Taste",
    metadata: {
      locality: "Sri Krishna Puri",
      photoUrl: "http://example.com/craft.jpg",
    } as never,
  });

  assert.equal(mapped?.imageUrl, "https://example.com/craft.jpg");
});

test("saved place API mapping falls back to nested identification evidence image fields", () => {
  const mapped = mapSavedPlaceApiItem({
    placeId: "taste-2",
    title: "Roastery",
    category: "Taste",
    metadata: {
      locality: "Boring Road",
      identificationEvidence: {
        placeResolution: {
          photoUrl: "http://example.com/roastery.jpg",
        },
      },
    } as never,
  });

  assert.equal(mapped?.imageUrl, "https://example.com/roastery.jpg");
});

test("saved place image persistence strips known placeholder art", () => {
  assert.equal(sanitizeSavedPlaceImageForPersistence(categoryFallbackImage.Taste), null);
  assert.equal(sanitizeSavedPlaceImageForPersistence("https://example.com/real-place.jpg"), "https://example.com/real-place.jpg");
});
