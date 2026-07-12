/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHeroStrollTransitionPlan,
  createHeroStrollTransitionCoordinator,
  heroStrollTransitionTokens,
  readReadyStrollId,
  resolveReadyHeroStroll,
} from "./heroStrollTransition";
import type { HeroCardData } from "./useHeroCard";
import type { PersistentStrollSummary } from "./strollLibrary";

function createCard(overrides: Partial<HeroCardData> = {}, ctaAction = "view_city_plan"): HeroCardData {
  return {
    type: "city_category_insight",
    title: "Patna plan is ready",
    subtitle: "Your next Stroll is ready to open.",
    ctaLabel: "Open Stroll",
    ctaAction,
    metadata: {},
    ...overrides,
  };
}

function createStroll(overrides: Partial<PersistentStrollSummary>): PersistentStrollSummary {
  return {
    id: "stroll-1",
    name: "Patna Morning Stroll",
    description: null,
    city: "Patna",
    status: "ready",
    source: "hero",
    startDate: null,
    endDate: null,
    requestedStartTime: null,
    travellerCount: null,
    interests: [],
    latitude: 25.6,
    longitude: 85.1,
    totalDistanceMeters: 1200,
    estimatedDurationMinutes: 90,
    stopCount: 3,
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    curatedAt: "2026-07-12T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

test("ready hero CTA builds a connected transition plan", () => {
  const plan = buildHeroStrollTransitionPlan({
    card: createCard({ readyStrollId: "stroll-1" }),
    strolls: [createStroll({ id: "stroll-1", status: "ready" })],
    source: {
      rect: { top: 24, left: 16, width: 320, height: 196 },
      scrollY: 0,
      mode: "city-memory",
      title: "Patna plan is ready",
      subtitle: "Your next Stroll is ready to open.",
      ctaLabel: "Open Stroll",
    },
    prefersReducedMotion: false,
    featureEnabled: true,
  });

  assert.deepEqual(plan && { kind: plan.kind, strollId: plan.strollId, durationMs: plan.durationMs }, {
    kind: "transition",
    strollId: "stroll-1",
    durationMs: heroStrollTransitionTokens.durationMs,
  });
});

test("non-ready hero actions bypass the new transition path", () => {
  const plan = buildHeroStrollTransitionPlan({
    card: createCard({}, "grow_saved_places"),
    strolls: [createStroll({ id: "stroll-1", status: "ready" })],
    source: {
      rect: { top: 24, left: 16, width: 320, height: 196 },
      scrollY: 0,
      mode: "city-memory",
      title: "Patna plan is ready",
      subtitle: "Your next Stroll is ready to open.",
      ctaLabel: "Open Stroll",
    },
    prefersReducedMotion: false,
    featureEnabled: true,
  });

  assert.equal(plan, null);
});

test("reduced-motion hero entry falls back to a short direct fade plan", () => {
  const plan = buildHeroStrollTransitionPlan({
    card: createCard({ readyStrollId: "stroll-1" }),
    strolls: [createStroll({ id: "stroll-1", status: "ready" })],
    source: {
      rect: { top: 24, left: 16, width: 320, height: 196 },
      scrollY: 0,
      mode: "city-memory",
      title: "Patna plan is ready",
      subtitle: "Your next Stroll is ready to open.",
      ctaLabel: "Open Stroll",
    },
    prefersReducedMotion: true,
    featureEnabled: true,
  });

  assert.equal(plan?.kind, "transition");
  assert.equal(plan?.reducedMotion, true);
  assert.equal(plan?.durationMs, heroStrollTransitionTokens.reducedMotionDurationMs);
});

test("feature flag disabled keeps hero ready stroll navigation direct", () => {
  const plan = buildHeroStrollTransitionPlan({
    card: createCard({ readyStrollId: "stroll-1" }),
    strolls: [createStroll({ id: "stroll-1", status: "ready" })],
    source: {
      rect: { top: 24, left: 16, width: 320, height: 196 },
      scrollY: 0,
      mode: "city-memory",
      title: "Patna plan is ready",
      subtitle: "Your next Stroll is ready to open.",
      ctaLabel: "Open Stroll",
    },
    prefersReducedMotion: false,
    featureEnabled: false,
  });

  assert.equal(plan?.kind, "direct");
});

test("transition helper reads only the canonical readyStrollId field", () => {
  assert.equal(readReadyStrollId(createCard({ readyStrollId: "stroll-1", metadata: { strollId: "legacy-id" } })), "stroll-1");
  assert.equal(readReadyStrollId(createCard({ metadata: { readyStrollId: "nested-only" } })), "");
});

test("hero transition activates for a locally loaded ready stroll", async () => {
  const result = await resolveReadyHeroStroll({
    card: createCard({ readyStrollId: "stroll-1" }),
    strolls: [createStroll({ id: "stroll-1", status: "ready" })],
    strollLibraryState: "ready",
  });

  assert.equal(result?.id, "stroll-1");
});

test("hero transition can verify a ready stroll while the library is still loading", async () => {
  const calls: string[] = [];
  const result = await resolveReadyHeroStroll({
    card: createCard({ readyStrollId: "stroll-1" }),
    strolls: [],
    strollLibraryState: "loading",
    verifyStroll: async (strollId) => {
      calls.push(strollId);
      return createStroll({ id: strollId, status: "ready" });
    },
  });

  assert.equal(result?.id, "stroll-1");
  assert.deepEqual(calls, ["stroll-1"]);
});

test("fallback action remains unchanged when canonical readyStrollId is absent", async () => {
  const result = await resolveReadyHeroStroll({
    card: createCard({}, "build_food_trail"),
    strolls: [createStroll({ id: "stroll-1", status: "ready" })],
    strollLibraryState: "ready",
  });

  assert.equal(result, null);
});

test("transition coordinator does not replay identical requests", async () => {
  const settled: string[] = [];
  const coordinator = createHeroStrollTransitionCoordinator({
    onSettled: (key) => {
      settled.push(key);
    },
    schedule: (callback, delayMs) => setTimeout(callback, delayMs) as unknown as number,
    clearSchedule: (timerId) => clearTimeout(timerId),
  });

  assert.equal(coordinator.arm({ key: "hero-stroll-1", durationMs: 20 }), true);
  assert.equal(coordinator.arm({ key: "hero-stroll-1", durationMs: 20 }), false);

  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.deepEqual(settled, ["hero-stroll-1"]);
  coordinator.destroy();
});

test("transition coordinator cleans up pending work on destroy", async () => {
  const settled: string[] = [];
  const coordinator = createHeroStrollTransitionCoordinator({
    onSettled: (key) => {
      settled.push(key);
    },
    schedule: (callback, delayMs) => setTimeout(callback, delayMs) as unknown as number,
    clearSchedule: (timerId) => clearTimeout(timerId),
  });

  assert.equal(coordinator.arm({ key: "hero-stroll-2", durationMs: 30 }), true);
  coordinator.destroy();

  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.deepEqual(settled, []);
});
