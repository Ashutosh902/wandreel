/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptySavedPlacesByCategory,
  readSavedPlacesByCategory,
  setSavedPlacesCacheUser,
  writeSavedPlacesByCategory,
} from "./savedPlaces";

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
