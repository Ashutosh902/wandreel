import { expect, test, type Page, type Route } from "playwright/test";

test.describe.configure({ mode: "serial" });

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
  draftCreateCount: number;
  archiveCount: number;
};

type StrollDetailConsoleEvent = {
  event?: string;
  [key: string]: unknown;
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
  heroState: "suggestion",
  title: "Build a Patna food Stroll",
  subtitle: "3 Taste saves can shape today's route.",
  ctaLabel: "Build Stroll",
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
    draftCreateCount: 0,
    archiveCount: 0,
    ...overrides,
  };
}

function collectStrollDetailConsoleEvents(page: Page) {
  const events: StrollDetailConsoleEvent[] = [];
  page.on("console", async (message) => {
    if (message.type() !== "info") return;
    const args = message.args();
    const prefix = await args[0]?.jsonValue().catch(() => null);
    if (prefix !== "[stroll-detail]") return;
    const payload = await args[1]?.jsonValue().catch(() => null);
    if (payload && typeof payload === "object") {
      events.push(payload as StrollDetailConsoleEvent);
    }
  });
  return events;
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
  // Only mock Wandreel API traffic. Google Maps uses /maps/api/js, and a broad
  // API mock would turn that script into JSON and break the real map loader.
  if (!["127.0.0.1", "localhost", "api.wandreel.com"].includes(url.hostname)) {
    return route.continue();
  }
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
    state.draftCreateCount += 1;
    const body = request.postDataJSON() as {
      city?: string;
      startDate?: string | null;
      endDate?: string | null;
      requestedStartTime?: string | null;
      travellerCount?: number | null;
      interests?: string[];
      latitude?: number | null;
      longitude?: number | null;
    };
    const city = String(body.city || "Patna").trim() || "Patna";
    const created = strollSummary(`draft-${state.strolls.length + 1}`, "draft", {
      name: `${city} Stroll`,
      city,
      source: "manual",
      startDate: body.startDate ?? null,
      endDate: body.endDate ?? null,
      requestedStartTime: body.requestedStartTime ?? null,
      travellerCount: body.travellerCount ?? null,
      interests: Array.isArray(body.interests) ? body.interests : [],
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
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

  const curateMatch = pathname.match(/^\/api\/strolls\/([^/]+)\/curate$/);
  if (curateMatch && method === "POST") {
    const stroll = findStroll(state, curateMatch[1]);
    if (!stroll) return fail(404, "not_found");
    updateStrollStatus(state, stroll.id, "queued");
    state.statusSequences.set(stroll.id, ["curating", "ready"]);
    state.stopsByStrollId.set(stroll.id, defaultStops());
    return ok({
      ok: true,
      stroll: findStroll(state, stroll.id),
      job: { id: `job-${stroll.id}`, status: "queued" },
      duplicate: false,
    });
  }

  const archiveMatch = pathname.match(/^\/api\/strolls\/([^/]+)\/archive$/);
  if (archiveMatch && method === "POST") {
    const stroll = findStroll(state, archiveMatch[1]);
    if (!stroll) return fail(404, "not_found");
    state.archiveCount += 1;
    state.strolls = state.strolls.map((item) => (
      item.id === stroll.id
        ? {
          ...item,
          status: "archived",
          archivedAt: "2026-07-11T10:04:00.000Z",
          updatedAt: "2026-07-11T10:04:00.000Z",
        }
        : item
    ));
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
  await expect(page.getByRole("button", { name: "Build Stroll" })).toBeVisible();

  await page.getByRole("button", { name: "Build Stroll" }).click();

  await expect(page).toHaveURL(/\/trail\/food$/);
  await expect(page.getByRole("heading", { name: "Build from your saved places" })).toBeVisible();
});

test("draft stroll cards open the existing draft editor from the body or editing action", async ({ page }) => {
  const draft = strollSummary("draft-stroll", "draft", {
    name: "Patna Stroll",
    city: "Patna",
    source: "manual",
    stopCount: 0,
  });
  const state = createApiState({
    onboardingDecision: "declined",
    strolls: [draft],
    stopsByStrollId: new Map([[draft.id, []]]),
  });
  await installAppHarness(page, state);

  await page.goto("/");

  const draftCard = page.getByRole("button", { name: "Open draft Patna Stroll for editing" });
  await expect(draftCard).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue editing Patna Stroll" })).toBeVisible();

  await draftCard.click();
  await expect(page).toHaveURL(/\/stroll\/draft-stroll\/edit$/);
  await expect(page.getByRole("button", { name: "Generate My Stroll" })).toBeVisible();
  await expect(state.draftCreateCount).toBe(0);

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/$/);

  await draftCard.focus();
  await page.keyboard.press("Space");
  await expect(page).toHaveURL(/\/stroll\/draft-stroll\/edit$/);
  await expect(page.getByRole("button", { name: "Generate My Stroll" })).toBeVisible();
  await expect(state.draftCreateCount).toBe(0);
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
  await page.getByLabel("Travellers").selectOption("3");
  await page.getByRole("button", { name: "Art" }).click();

  await page.getByRole("button", { name: "Save Draft" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Gaya Stroll saved as a draft.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue editing Gaya Stroll" })).toBeVisible();
  expect(state.strolls.filter((stroll) => stroll.name === "Gaya Stroll")).toHaveLength(1);

  await page.getByRole("button", { name: "Continue editing Gaya Stroll" }).click();
  await expect(page).toHaveURL(/\/stroll\/draft-1\/edit$/);
  await expect(page.getByRole("button", { name: "Generate My Stroll" })).toBeVisible();
  await page.getByLabel("Travellers").selectOption("4");
  await expect(page.getByText("Saved just now")).toBeVisible();
  expect(state.strolls.find((stroll) => stroll.id === "draft-1")?.travellerCount).toBe(4);
});

test("save and generate returns home with a working Stroll card", async ({ page }) => {
  const state = createApiState({ onboardingDecision: "declined", strolls: [] });
  await installAppHarness(page, state);

  await page.goto("/");
  await page.getByRole("button", { name: "Create a new Stroll draft" }).click();
  await page.getByLabel("City").fill("Nalanda");
  await page.getByRole("button", { name: "Heritage" }).click();
  await page.getByRole("button", { name: "Save & Generate" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Nalanda Stroll is being prepared.")).toBeVisible();
  await expect(page.getByRole("button", { name: "View progress for Nalanda Stroll" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete Nalanda Stroll" })).toBeVisible();
  expect(state.draftCreateCount).toBe(1);
  expect(["queued", "curating"]).toContain(state.strolls.find((stroll) => stroll.id === "draft-1")?.status);
});

test.describe("visual Draft Stroll lifecycle", () => {
  test("creates, reopens, generates, opens, and deletes through the browser", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const state = createApiState({ onboardingDecision: "declined", strolls: [] });
    await installAppHarness(page, state);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your walking plans" })).toBeVisible();

    await page.getByRole("button", { name: "Create a new Stroll draft" }).click();
    await expect(page).toHaveURL(/\/stroll\/create$/);
    await page.getByLabel("City").fill("Patna");
    await expect(page.getByRole("button", { name: "Food" })).toHaveClass(/is-selected/);
    await page.getByRole("button", { name: "Heritage" }).click();
    await expect(page.getByRole("button", { name: "Heritage" })).toHaveClass(/is-selected/);
    await page.getByRole("button", { name: "Save Draft" }).click();

    await expect(page).toHaveURL(/\/$/);
    const draftCard = page.getByRole("button", { name: "Open draft Patna Stroll for editing" });
    await expect(draftCard).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("01-draft-card-before-click.png"), fullPage: true });

    const hitDiagnostics = await draftCard.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + 24;
      const y = rect.top + 56;
      const hit = document.elementFromPoint(x, y);
      const styles = window.getComputedStyle(element);
      return {
        role: element.getAttribute("role"),
        tabIndex: element.getAttribute("tabindex"),
        pointerEvents: styles.pointerEvents,
        hitTag: hit?.tagName || null,
        hitClass: hit instanceof HTMLElement ? hit.className : null,
        cardContainsHitTarget: Boolean(hit && element.contains(hit)),
      };
    });
    await testInfo.attach("draft-card-hit-target.json", {
      body: JSON.stringify(hitDiagnostics, null, 2),
      contentType: "application/json",
    });
    expect(hitDiagnostics.role).toBe("button");
    expect(hitDiagnostics.pointerEvents).not.toBe("none");
    expect(hitDiagnostics.cardContainsHitTarget).toBe(true);

    await draftCard.click({ position: { x: 24, y: 56 } });
    await expect(page).toHaveURL(/\/stroll\/draft-1\/edit$/);
    await expect(page.getByLabel("City")).toHaveValue("Patna");
    await expect(page.getByRole("button", { name: "Food" })).toHaveClass(/is-selected/);
    await expect(page.getByRole("button", { name: "Heritage" })).toHaveClass(/is-selected/);
    await expect(page.getByRole("button", { name: "Generate My Stroll" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("02-draft-editor-after-card-click.png"), fullPage: true });
    await page.screenshot({ path: testInfo.outputPath("03-food-heritage-preserved.png"), fullPage: true });
    expect(state.draftCreateCount).toBe(1);
    expect(state.strolls.filter((stroll) => stroll.id === "draft-1")).toHaveLength(1);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole("button", { name: "Continue editing Patna Stroll" }).click();
    await expect(page).toHaveURL(/\/stroll\/draft-1\/edit$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole("button", { name: "Open draft Patna Stroll for editing" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/stroll\/draft-1\/edit$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole("button", { name: "Open draft Patna Stroll for editing" }).focus();
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/\/stroll\/draft-1\/edit$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await page.reload();
    await expect(page.getByRole("button", { name: "Open draft Patna Stroll for editing" })).toBeVisible();
    await page.getByRole("button", { name: "Open draft Patna Stroll for editing" }).click({ position: { x: 24, y: 56 } });
    await expect(page).toHaveURL(/\/stroll\/draft-1\/edit$/);
    await expect(page.getByLabel("City")).toHaveValue("Patna");
    await expect(page.getByRole("button", { name: "Food" })).toHaveClass(/is-selected/);
    await expect(page.getByRole("button", { name: "Heritage" })).toHaveClass(/is-selected/);
    expect(state.draftCreateCount).toBe(1);

    await page.getByRole("button", { name: "Generate My Stroll" }).click();
    await expect(page.getByRole("heading", { name: /Curating|Ready to start/ })).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: testInfo.outputPath("04-curating-state.png"), fullPage: true });

    await expect(page.getByText("Ready to start")).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: testInfo.outputPath("05-ready-state.png"), fullPage: true });

    await page.getByRole("button", { name: "Start Stroll" }).click();
    await expect(page).toHaveURL(/\/stroll\/draft-1$/);
    await expect(page.getByTestId("stroll-first-stop-title")).toContainText("Start at Golghar");
    await expect(page.getByTestId("stroll-first-view").getByRole("button", { name: "Start Stroll" })).toBeVisible();
    await expect(page.locator('[aria-label="Next journey action"]')).toBeVisible();
    await expect(page.locator('[aria-label="Next journey action"]')).toContainText("Next: Golghar");
    await page.getByTestId("stroll-map-section").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("stroll-map-section")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("06-guided-journey-open.png"), fullPage: true });

    const finalTimelineRow = page.getByRole("button", { name: /Open details for stop 2: Bihar Museum Cafe/ });
    await finalTimelineRow.evaluate((element) => element.scrollIntoView({ block: "center" }));
    const finalTimelineBox = await finalTimelineRow.boundingBox();
    const stickyActionBox = await page.locator('[aria-label="Next journey action"]').boundingBox();
    expect(finalTimelineBox).not.toBeNull();
    expect(stickyActionBox).not.toBeNull();
    expect(finalTimelineBox!.y + finalTimelineBox!.height).toBeLessThanOrEqual(stickyActionBox!.y - 6);

    await page.getByRole("button", { name: "Open details for Golghar" }).click();
    await expect(page.getByRole("dialog", { name: "Golghar" })).toBeVisible();
    await expect(page.locator('[aria-label="Next journey action"]')).toBeHidden();

    await page.goto("/");
    await page.getByRole("button", { name: "Create a new Stroll draft" }).click();
    await page.getByLabel("City").fill("Cleanup");
    await page.getByRole("button", { name: "Save Draft" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole("button", { name: "Delete Cleanup Stroll" }).click();
    await expect(page.getByRole("button", { name: "Open draft Cleanup Stroll for editing" })).toBeHidden();
    await page.reload();
    await expect(page.getByRole("button", { name: "Open draft Cleanup Stroll for editing" })).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("07-after-draft-delete.png"), fullPage: true });
    expect(state.archiveCount).toBe(1);
  });
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
  const strollEvents = collectStrollDetailConsoleEvents(page);
  await installAppHarness(page, state);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/");
  await page.getByRole("button", { name: "Start or view Patna Stroll" }).click();

  await expect(page).toHaveURL(/\/stroll\/ready-stroll$/);
  await expect(page.getByTestId("stroll-first-stop-title")).toContainText("Start at Golghar");
  await expect(page.getByTestId("stroll-first-view").getByRole("button", { name: "Start Stroll" })).toBeVisible();
  await expect(page.locator('[aria-label="Next journey action"]')).toContainText("Next: Golghar");
  await expect(page.getByText("Weather provider unavailable.")).toBeVisible();
  await expect(page.getByTestId("stroll-map-section")).toBeVisible();
  await expect.poll(async () => {
    return page.getByTestId("stroll-map-section").evaluate((section) => {
      const hasFallback = section.textContent?.includes("Map preview unavailable") ?? false;
      const hasGoogleMap = Boolean(section.querySelector(".gm-style"));
      return hasFallback || hasGoogleMap;
    });
  }).toBe(true);

  await page.getByRole("button", { name: "Stop 2, Bihar Museum Cafe, upcoming" }).click();
  const secondTimelineRow = page.getByRole("button", { name: "Open details for stop 2: Bihar Museum Cafe, upcoming" });
  await expect(secondTimelineRow).toBeVisible();
  await expect(secondTimelineRow).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("stroll-first-stop-title")).toContainText("Start at Golghar");

  await page.getByRole("button", { name: "Weather details" }).click();
  await expect(page.getByRole("dialog", { name: "Good weather for this Stroll" })).toBeVisible();
  await expect(page.getByText("Current conditions")).toBeVisible();
  await expect(page.getByText("Source")).toBeVisible();
  await page.getByRole("button", { name: "Close weather details" }).click();

  await page.getByRole("button", { name: "Open details for Golghar" }).click();
  await page.getByRole("button", { name: "Close stop details" }).click();
  await expect(page.getByRole("region", { name: "Route status" })).toBeVisible();
  await page.getByRole("button", { name: "View route details" }).click();
  await expect(page.getByRole("dialog", { name: "What we checked" })).toBeVisible();
  await expect(page.getByText("Checked for this Stroll")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "What we checked" })).not.toContainText(/25\.\d+|85\.\d+|2026-\d{2}-\d{2}T/);
  await page.getByRole("button", { name: "Close route details" }).click();
  await page.getByRole("button", { name: "Keep the current Stroll order" }).click();
  await expect(page.getByRole("region", { name: "Route status" })).toBeHidden();

  await page.locator('[aria-label="Next journey action"]').getByRole("button", { name: "Navigate" }).click();
  await expect(page.getByRole("dialog", { name: "Start Stroll and navigate?" })).toBeVisible();
  await expect(page.getByText("You can still mark arrival or completion yourself.")).toBeVisible();
  await expect(page.locator('[aria-label="Next journey action"]')).toBeHidden();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Start Stroll and navigate?" })).toBeHidden();
  await expect(page.getByTestId("stroll-first-stop-title")).toContainText("Start at Golghar");
  await expect(page.getByTestId("stroll-first-view").getByRole("button", { name: "Start Stroll" })).toBeVisible();

  await page.getByTestId("stroll-first-view").getByRole("button", { name: "Start Stroll" }).click();
  await expect(page.getByTestId("stroll-first-stop-title")).toContainText("Current stop: Golghar");
  await expect(page.getByRole("button", { name: "I'm here" })).toBeVisible();

  await page.getByRole("button", { name: "I'm here" }).click();
  await expect(page.getByTestId("stroll-first-stop-title")).toContainText("You're at Golghar");
  await expect(page.getByRole("button", { name: "Mark as visited" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip stop" })).toBeVisible();

  await page.getByRole("button", { name: "Mark as visited" }).click();
  await expect(page.getByTestId("stroll-first-stop-title")).toContainText("Current stop: Bihar Museum Cafe");
  const progressStrip = page.locator(".wr-stroll-progress-card");
  await expect(progressStrip.getByRole("button", { name: "Stop 1, Golghar, completed" })).toBeVisible();
  await expect(progressStrip.getByRole("button", { name: "Stop 2, Bihar Museum Cafe, active" })).toBeVisible();

  await expect.poll(() => strollEvents.map((event) => event.event)).toEqual(
    expect.arrayContaining([
      "stroll_detail_viewed",
      "weather_details_opened",
      "progress_node_selected",
      "itinerary_stop_selected",
      "route_details_opened",
      "route_adaptation_reviewed",
      "route_adaptation_rejected",
      "stroll_started",
      "stop_marked_arrived",
      "stop_completed",
    ]),
  );
  expect(JSON.stringify(strollEvents)).not.toMatch(/25\.\d+|85\.\d+|latitude|longitude/);
});

test("pre-start Navigate asks before starting the Stroll and opening directions", async ({ page }) => {
  const state = createApiState({ liveMode: "unavailable", adaptationMode: "none" });
  await installAppHarness(page, state);
  await page.addInitScript(() => {
    window.localStorage.setItem("wr_test_opened_urls", JSON.stringify([]));
    window.open = (url?: string | URL) => {
      const urls = JSON.parse(window.localStorage.getItem("wr_test_opened_urls") || "[]") as string[];
      urls.push(String(url || ""));
      window.localStorage.setItem("wr_test_opened_urls", JSON.stringify(urls));
      return null;
    };
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Start or view Patna Stroll" }).click();
  await expect(page.getByTestId("stroll-first-stop-title")).toContainText("Start at Golghar");

  await page.getByTestId("stroll-map-section").getByRole("button", { name: "Navigate" }).click();
  await expect(page.getByRole("dialog", { name: "Start Stroll and navigate?" })).toBeVisible();
  await page.getByRole("button", { name: "Start Stroll and navigate" }).click();

  await expect(page.getByTestId("stroll-first-stop-title")).toContainText("Current stop: Golghar");
  await expect(page.getByRole("button", { name: "I'm here" })).toBeVisible();
  await expect(page.locator(".wr-stroll-progress-card").getByRole("button", { name: "Stop 1, Golghar, active" })).toBeVisible();
  const openedUrls = await page.evaluate(() => JSON.parse(window.localStorage.getItem("wr_test_opened_urls") || "[]") as string[]);
  expect(openedUrls).toHaveLength(1);
  expect(openedUrls[0]).toContain("https://www.google.com/maps/search/");
  expect(openedUrls[0]).toContain("25.612%2C85.143");
});

test("skip flow keeps the skipped stop in the itinerary and advances the journey", async ({ page }) => {
  const state = createApiState({ liveMode: "unavailable", adaptationMode: "none" });
  await installAppHarness(page, state);

  await page.goto("/");
  await page.getByRole("button", { name: "Start or view Patna Stroll" }).click();
  await page.getByTestId("stroll-first-view").getByRole("button", { name: "Start Stroll" }).click();
  await page.getByRole("button", { name: "I'm here" }).click();
  await expect(page.getByTestId("stroll-first-stop-title")).toContainText("You're at Golghar");

  await page.getByRole("button", { name: "Skip stop" }).click();
  await expect(page.getByRole("dialog", { name: "Skip Golghar?" })).toBeVisible();
  await expect(page.getByText("This stop will stay in your Stroll")).toBeVisible();
  await page.getByRole("button", { name: "Skip this stop" }).click();

  await expect(page.getByTestId("stroll-first-stop-title")).toContainText("Current stop: Bihar Museum Cafe");
  await expect(page.getByRole("button", { name: "Stop 1, Golghar, skipped" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop 2, Bihar Museum Cafe, active" })).toBeVisible();
  await expect(page.locator('[aria-label="Next journey action"]')).toContainText("Next: Bihar Museum Cafe");
});

test("completing every stop shows completion state and persists after refresh", async ({ page }) => {
  const state = createApiState({ liveMode: "unavailable", adaptationMode: "none" });
  await installAppHarness(page, state);

  await page.goto("/");
  await page.getByRole("button", { name: "Start or view Patna Stroll" }).click();
  await page.getByTestId("stroll-first-view").getByRole("button", { name: "Start Stroll" }).click();

  await page.getByRole("button", { name: "I'm here" }).click();
  await page.getByRole("button", { name: "Mark as visited" }).click();
  await expect(page.getByTestId("stroll-first-stop-title")).toContainText("Current stop: Bihar Museum Cafe");

  await page.getByRole("button", { name: "I'm here" }).click();
  await page.getByRole("button", { name: "Mark as visited" }).click();
  await expect(page.getByTestId("stroll-first-stop-title")).toContainText("Stroll complete");
  await expect(page.getByText("2 stops wrapped.")).toBeVisible();
  await expect(page.getByRole("button", { name: "View completed route" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Return to Strolls" })).toBeVisible();
  await expect(page.locator('[aria-label="Next journey action"]')).toBeHidden();
  await expect(page.getByRole("button", { name: "Stop 1, Golghar, completed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop 2, Bihar Museum Cafe, completed" })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("stroll-first-stop-title")).toContainText("Stroll complete");
  await expect(page.locator('[aria-label="Next journey action"]')).toBeHidden();
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

  await expect(page.getByTestId("stroll-first-stop-title")).toContainText("Start at Bihar Museum Cafe");
  await page.getByRole("button", { name: "Open details for Bihar Museum Cafe" }).click();
  await expect(page.getByRole("dialog", { name: "Bihar Museum Cafe" })).toBeVisible();
});

test("Stroll library error state is visible when the backend is unavailable", async ({ page }) => {
  await installAppHarness(page, createApiState({ listShouldFail: true, strolls: [] }));

  await page.goto("/");

  await expect(page.getByText("Could not load Strolls")).toBeVisible();
  await expect(page.getByText("Stroll service unavailable.")).toBeVisible();
});
