/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDraftStrollPayload,
  canShowManualStrollEntry,
  canSubmitDraftStroll,
  createDraftStroll,
  shouldShowStrollOnboardingPrompt,
  updateStrollOnboardingDecision,
} from "./strollOnboarding";

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

test("prompt eligibility only passes for authenticated unseen Discover home state", () => {
  const base = {
    isAuthenticated: true,
    decision: "unseen" as const,
    activeTab: "Discover" as const,
    activeCategory: null,
    plannerRoute: "home" as const,
    isReadySheetOpen: false,
    isPromptDismissed: false,
  };

  assert.equal(shouldShowStrollOnboardingPrompt(base), true);
  assert.equal(shouldShowStrollOnboardingPrompt({ ...base, isAuthenticated: false }), false);
  assert.equal(shouldShowStrollOnboardingPrompt({ ...base, decision: "declined" }), false);
  assert.equal(shouldShowStrollOnboardingPrompt({ ...base, activeTab: "Add" }), false);
  assert.equal(shouldShowStrollOnboardingPrompt({ ...base, activeCategory: "Taste" }), false);
  assert.equal(shouldShowStrollOnboardingPrompt({ ...base, plannerRoute: "food-trail" }), false);
  assert.equal(shouldShowStrollOnboardingPrompt({ ...base, isReadySheetOpen: true }), false);
});

test("accept flow persists accepted and makes prompt ineligible", async () => {
  const mock = createFetchMock({
    ok: true,
    onboarding: { decision: "accepted", decisionAt: "now", defaultTravellerCount: null, defaultInterests: [] },
  });

  const onboarding = await updateStrollOnboardingDecision("https://api.test", "accepted", mock.fetcher);

  assert.equal(onboarding.decision, "accepted");
  assert.equal(mock.calls[0]?.url, "https://api.test/api/stroll/onboarding");
  assert.equal(mock.calls[0]?.init?.method, "PATCH");
  assert.equal(shouldShowStrollOnboardingPrompt({
    isAuthenticated: true,
    decision: onboarding.decision,
    activeTab: "Discover",
    activeCategory: null,
    plannerRoute: "home",
    isReadySheetOpen: false,
    isPromptDismissed: false,
  }), false);
});

test("decline flow persists declined and does not repeat automatically", async () => {
  const mock = createFetchMock({
    ok: true,
    onboarding: { decision: "declined", decisionAt: "now", defaultTravellerCount: null, defaultInterests: [] },
  });

  const onboarding = await updateStrollOnboardingDecision("https://api.test", "declined", mock.fetcher);

  assert.equal(onboarding.decision, "declined");
  assert.equal(shouldShowStrollOnboardingPrompt({
    isAuthenticated: true,
    decision: onboarding.decision,
    activeTab: "Discover",
    activeCategory: null,
    plannerRoute: "home",
    isReadySheetOpen: false,
    isPromptDismissed: false,
  }), false);
});

test("manual Stroll entry remains available after decline", () => {
  assert.equal(canShowManualStrollEntry({
    isAuthenticated: true,
    activeTab: "Discover",
    activeCategory: null,
  }), true);
});

test("draft submission sends minimal manual payload", async () => {
  const draft = buildDraftStrollPayload({
    clientRequestId: "client-1",
    city: "Patna",
    startDate: "2026-07-12",
    endDate: "2026-07-13",
    requestedStartTime: "10:30",
    travellerCount: 2,
    interests: ["Food", "Heritage"],
    coords: { lat: 25.5941, lng: 85.1376 },
  });
  const mock = createFetchMock({
    ok: true,
    stroll: { id: "stroll-1", name: "Patna Stroll", city: "Patna", status: "draft", source: "manual", stopCount: 0 },
  });

  const stroll = await createDraftStroll("https://api.test/", draft, mock.fetcher);
  const body = JSON.parse(String(mock.calls[0]?.init?.body));

  assert.equal(stroll.id, "stroll-1");
  assert.equal(mock.calls[0]?.url, "https://api.test/api/strolls");
  assert.equal(body.source, "manual");
  assert.equal(body.city, "Patna");
  assert.equal(body.latitude, 25.5941);
  assert.deepEqual(body.placeIds, []);
});

test("duplicate-submit prevention blocks while submitting or missing city", () => {
  assert.equal(canSubmitDraftStroll({ city: "Patna", isSubmitting: false }), true);
  assert.equal(canSubmitDraftStroll({ city: "Patna", isSubmitting: true }), false);
  assert.equal(canSubmitDraftStroll({ city: "   ", isSubmitting: false }), false);
});
