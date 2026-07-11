/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchHeroBookmarkKeys,
  getHeroBookmarkTogglePlan,
  removeHeroBookmark,
  saveHeroBookmark,
  shouldIgnoreHeroBookmarkClick,
} from "./heroBookmarks";

function createFetchMock(payload: unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    };
  };
  return { calls, fetcher };
}

test("initial backend hydration returns bookmark card keys", async () => {
  const mock = createFetchMock({
    ok: true,
    bookmarks: [{ cardKey: "hero-1" }, { cardKey: "hero-2" }, { cardKey: "hero-1" }],
  });

  const keys = await fetchHeroBookmarkKeys("https://api.test/", mock.fetcher);

  assert.deepEqual(keys, ["hero-1", "hero-2"]);
  assert.equal(mock.calls[0]?.url, "https://api.test/api/hero-bookmarks");
  assert.equal(mock.calls[0]?.init?.credentials, "include");
});

test("bookmark success sends hero bookmark payload", async () => {
  const mock = createFetchMock({ ok: true, bookmark: { cardKey: "hero-1" } });

  await saveHeroBookmark("https://api.test", {
    cardKey: "hero-1",
    heroType: "city_category_insight",
    ctaAction: "build_food_trail",
    title: "Food trail",
    subtitle: "Ready",
    metadata: { matchingPlaceIds: ["place-1", ""] },
  }, mock.fetcher);

  const body = JSON.parse(String(mock.calls[0]?.init?.body));
  assert.equal(mock.calls[0]?.url, "https://api.test/api/hero-bookmarks");
  assert.equal(mock.calls[0]?.init?.method, "POST");
  assert.equal(body.cardKey, "hero-1");
  assert.deepEqual(body.matchingPlaceIds, ["place-1"]);
});

test("unbookmark success sends remove payload", async () => {
  const mock = createFetchMock({ ok: true, removed: true });

  await removeHeroBookmark("https://api.test", "hero-1", mock.fetcher);

  const body = JSON.parse(String(mock.calls[0]?.init?.body));
  assert.equal(mock.calls[0]?.url, "https://api.test/api/hero-bookmarks/remove");
  assert.equal(mock.calls[0]?.init?.method, "POST");
  assert.deepEqual(body, { cardKey: "hero-1" });
});

test("optimistic rollback plan keeps previous keys available after failure", async () => {
  const previousKeys = ["hero-1"];
  const plan = getHeroBookmarkTogglePlan(previousKeys, "hero-2");
  const mock = createFetchMock({ ok: false, error: "failed" }, 500);

  await assert.rejects(() => saveHeroBookmark("https://api.test", {
    cardKey: "hero-2",
    heroType: "city_category_insight",
    ctaAction: "view_city_plan",
    title: "Plan",
    subtitle: "Ready",
    metadata: {},
  }, mock.fetcher));

  assert.deepEqual(plan.nextKeys, ["hero-2", "hero-1"]);
  assert.deepEqual(previousKeys, ["hero-1"]);
});

test("duplicate-click protection ignores the pending card", () => {
  assert.equal(shouldIgnoreHeroBookmarkClick("hero-1", "hero-1"), true);
  assert.equal(shouldIgnoreHeroBookmarkClick("hero-1", "hero-2"), false);
  assert.equal(shouldIgnoreHeroBookmarkClick(null, "hero-1"), false);
});

test("primary CTA behavior remains independent from bookmark toggle state", () => {
  const plan = getHeroBookmarkTogglePlan([], "hero-1");

  assert.deepEqual(plan.nextKeys, ["hero-1"]);
  assert.equal(plan.endpoint, "add");
});
