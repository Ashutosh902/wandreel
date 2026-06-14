import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import {
  getRecentlyAddedSavedPlaces,
  mergeSavedPlacesFromApi,
  readSavedPlacesByCategory,
  type SavedPlaceApiItem,
  type SavedPlaceRecord,
} from "../src/ui/home/savedPlaces.ts";

type StorageMap = Record<string, string>;

class MockLocalStorage {
  private store: StorageMap = {};

  getItem(key: string) {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }

  setItem(key: string, value: string) {
    this.store[key] = String(value);
  }

  removeItem(key: string) {
    delete this.store[key];
  }

  clear() {
    this.store = {};
  }
}

const mockStorage = new MockLocalStorage();

beforeEach(() => {
  mockStorage.clear();
  (globalThis as typeof globalThis & { window?: unknown; CustomEvent?: unknown }).window = {
    localStorage: mockStorage,
    dispatchEvent: () => true,
  } as never;
  (globalThis as typeof globalThis & { CustomEvent?: unknown }).CustomEvent = class CustomEvent {
    type: string;
    detail: unknown;

    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  } as never;
});

function makePlace(overrides: Partial<SavedPlaceRecord> & Pick<SavedPlaceRecord, "id" | "title" | "locality" | "category">): SavedPlaceRecord {
  return {
    id: overrides.id,
    placeId: overrides.placeId ?? overrides.id,
    title: overrides.title,
    category: overrides.category,
    distanceKm: overrides.distanceKm ?? 0.1,
    metaPrimary: overrides.metaPrimary ?? "Restaurant",
    metaSecondary: overrides.metaSecondary ?? "",
    locality: overrides.locality,
    city: overrides.city ?? null,
    state: overrides.state ?? null,
    country: overrides.country ?? null,
    fullAddress: overrides.fullAddress ?? overrides.locality,
    videoUrl: overrides.videoUrl ?? "https://example.com/video",
    imageUrl: overrides.imageUrl ?? "https://example.com/image.jpg",
    tags: overrides.tags ?? ["Saved"],
    intent: overrides.intent ?? null,
    lat: overrides.lat ?? null,
    lng: overrides.lng ?? null,
    isGlobal: overrides.isGlobal ?? false,
    sharedVisibility: overrides.sharedVisibility ?? "private",
    sharedAt: overrides.sharedAt,
    createdAtMs: overrides.createdAtMs ?? 0,
  };
}

test("recently added sorts newest first and keeps missing timestamps at the bottom", () => {
  const places = [
    makePlace({ id: "old", title: "Old", locality: "A", category: "Taste", createdAtMs: 1000 }),
    makePlace({ id: "new", title: "New", locality: "B", category: "Taste", createdAtMs: 3000 }),
    makePlace({ id: "mid", title: "Mid", locality: "C", category: "Taste", createdAtMs: 2000 }),
    makePlace({ id: "missing", title: "Missing", locality: "D", category: "Taste", createdAtMs: 0 }),
  ];

  const recent = getRecentlyAddedSavedPlaces(places, 7);

  assert.deepEqual(
    recent.map((place) => place.id),
    ["new", "mid", "old", "missing"],
  );
});

test("recently added caps the list at seven items", () => {
  const places = Array.from({ length: 9 }, (_, index) =>
    makePlace({
      id: `place-${index}`,
      title: `Place ${index}`,
      locality: `Locality ${index}`,
      category: "Explore",
      createdAtMs: 1000 + index,
    }),
  );

  const recent = getRecentlyAddedSavedPlaces(places, 7);

  assert.equal(recent.length, 7);
  assert.deepEqual(
    recent.map((place) => place.id),
    ["place-8", "place-7", "place-6", "place-5", "place-4", "place-3", "place-2"],
  );
});

test("api merge preserves existing timestamps instead of restamping with now", () => {
  const existing: Record<string, SavedPlaceRecord[]> = {
    Taste: [
      makePlace({
        id: "same-place",
        placeId: "same-place",
        title: "Same Place",
        locality: "Patna",
        category: "Taste",
        createdAtMs: 12345,
      }),
    ],
    Activity: [],
    Stay: [],
    Explore: [],
  };
  mockStorage.setItem("wr_category_saved_feed_v1", JSON.stringify(existing));

  const apiItem: SavedPlaceApiItem = {
    placeId: "same-place",
    title: "Same Place",
    category: "Taste",
    metadata: {
      locality: "Patna",
      fullAddress: "Patna, Bihar",
      metaPrimary: "Restaurant",
      metaSecondary: "Dinner",
    },
  };

  mergeSavedPlacesFromApi([apiItem]);
  const next = readSavedPlacesByCategory();

  assert.equal(next.Taste[0]?.createdAtMs, 12345);
});

