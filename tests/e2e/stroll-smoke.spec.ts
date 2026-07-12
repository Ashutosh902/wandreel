import { expect, test, type Page, type Route } from "playwright/test";

type StrollStatus = "draft" | "queued" | "curating" | "ready" | "failed" | "archived";
type OnboardingDecision = "unseen" | "accepted" | "declined";

type StrollSummary = {
  id: string;
  name: string;
  description: string | null;
  city: string;
  status: StrollStatus;
  source: "onboarding" | "hero" | "manual" | "saved_places";
  startDate: string | null;
  endDate: string | null;
  requestedStartTime: string | null;
  travellerCount: number | null;
  interests: string[];
  latitude: number | null;
  longitude: number | null;
  totalDistanceMeters: number | null;
  estimatedDurationMinutes: number | null;
  stopCount: number;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  updatedAt: string;
  curatedAt: string | null;
  archivedAt: string | null;
};

type StrollStop = {
  id: string;
  placeId: string;
  placeTitle: string;
  placeCategory: string;
  placeLocality: string;
  placeAddress: string;
  placeDescription: string | null;
  placeImageUrl: string | null;
  placeVideoUrl: string | null;
  latitude: number;
  longitude: number;
  sequence: number;
  reason: string | null;
  generatedDescription: string | null;
  descriptionGenerationMeta: unknown | null;
  estimatedVisitDurationMinutes: number | null;
  arrivalEstimate: string | null;
  departureEstimate: string | null;
  routeDistanceMeters: number | null;
  routeDurationMinutes: number | null;
  suitability: {
    weather: "indoor" | "outdoor" | "sheltered" | "unknown";
    openingHours: unknown | null;
    notes: string[];
  };
};

type ApiState = {
  onboardingDecision: OnboardingDecision;
  bookmarkKeys: Set<string>;
  strolls: StrollSummary[];
  stopsByStrollId: Map<string, StrollStop[]>;
  statusSequences: Map<string, StrollStatus[]>;
  liveMode: "alerts" | "unavailable" | "none";
  adaptationMode: "recommended" | "none";
  listShouldFail: boolean;
};

const user = {
  userId: "user-e2e",
  customerId: "customer-e2e",
  email: "e2e@example.test",
  emailVerified: true,
  phoneNumber: null,
  phoneVerified: false,
  displayName: "E2E Stroller",
  avatarUrl: null,
  authProvider: "EMAIL",
};

const heroCard = {
  type: "city_category_insight",
  cardKey: "hero-patna-food",
  title: "Patna food trail is ready",
  subtitle: "3 Taste saves can become a route for today.",
  ctaLabel: "Build trail",
  ctaAction: "build_food_trail",
  metadata: {
    targetCategory: "Taste",
    targetCity: "Patna",
    matchingPlaceIds: ["taste-1", "taste-2", "taste-3"],
  },
};

const savedPlaces = [
  savedPlace("taste-1", "Litti Corner", "Taste", 25.5941, 85.1376),
  savedPlace("taste-2", "Kachori Stop", "Taste", 25.5961, 85.1396),
  savedPlace("taste-3", "Tea Ghat", "Taste", 25.5981, 85.1416),
  savedPlace("explore-1", "Golghar", "Explore", 25.612, 85.143),
];

function savedPlace(placeId: string, title: string, category: string, lat: number, lng: number) {
  return {
    placeId,
    title,
    category,
    createdAt: "2026-07-11T10:00:00.000Z",
    metadata: {
      locality: "Patna",
      city: "Patna",
      state: "Bihar",
      country: "India",
      fullAddress: `${title}, Patna`,
      imageUrl: "",
      videoUrl: placeId === "taste-1" ? "https://example.com/reel" : "",
      lat,
      lng,
    },
  };
}

function strollSummary(id: string, status: StrollStatus, overrides: Partial<StrollSummary> = {}): StrollSummary {
  return {
    id,
    name: overrides.name || "Patna Stroll",
    description: null,
    city: "Patna",
    status,
    source: "manual",
    startDate: "2026-07-12",
    endDate: "2026-07-12",
    requestedStartTime: "10:30",
    travellerCount: 2,
    interests: ["Food", "Heritage"],
    latitude: 25.5941,
    longitude: 85.1376,
    totalDistanceMeters: 1200,
    estimatedDurationMinutes: 90,
    stopCount: 2,
    failureCode: status === "failed" ? "provider_timeout" : null,
    failureMessage: status === "failed" ? "Curation timed out." : null,
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:00:00.000Z",
    curatedAt: status === "ready" ? "2026-07-11T10:01:00.000Z" : null,
    archivedAt: null,
    ...overrides,
  };
}

function defaultStops(): StrollStop[] {
  return [
    {
      id: "stop-golghar",
      placeId: "explore-1",
      placeTitle: "Golghar",
      placeCategory: "Explore",
      placeLocality: "Patna",
      placeAddress: "Golghar, Patna",
      placeDescription: "A landmark stop from saved place metadata.",
      placeImageUrl: null,
      placeVideoUrl: null,
      latitude: 25.612,
      longitude: 85.143,
      sequence: 1,
      reason: "Starts with the landmark while the weather is clear.",
      generatedDescription: null,
      descriptionGenerationMeta: null,
      estimatedVisitDurationMinutes: 25,
      arrivalEstimate: null,
      departureEstimate: null,
      routeDistanceMeters: null,
      routeDurationMinutes: null,
      suitability: { weather: "outdoor", openingHours: null, notes: [] },
    },
    {
      id: "stop-museum",
      placeId: "taste-1",
      placeTitle: "Bihar Museum Cafe",
      placeCategory: "Taste",
      placeLocality: "Patna",
      placeAddress: "Bihar Museum, Patna",
      placeDescription: null,
      placeImageUrl: null,
      placeVideoUrl: "https://example.com/reel",
      latitude: 25.611,
      longitude: 85.124,
      sequence: 2,
      reason: "Keeps the food break indoors.",
      generatedDescription: "A calm indoor break pulled from saved metadata.",
      descriptionGenerationMeta: { model: "test" },
      estimatedVisitDurationMinutes: 35,
      arrivalEstimate: null,
      departureEstimate: null,
      routeDistanceMeters: 1100,
      routeDurationMinutes: 14,
      suitability: { weather: "indoor", openingHours: null, notes: [] },
    },
  ];
}

function createApiState(overrides: Partial<ApiState> = {}): ApiState {
  const ready = strollSummary("ready-stroll", "ready");
  return {
    onboardingDecision: "accepted",
    bookmarkKeys: new Set(),
    strolls: [ready],
    stopsByStrollId: new Map([[ready.id, defaultStops()]]),
    statusSequences: new Map(),
    liveMode: "none",
    adaptationMode: "recommended",
    listShouldFail: false,
    ...overrides,
  };
}

async function installAppHarness(page: Page, state: ApiState) {
  await page.addInitScript(({ sessionUser }) => {
    window.localStorage.setItem("wr_auth_session_snapshot_v1", JSON.stringify({
      user: sessionUser,
      savedAtMs: Date.now(),
    }));
    window.localStorage.setItem("wr_current_location_v1", JSON.stringify({
      lat: 25.5941,
      lng: 85.1376,
      label: "Patna, Bihar",
    }));
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          success({
            coords: {
              latitude: 25.5941,
              longitude: 85.1376,
              accuracy: 10,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
        watchPosition() {
          return 1;
        },
        clearWatch() {
          return undefined;
        },
      },
    });
  }, { sessionUser: user });

  await page.route("**/api/**", (route) => handleApiRoute(route, state));
}

async function handleApiRoute(route: Route, state: ApiState) {
  const request = route.request();
  const url = new URL(request.url());
  const method = request.method();
  const pathname = url.pathname;
  const ok = (body: unknown) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  const fail = (status: number, error: string) => route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, error }),
  });

  if (pathname === "/api/auth/session/me") return ok({ ok: true, user });
  if (pathname === "/api/analytics/app-event") return ok({ ok: true, recorded: true });
  if (pathname === "/api/location/reverse-geocode") return ok({ ok: true, label: "Patna, Bihar" });
  if (pathname === "/api/saved-places" && method === "GET") return ok({ ok: true, items: savedPlaces });
  if (pathname === "/api/hero-card") return ok(heroCard);

  if (pathname === "/api/hero-bookmarks" && method === "GET") {
    return ok({
      ok: true,
      bookmarks: [...state.bookmarkKeys].map((cardKey) => ({ cardKey })),
    });
  }
  if (pathname === "/api/hero-bookmarks" && method === "POST") {
    const body = request.postDataJSON() as { cardKey?: string };
    if (body.cardKey) state.bookmarkKeys.add(body.cardKey);
    return ok({ ok: true });
  }
  if (pathname === "/api/hero-bookmarks/remove" && method === "POST") {
    const body = request.postDataJSON() as { cardKey?: string };
    if (body.cardKey) state.bookmarkKeys.delete(body.cardKey);
    return ok({ ok: true });
  }

  if (pathname === "/api/stroll/onboarding" && method === "GET") {
    return ok({ ok: true, onboarding: onboardingPayload(state.onboardingDecision) });
  }
  if (pathname === "/api/stroll/onboarding" && method === "PATCH") {
    const body = request.postDataJSON() as { decision?: OnboardingDecision };
    state.onboardingDecision = body.decision === "declined" ? "declined" : "accepted";
    return ok({ ok: true, onboarding: onboardingPayload(state.onboardingDecision) });
  }

  if (pathname === "/api/strolls" && method === "GET") {
    if (state.listShouldFail) return fail(503, "Stroll service unavailable.");
    return ok({ ok: true, strolls: state.strolls.filter((stroll) => stroll.status !== "archived") });
  }
  if (pathname === "/api/strolls" && method === "POST") {
    const body = request.postDataJSON() as { city?: string };
    const city = String(body.city || "Patna").trim() || "Patna";
    const created = strollSummary(`draft-${state.strolls.length + 1}`, "draft", {
      name: `${city} Stroll`,
      city,
      source: "manual",
      stopCount: 0,
    });
    state.strolls = [created, ...state.strolls];
    state.stopsByStrollId.set(created.id, []);
    return ok({ ok: true, created: true, stroll: created });
  }

  const updateMatch = pathname.match(/^\/api\/strolls\/([^/]+)$/);
  if (updateMatch && method === "PATCH") {
    const stroll = findStroll(state, updateMatch[1]);
    if (!stroll) return fail(404, "not_found");
    const body = request.postDataJSON() as {
      name?: string;
      city?: string;
      startDate?: string | null;
      endDate?: string | null;
      requestedStartTime?: string | null;
      travellerCount?: number | null;
      interests?: string[];
      latitude?: number | null;
      longitude?: number | null;
    };
    const updated = {
      ...stroll,
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : stroll.name,
      city: typeof body.city === "string" && body.city.trim() ? body.city.trim() : stroll.city,
      startDate: body.startDate ?? stroll.startDate,
      endDate: body.endDate ?? stroll.endDate,
      requestedStartTime: body.requestedStartTime ?? stroll.requestedStartTime,
      travellerCount: body.travellerCount ?? stroll.travellerCount,
      interests: Array.isArray(body.interests) ? body.interests : stroll.interests,
      latitude: body.latitude ?? stroll.latitude,
      longitude: body.longitude ?? stroll.longitude,
      updatedAt: "2026-07-11T10:03:00.000Z",
    };
    state.strolls = state.strolls.map((item) => (item.id === stroll.id ? updated : item));
    return ok({ ok: true, stroll: updated });
  }

  const statusMatch = pathname.match(/^\/api\/strolls\/([^/]+)\/status$/);
  if (statusMatch && method === "GET") {
    const stroll = findStroll(state, statusMatch[1]);
    if (!stroll) return fail(404, "not_found");
    const sequence = state.statusSequences.get(stroll.id);
    const nextStatus = sequence?.shift();
    if (nextStatus) updateStrollStatus(state, stroll.id, nextStatus);
    return ok({ ok: true, stroll: findStroll(state, stroll.id) });
  }

  const retryMatch = pathname.match(/^\/api\/strolls\/([^/]+)\/retry$/);
  if (retryMatch && method === "POST") {
    const stroll = findStroll(state, retryMatch[1]);
    if (!stroll) return fail(404, "not_found");
    updateStrollStatus(state, stroll.id, "queued");
    state.statusSequences.set(stroll.id, ["curating", "ready"]);
    return ok({ ok: true, stroll: findStroll(state, stroll.id) });
  }

  const liveMatch = pathname.match(/^\/api\/strolls\/([^/]+)\/live-conditions$/);
  if (liveMatch && method === "GET") {
    return ok({ ok: true, live: livePayload(liveMatch[1], state.liveMode) });
  }

  const adaptationMatch = pathname.match(/^\/api\/strolls\/([^/]+)\/adaptation-recommendation$/);
  if (adaptationMatch && method === "GET") {
    const stops = getStops(state, adaptationMatch[1]);
    return ok({ ok: true, recommendation: adaptationPayload(stops, state.adaptationMode) });
  }

  const reorderMatch = pathname.match(/^\/api\/strolls\/([^/]+)\/reorder$/);
  if (reorderMatch && method === "POST") {
    const stroll = findStroll(state, reorderMatch[1]);
    if (!stroll) return fail(404, "not_found");
    const body = request.postDataJSON() as { stopIds?: string[] };
    const stopIds = Array.isArray(body.stopIds) ? body.stopIds : [];
    const currentStops = getStops(state, stroll.id);
    if (stopIds.length !== currentStops.length) return fail(400, "invalid_order");
    const orderedStops = stopIds.map((stopId, index) => {
      const stop = currentStops.find((item) => item.id === stopId);
      if (!stop) return null;
      return { ...stop, sequence: index + 1 };
    });
    if (orderedStops.some((stop) => stop === null)) return fail(400, "invalid_order");
    state.stopsByStrollId.set(stroll.id, orderedStops as StrollStop[]);
    return ok({ ok: true, stroll: { ...stroll, stops: orderedStops } });
  }

  const detailMatch = pathname.match(/^\/api\/strolls\/([^/]+)$/);
  if (detailMatch && method === "GET") {
    const stroll = findStroll(state, detailMatch[1]);
    if (!stroll) return fail(404, "not_found");
    return ok({ ok: true, stroll: { ...stroll, stops: getStops(state, stroll.id) } });
  }

  return ok({ ok: true });
}

function onboardingPayload(decision: OnboardingDecision) {
  return {
    decision,
    decisionAt: decision === "unseen" ? null : "2026-07-11T10:00:00.000Z",
    defaultTravellerCount: null,
    defaultInterests: [],
    defaultStartTime: null,
  };
}

function findStroll(state: ApiState, encodedId: string) {
  const strollId = decodeURIComponent(encodedId);
  return state.strolls.find((stroll) => stroll.id === strollId) || null;
}

function updateStrollStatus(state: ApiState, strollId: string, status: StrollStatus) {
  state.strolls = state.strolls.map((stroll) => (
    stroll.id === strollId
      ? {
        ...stroll,
        status,
        failureCode: status === "failed" ? stroll.failureCode : null,
        failureMessage: status === "failed" ? stroll.failureMessage : null,
        curatedAt: status === "ready" ? "2026-07-11T10:02:00.000Z" : stroll.curatedAt,
        updatedAt: "2026-07-11T10:02:00.000Z",
      }
      : stroll
  ));
}

function getStops(state: ApiState, strollId: string) {
  return [...(state.stopsByStrollId.get(strollId) || [])].sort((a, b) => a.sequence - b.sequence);
}

function livePayload(strollId: string, mode: ApiState["liveMode"]) {
  const now = "2026-07-11T10:00:00.000Z";
  const expiry = "2026-07-11T11:00:00.000Z";
  if (mode === "unavailable") {
    return {
      strollId,
      status: "unavailable",
      fetchedTimestamp: now,
      expiryTimestamp: null,
      conditions: [],
      providers: [{
        provider: "open_meteo",
        conditionType: "weather",
        status: "failed",
        fetchedTimestamp: now,
        expiryTimestamp: null,
        conditions: [],
        errorCode: "provider_unavailable",
        errorMessage: "Weather provider unavailable.",
      }],
    };
  }
  const conditions = mode === "alerts"
    ? [{
      id: "weather-1",
      provider: "open_meteo",
      conditionType: "weather",
      severity: "moderate",
      confidence: 0.8,
      sourceTimestamp: now,
      fetchedTimestamp: now,
      expiryTimestamp: expiry,
      message: "Light rain expected near stop 1.",
      payload: { precipitation: 1.2 },
    }]
    : [];
  return {
    strollId,
    status: "available",
    fetchedTimestamp: now,
    expiryTimestamp: expiry,
    conditions,
    providers: [{
      provider: "open_meteo",
      conditionType: "weather",
      status: "success",
      fetchedTimestamp: now,
      expiryTimestamp: expiry,
      conditions,
    }],
  };
}

function adaptationPayload(stops: StrollStop[], mode: ApiState["adaptationMode"]) {
  const originalStopIds = stops.map((stop) => stop.id);
  const proposedStops = [...stops].reverse();
  const proposedStopIds = proposedStops.map((stop) => stop.id);
  if (mode === "none" || stops.length < 2) {
    return {
      status: "none",
      originalStopIds,
      proposedStopIds: originalStopIds,
      reason: "No reliable adaptation is available with the current verified inputs.",
      evidence: [],
      confidence: "low",
      limitations: ["Live inputs are incomplete."],
    };
  }
  return {
    status: "recommended",
    originalStopIds,
    proposedStopIds,
    proposedSequence: proposedStops.map((stop, index) => ({
      stopId: stop.id,
      placeId: stop.placeId,
      title: stop.placeTitle,
      fromSequence: stop.sequence,
      toSequence: index + 1,
    })),
    reason: "Start indoors first because verified weather indicates a brief shower window.",
    evidence: [
      {
        type: "time_context",
        currentTime: "2026-07-11T10:00:00.000Z",
        requestedStartTime: "10:30",
      },
      {
        type: "stop_suitability",
        stopId: proposedStops[0].id,
        stopTitle: proposedStops[0].placeTitle,
        weather: proposedStops[0].suitability.weather,
        openingHoursAvailable: false,
      },
    ],
    confidence: "medium",
    limitations: ["Traffic providers are not configured."],
  };
}

test("authenticated Discover loads and hero primary CTA still opens food trail", async ({ page }) => {
  await installAppHarness(page, createApiState({ strolls: [] }));

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Your walking plans" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Build trail" })).toBeVisible();

  await page.getByRole("button", { name: "Build trail" }).click();

  await expect(page).toHaveURL(/\/trail\/food$/);
  await expect(page.getByRole("heading", { name: "Build from your saved places" })).toBeVisible();
});

test("onboarding accept persists and opens Stroll creation", async ({ page }) => {
  const state = createApiState({ onboardingDecision: "unseen", strolls: [] });
  await installAppHarness(page, state);

  await page.goto("/");
  await expect(page.getByRole("dialog", { name: "Want Wandreel to shape your saved places into Strolls?" })).toBeVisible();

  await page.getByRole("button", { name: "Create a Stroll" }).click();

  await expect(page).toHaveURL(/\/stroll\/create$/);
  await expect(page.getByRole("region", { name: "Create a new Stroll" })).toBeVisible();
  expect(state.onboardingDecision).toBe("accepted");
});

test("onboarding decline does not repeat and manual Stroll entry remains available", async ({ page }) => {
  const state = createApiState({ onboardingDecision: "unseen", strolls: [] });
  await installAppHarness(page, state);

  await page.goto("/");
  await page.getByRole("button", { name: "Not now" }).click();

  await expect(page.getByRole("dialog", { name: "Want Wandreel to shape your saved places into Strolls?" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Create a new Stroll draft" })).toBeVisible();
  expect(state.onboardingDecision).toBe("declined");

  await page.reload();
  await expect(page.getByRole("dialog", { name: "Want Wandreel to shape your saved places into Strolls?" })).toBeHidden();
  await page.getByRole("button", { name: "Create a new Stroll draft" }).click();
  await expect(page).toHaveURL(/\/stroll\/create$/);
});

test("manual draft creation submits once and refreshes the library", async ({ page }) => {
  const state = createApiState({ onboardingDecision: "declined", strolls: [] });
  await installAppHarness(page, state);

  await page.goto("/");
  await page.getByRole("button", { name: "Create a new Stroll draft" }).click();
  await page.getByLabel("City").fill("Gaya");
  await page.getByLabel("Start date").fill("2026-07-12");
  await page.getByLabel("End date").fill("2026-07-13");
  await page.getByLabel("Start time").fill("10:30");
  await page.getByLabel("Travellers").fill("3");
  await page.getByRole("button", { name: "Art" }).click();

  await page.getByRole("button", { name: "Create draft Stroll" }).click();

  await expect(page).toHaveURL(/\/stroll\/draft-1\/edit$/);
  await expect(page.getByRole("button", { name: "Generate My Stroll" })).toBeVisible();
  await expect(page.getByText("Gaya Stroll saved as a draft.")).toBeVisible();
  expect(state.strolls.filter((stroll) => stroll.name === "Gaya Stroll")).toHaveLength(1);

  await page.getByLabel("Travellers").fill("4");
  await expect(page.getByText("Saved just now")).toBeVisible();
  expect(state.strolls.find((stroll) => stroll.id === "draft-1")?.travellerCount).toBe(4);
});

test("curation polling reaches ready and failed Stroll retry queues again", async ({ page }) => {
  const queued = strollSummary("queued-stroll", "queued", { name: "Queued Patna Stroll" });
  const failed = strollSummary("failed-stroll", "failed", { name: "Failed Patna Stroll" });
  const state = createApiState({
    strolls: [queued, failed],
    statusSequences: new Map([[queued.id, ["curating", "ready"]]]),
  });
  state.stopsByStrollId.set(queued.id, defaultStops());
  state.stopsByStrollId.set(failed.id, defaultStops());
  await installAppHarness(page, state);

  await page.goto("/");

  await expect(page.getByRole("article").filter({ hasText: "Queued Patna Stroll" }).filter({ hasText: "Ready" })).toBeVisible();
  await page.getByRole("button", { name: "Retry curation for Failed Patna Stroll" }).click();
  await expect(page.getByText("Stroll retry queued.")).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Failed Patna Stroll" }).filter({ hasText: "Ready" })).toBeVisible();
});

test("ready Stroll detail shows fallback map, live unavailable, and adaptation dismiss", async ({ page }) => {
  const state = createApiState({ liveMode: "unavailable", adaptationMode: "recommended" });
  await installAppHarness(page, state);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/");
  await page.getByRole("button", { name: "Start or view Patna Stroll" }).click();

  await expect(page).toHaveURL(/\/stroll\/ready-stroll$/);
  await expect(page.getByRole("heading", { name: "Golghar", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Begin Here" })).toBeVisible();
  await expect(page.getByText("Map preview unavailable")).toBeVisible();
  await expect(page.getByText("Weather provider unavailable.")).toBeVisible();
  const mapSectionBox = await page.getByTestId("stroll-map-section").boundingBox();
  expect(mapSectionBox).not.toBeNull();
  expect(mapSectionBox!.y).toBeGreaterThanOrEqual((page.viewportSize()?.height || 0) - 4);

  await page.getByRole("button", { name: "Begin Here" }).click();
  await page.getByRole("button", { name: "Close stop details" }).click();
  await expect(page.getByRole("region", { name: "Route notes" })).toBeVisible();
  await page.getByRole("button", { name: "Keep the current Stroll order" }).click();
  await expect(page.getByRole("region", { name: "Route notes" })).toBeHidden();
});

test("adaptation accept persists reordered stops and bookmark state hydrates from backend", async ({ page }) => {
  const state = createApiState({ liveMode: "alerts", adaptationMode: "recommended" });
  await installAppHarness(page, state);

  await page.goto("/");
  await page.getByRole("button", { name: "Save hero idea" }).click();
  await expect(page.getByText("Hero idea bookmarked.")).toBeVisible();
  expect(state.bookmarkKeys.has("hero-patna-food")).toBe(true);

  await page.evaluate(() => {
    window.localStorage.removeItem("wr_hero_card_freshness_v1:user-e2e");
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove saved hero idea" })).toBeVisible();

  await page.getByRole("button", { name: "Start or view Patna Stroll" }).click();
  await page.getByRole("button", { name: "Accept the proposed Stroll stop order" }).click();

  await expect(page.getByRole("heading", { name: "Bihar Museum Cafe", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Begin Here" }).click();
  await expect(page.getByRole("dialog", { name: "Bihar Museum Cafe" })).toBeVisible();
});

test("Stroll library error state is visible when the backend is unavailable", async ({ page }) => {
  await installAppHarness(page, createApiState({ listShouldFail: true, strolls: [] }));

  await page.goto("/");

  await expect(page.getByText("Could not load Strolls")).toBeVisible();
  await expect(page.getByText("Stroll service unavailable.")).toBeVisible();
});
