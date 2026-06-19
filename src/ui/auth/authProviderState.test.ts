/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { shouldIgnoreAuthRefreshResult } from "./authProviderState";
import {
  createEmptySavedPlacesByCategory,
  readSavedPlacesByCategory,
  setSavedPlacesCacheUser,
  writeSavedPlacesByCategory,
} from "../home/savedPlaces";

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

test("stale revalidation success after logout stays unauthenticated and does not restore private cache", () => {
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

  const shouldIgnore = shouldIgnoreAuthRefreshResult({
    resultAborted: false,
    currentRequestId: null,
    requestId: 1,
    currentAuthVersion: 1,
    requestAuthVersion: 0,
  });

  setSavedPlacesCacheUser(null);

  assert.equal(shouldIgnore, true);
  assert.deepEqual(readSavedPlacesByCategory(), createEmptySavedPlacesByCategory());
});
