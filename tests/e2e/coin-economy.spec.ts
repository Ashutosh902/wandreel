import { expect, test, type Page } from "playwright/test";

test.describe.configure({ mode: "serial" });

type LedgerTransaction = {
  id: string;
  type: string;
  direction: "credit" | "debit" | "pool_credit" | "pool_debit";
  amountCoins: number;
  amountMillis: number;
  balanceAfterCoins: number | null;
  balanceAfterMillis: number | null;
  relatedPlaceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type CoinState = {
  balanceMillis: number;
  transactions: LedgerTransaction[];
  savedPlaces: Array<Record<string, unknown>>;
  impact?: ReturnType<typeof createImpactPayload>;
  authUser?: typeof user;
  ledgerRequests?: string[];
  ledgerFailuresRemaining?: number;
  onboarding?: {
    eligible: boolean;
    completed: boolean;
    completedAt: string | null;
    completeFailuresRemaining?: number;
  };
  analyticsEvents?: string[];
};

const user = {
  userId: "coin-user-e2e",
  customerId: "coin-user-e2e",
  email: "coin@example.test",
  emailVerified: true,
  phoneNumber: null,
  phoneVerified: false,
  displayName: "Coin Tester",
  avatarUrl: null,
  authProvider: "EMAIL",
};

function coinTransaction(input: Partial<LedgerTransaction> & Pick<LedgerTransaction, "type" | "direction" | "amountMillis">): LedgerTransaction {
  const balanceAfterMillis = input.balanceAfterMillis ?? null;
  return {
    id: input.id || `${input.type}-${Date.now()}-${Math.random()}`,
    type: input.type,
    direction: input.direction,
    amountCoins: input.amountMillis / 1000,
    amountMillis: input.amountMillis,
    balanceAfterCoins: balanceAfterMillis === null ? null : balanceAfterMillis / 1000,
    balanceAfterMillis,
    relatedPlaceId: input.relatedPlaceId ?? null,
    metadata: input.metadata ?? {},
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

function createImpactPayload(input: Partial<{
  balanceMillis: number;
  travelersHelped: number;
  placesAdded: number;
  communitySaves: number;
  placesRecommended: number;
  coinsEarnedMillis: number;
  coinsSavedMillis: number;
  topRecommendations: Array<Record<string, unknown>>;
  monthlyTrend: Array<Record<string, unknown>>;
}> = {}) {
  const balanceMillis = input.balanceMillis ?? 500_000;
  const travelersHelped = input.travelersHelped ?? 482;
  const placesRecommended = input.placesRecommended ?? 63;
  const communitySaves = input.communitySaves ?? travelersHelped;
  const coinsEarnedMillis = input.coinsEarnedMillis ?? 38_000;
  const coinsSavedMillis = input.coinsSavedMillis ?? 24_000;
  return {
    ok: true,
    wallet: {
      userId: user.userId,
      balanceCoins: balanceMillis / 1000,
      balanceMillis,
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T12:00:00.000Z",
    },
    month: {
      earnedMillis: 86_000,
      earnedCoins: 86,
      spentMillis: 41_000,
      spentCoins: 41,
      netMillis: 45_000,
      netCoins: 45,
    },
    impact: {
      travelersHelped,
      placesAdded: input.placesAdded ?? 127,
      communitySaves,
      placesRecommended,
      coinsEarnedMillis,
      coinsEarnedCoins: coinsEarnedMillis / 1000,
      coinsSavedMillis,
      coinsSavedCoins: coinsSavedMillis / 1000,
    },
    contributionScore: {
      score: 84,
      level: "City Curator",
      formula: {
        recommendationsWeight: 30,
        communitySavesWeight: 30,
        recommendationQualityWeight: 20,
        recentActivityWeight: 20,
        recommendationTarget: 50,
        communitySaveTarget: 100,
        qualitySavesPerRecommendationTarget: 5,
        recentActivityTarget: 20,
      },
      components: {
        recommendations: 30,
        communitySaves: 30,
        recommendationQuality: 14,
        recentActivity: 10,
      },
      thresholds: [
        { level: "Explorer", minScore: 0 },
        { level: "Trailblazer", minScore: 20 },
        { level: "Guide", minScore: 40 },
        { level: "Local Expert", minScore: 60 },
        { level: "City Curator", minScore: 80 },
        { level: "Master Explorer", minScore: 95 },
      ],
    },
    summary30Days: {
      recommendations: 12,
      communitySaves: 37,
      coinsEarnedMillis: 14_000,
      coinsEarnedCoins: 14,
      coinsSavedMillis: 8_000,
      coinsSavedCoins: 8,
    },
    monthlyTrend: input.monthlyTrend ?? Array.from({ length: 6 }, (_unused, index) => ({
      month: `2026-${String(index + 2).padStart(2, "0")}`,
      label: new Date(Date.UTC(2026, index + 1, 1)).toLocaleDateString("en", { month: "short", year: "numeric" }),
      coinsEarnedMillis: (index + 1) * 3_000,
      coinsEarnedCoins: (index + 1) * 3,
      communitySaves: (index + 1) * 4,
      recommendations: index + 2,
    })),
    topRecommendations: input.topRecommendations ?? [
      {
        placeId: "blue-tokai",
        title: "Blue Tokai Coffee",
        communitySaves: 143,
        coinsEarnedMillis: 6_700,
        coinsEarnedCoins: 6.7,
        addedAt: "2026-03-04T00:00:00.000Z",
      },
    ],
    cache: { maxAgeSeconds: 60, generatedAt: "2026-07-14T12:00:00.000Z" },
    queryPlan: ["fixture"],
  };
}

async function installCoinApi(page: Page, state: CoinState) {
  const activeUser = () => state.authUser ?? user;
  await page.route("**/api/economy/pricing", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        pricing: {
          coinMillisPerCoin: 1000,
          welcomeGrantCoins: 500,
          welcomeGrantMillis: 500_000,
          externalSaveCoins: 2,
          externalSaveMillis: 2_000,
          discoverSaveCoins: 1,
          discoverSaveMillis: 1_000,
        },
      }),
    });
  });

  await page.route("**/api/economy/onboarding", async (route) => {
    const onboarding = state.onboarding ?? { eligible: false, completed: true, completedAt: null };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, ...onboarding }),
    });
  });

  await page.route("**/api/economy/onboarding/complete", async (route) => {
    const onboarding = state.onboarding ?? { eligible: false, completed: true, completedAt: null };
    if (onboarding.completeFailuresRemaining && onboarding.completeFailuresRemaining > 0) {
      onboarding.completeFailuresRemaining -= 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "Could not save this preference." }),
      });
      return;
    }
    onboarding.completed = true;
    onboarding.completedAt = onboarding.completedAt ?? "2026-07-14T10:30:00.000Z";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, ...onboarding }),
    });
  });

  await page.route("**/api/analytics/app-event", async (route) => {
    const body = route.request().postDataJSON() as { eventType?: string } | null;
    if (body?.eventType) state.analyticsEvents?.push(body.eventType);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, recorded: true }),
    });
  });

  await page.route("**/api/auth/session/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        user: {
          ...activeUser(),
          coinBalance: state.balanceMillis / 1000,
        },
      }),
    });
  });

  await page.route("**/api/economy/impact", async (route) => {
    const payload = state.impact ?? createImpactPayload({ balanceMillis: state.balanceMillis });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...payload,
        wallet: {
          ...payload.wallet,
          userId: activeUser().userId,
          balanceCoins: state.balanceMillis / 1000,
          balanceMillis: state.balanceMillis,
        },
      }),
    });
  });

  await page.route("**/api/economy/ledger**", async (route) => {
    const url = new URL(route.request().url());
    state.ledgerRequests?.push(url.search);
    if (state.ledgerFailuresRemaining && state.ledgerFailuresRemaining > 0) {
      state.ledgerFailuresRemaining -= 1;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "Ledger unavailable." }),
      });
      return;
    }
    const type = url.searchParams.get("type") || "all";
    const sort = url.searchParams.get("sort") || "newest";
    const pageNumber = Math.max(1, Number(url.searchParams.get("page") || "1"));
    let transactions = [...state.transactions];
    if (type === "credit" || type === "debit") {
      transactions = transactions.filter((transaction) => transaction.direction === type);
    }
    transactions.sort((left, right) => {
      if (sort === "oldest") return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      if (sort === "amount_desc") return right.amountMillis - left.amountMillis;
      if (sort === "amount_asc") return left.amountMillis - right.amountMillis;
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
    const pageSize = 25;
    const totalCount = transactions.length;
    const pagedTransactions = transactions.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        wallet: {
          userId: activeUser().userId,
          balanceCoins: state.balanceMillis / 1000,
          balanceMillis: state.balanceMillis,
          createdAt: "2026-07-14T00:00:00.000Z",
          updatedAt: new Date().toISOString(),
        },
        transactions: pagedTransactions,
        pagination: {
          page: pageNumber,
          pageSize,
          totalCount,
          totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
          hasPreviousPage: pageNumber > 1,
          hasNextPage: pageNumber * pageSize < totalCount,
        },
        filters: {
          type,
          datePreset: url.searchParams.get("datePreset") || "6m",
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
          sort,
        },
      }),
    });
  });

  await page.route("**/api/saved-places", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, items: state.savedPlaces }) });
      return;
    }

    const body = route.request().postDataJSON() as {
      placeId?: string;
      title?: string;
      category?: string;
      coinSource?: "external_import" | "discover";
    };
    const chargeMillis = body.coinSource === "discover" ? 1000 : 2000;
    if (state.balanceMillis < chargeMillis) {
      await route.fulfill({
        status: 402,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "Not enough coins for this save." }),
      });
      return;
    }

    state.balanceMillis -= chargeMillis;
    const transactionType = body.coinSource === "discover" ? "discover_save_charge" : "external_save_charge";
    state.transactions.unshift(coinTransaction({
      type: transactionType,
      direction: "debit",
      amountMillis: chargeMillis,
      balanceAfterMillis: state.balanceMillis,
      relatedPlaceId: body.placeId || null,
    }));
    const item = {
      placeId: body.placeId || "place-e2e",
      title: body.title || "Saved Place",
      category: body.category || "Taste",
      createdAt: new Date().toISOString(),
      metadata: { locality: "Patna", fullAddress: "Patna", sharedVisibility: "private" },
    };
    state.savedPlaces.push(item);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        alreadySaved: false,
        item,
        coin: {
          wallet: {
            userId: activeUser().userId,
            balanceCoins: state.balanceMillis / 1000,
            balanceMillis: state.balanceMillis,
            createdAt: "2026-07-14T00:00:00.000Z",
            updatedAt: new Date().toISOString(),
          },
        },
      }),
    });
  });

  await page.route("**/api/hero-card", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ type: "city_category_insight", cardKey: "coin-card", heroState: "suggestion", title: "Taste", subtitle: "", ctaLabel: "", ctaAction: "", priorityScore: 1, reasonCodes: [], metadata: {}, alternatives: [] }),
    });
  });
}

async function seedAuthenticatedSnapshot(page: Page, sessionUser = user) {
  await page.addInitScript((sessionUser) => {
    window.localStorage.setItem("wr_auth_session_snapshot_v1", JSON.stringify({
      user: sessionUser,
      savedAtMs: Date.now(),
    }));
  }, { ...sessionUser, coinBalance: 500 });
}

test("profile shows signup balance and updates after an external save", async ({ page }, testInfo) => {
  const state: CoinState = {
    balanceMillis: 500_000,
    transactions: [coinTransaction({ id: "signup", type: "signup_grant", direction: "credit", amountMillis: 500_000, balanceAfterMillis: 500_000 })],
    savedPlaces: [],
  };
  await seedAuthenticatedSnapshot(page);
  await installCoinApi(page, state);

  await page.goto("/");
  await page.getByRole("button", { name: /login/i }).click();
  await expect(page.getByText("Coin balance")).toBeVisible();
  await expect(page.locator(".wr-profile-coin-balance strong")).toHaveText("500");
  await expect(page.getByText("Welcome coins")).toHaveCount(0);
  await page.screenshot({ path: `artifacts/screenshots/coin-profile-signup-${testInfo.project.name}.png`, fullPage: true });

  const saveResult = await page.evaluate(async () => {
    const response = await fetch("http://localhost:8787/api/saved-places", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        placeId: "external-place",
        title: "External Place",
        category: "Taste",
        coinSource: "external_import",
        idempotencyKey: "external-import-e2e",
        metadata: { locality: "Patna", fullAddress: "Patna" },
      }),
    });
    const payload = await response.json();
    window.dispatchEvent(new CustomEvent("wr:coin-wallet-updated", { detail: { wallet: payload.coin.wallet } }));
    return payload;
  });

  expect(saveResult.coin.wallet.balanceMillis).toBe(498_000);
  await expect(page.locator(".wr-profile-coin-balance strong")).toHaveText("498");
  await expect(page.getByText("External link import")).toHaveCount(0);
  await page.getByRole("button", { name: /open wallet activity/i }).click();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(page.getByText("External link import")).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/coin-wallet-all-after-external-save-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: /back to profile/i }).click();

  const discoverSaveResult = await page.evaluate(async () => {
    const response = await fetch("http://localhost:8787/api/saved-places", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        placeId: "discover-place",
        title: "Discover Place",
        category: "Explore",
        coinSource: "discover",
        idempotencyKey: "discover-save-e2e",
        metadata: { locality: "Patna", fullAddress: "Patna" },
      }),
    });
    const payload = await response.json();
    window.dispatchEvent(new CustomEvent("wr:coin-wallet-updated", { detail: { wallet: payload.coin.wallet } }));
    return payload;
  });

  expect(discoverSaveResult.coin.wallet.balanceMillis).toBe(497_000);
  await expect(page.locator(".wr-profile-coin-balance strong")).toHaveText("497");
  await page.getByRole("button", { name: /open wallet activity/i }).click();
  await expect(page.getByText("Discover save")).toBeVisible();
  await page.getByRole("tab", { name: "Debits" }).click();
  await expect(page.getByText("Discover save")).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/coin-wallet-debits-${testInfo.project.name}.png`, fullPage: true });
});

test("first login coin onboarding completes with Explore Discover", async ({ page }, testInfo) => {
  const state: CoinState = {
    balanceMillis: 500_000,
    transactions: [coinTransaction({ id: "signup", type: "signup_grant", direction: "credit", amountMillis: 500_000, balanceAfterMillis: 500_000 })],
    savedPlaces: [],
    onboarding: { eligible: true, completed: false, completedAt: null },
    analyticsEvents: [],
  };
  await seedAuthenticatedSnapshot(page);
  await installCoinApi(page, state);

  await page.goto("/");
  const welcomeDialog = page.getByRole("dialog", { name: /you received 500 coins/i });
  await expect(welcomeDialog).toBeVisible();
  await expect(welcomeDialog.getByText("Save from Instagram or another link")).toBeVisible();
  await expect(welcomeDialog.getByText("2 coins")).toBeVisible();
  await expect(welcomeDialog.getByText("Save from Discover")).toBeVisible();
  await expect(welcomeDialog.getByText("1 coin", { exact: true })).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/coin-onboarding-welcome-${testInfo.project.name}.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 780 });
  await page.screenshot({ path: `artifacts/screenshots/coin-onboarding-welcome-mobile-${testInfo.project.name}.png`, fullPage: true });

  await page.getByRole("button", { name: "Explore Discover" }).click();
  await expect(page.getByRole("dialog", { name: /you received 500 coins/i })).toBeHidden();
  await expect(page.getByText(/Costs 1 coin/)).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/coin-discover-cost-hint-${testInfo.project.name}.png`, fullPage: true });
  expect(state.onboarding?.completed).toBe(true);
  expect(state.analyticsEvents).toContain("coin_onboarding_viewed");
  expect(state.analyticsEvents).toContain("coin_onboarding_explore_discover_clicked");
  await page.reload();
  await expect(page.getByRole("dialog", { name: /you received 500 coins/i })).toHaveCount(0);
});

test("coin onboarding Add and Got it actions complete without repeat", async ({ page }) => {
  const state: CoinState = {
    balanceMillis: 500_000,
    transactions: [],
    savedPlaces: [],
    onboarding: { eligible: true, completed: false, completedAt: null },
    analyticsEvents: [],
  };
  await seedAuthenticatedSnapshot(page);
  await installCoinApi(page, state);

  await page.goto("/");
  await page.getByRole("button", { name: "Add your first place", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add a Wandreel" })).toBeVisible();
  expect(state.onboarding?.completed).toBe(true);
  expect(state.analyticsEvents).toContain("coin_onboarding_add_place_clicked");

  state.onboarding = { eligible: true, completed: false, completedAt: null };
  await page.reload();
  await expect(page.getByRole("dialog", { name: /you received 500 coins/i })).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByRole("dialog", { name: /you received 500 coins/i })).toBeHidden();
  expect(state.analyticsEvents).toContain("coin_onboarding_dismissed");
});

test("coin onboarding completion failure stays retryable", async ({ page }) => {
  const state: CoinState = {
    balanceMillis: 500_000,
    transactions: [],
    savedPlaces: [],
    onboarding: { eligible: true, completed: false, completedAt: null, completeFailuresRemaining: 1 },
  };
  await seedAuthenticatedSnapshot(page);
  await installCoinApi(page, state);

  await page.goto("/");
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByText("Could not save this preference.")).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByRole("dialog", { name: /you received 500 coins/i })).toBeHidden();
});

test("coin onboarding is per-user and does not repeat after logout-style session changes", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const firstState: CoinState = {
    balanceMillis: 500_000,
    transactions: [],
    savedPlaces: [],
    onboarding: { eligible: true, completed: false, completedAt: null },
  };
  await seedAuthenticatedSnapshot(firstPage);
  await installCoinApi(firstPage, firstState);
  await firstPage.goto("/");
  await firstPage.getByRole("button", { name: "Got it" }).click();
  await firstPage.reload();
  await expect(firstPage.getByRole("dialog", { name: /you received 500 coins/i })).toHaveCount(0);
  await firstContext.close();

  const secondUser = { ...user, userId: "coin-user-e2e-two", customerId: "coin-user-e2e-two", email: "coin-two@example.test" };
  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  const secondState: CoinState = {
    authUser: secondUser,
    balanceMillis: 500_000,
    transactions: [],
    savedPlaces: [],
    onboarding: { eligible: true, completed: false, completedAt: null },
  };
  await seedAuthenticatedSnapshot(secondPage, secondUser);
  await installCoinApi(secondPage, secondState);
  await secondPage.goto("/");
  await expect(secondPage.getByRole("dialog", { name: /you received 500 coins/i })).toBeVisible();
  await secondContext.close();
});

test("insufficient balance blocks save and leaves profile ledger unchanged", async ({ page }, testInfo) => {
  const state: CoinState = {
    balanceMillis: 0,
    transactions: [],
    savedPlaces: [],
  };
  await seedAuthenticatedSnapshot(page);
  await installCoinApi(page, state);

  await page.goto("/");
  await page.getByRole("button", { name: /login/i }).click();
  await expect(page.getByText("Coin balance")).toBeVisible();

  const saveResult = await page.evaluate(async () => {
    const response = await fetch("http://localhost:8787/api/saved-places", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        placeId: "blocked-place",
        title: "Blocked Place",
        category: "Taste",
        coinSource: "external_import",
        idempotencyKey: "blocked-save-e2e",
        metadata: { locality: "Patna", fullAddress: "Patna" },
      }),
    });
    return { status: response.status, payload: await response.json() };
  });

  expect(saveResult.status).toBe(402);
  expect(state.savedPlaces).toHaveLength(0);
  expect(state.transactions).toHaveLength(0);
  await page.getByRole("button", { name: /open wallet activity/i }).click();
  await expect(page.getByText("No wallet activity for these filters.")).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/coin-insufficient-balance-${testInfo.project.name}.png`, fullPage: true });
});

test("wallet filters, custom range, and second page render from ledger API", async ({ page }, testInfo) => {
  const transactions = Array.from({ length: 51 }, (_unused, index) => {
    const number = index + 1;
    return coinTransaction({
      id: `tx-${number}`,
      type: number % 2 === 0 ? "recommender_reward" : "external_save_charge",
      direction: number % 2 === 0 ? "credit" : "debit",
      amountMillis: number,
      balanceAfterMillis: 500_000 - number,
      createdAt: new Date(Date.UTC(2026, 6, 14, 12, 0, number)).toISOString(),
      metadata: { title: `Ledger item ${number}` },
    });
  });
  const state: CoinState = {
    balanceMillis: 500_000,
    transactions,
    savedPlaces: [],
    ledgerRequests: [],
  };
  await seedAuthenticatedSnapshot(page);
  await installCoinApi(page, state);

  await page.goto("/wallet");
  await expect(page.getByRole("heading", { name: "Wallet" })).toBeVisible();
  await page.getByRole("button", { name: "How coins work" }).click();
  await expect(page.getByRole("dialog", { name: "How coins work" })).toBeVisible();
  await expect(page.getByText("Coins are virtual in-app credits and currently have no cash value.")).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/coin-how-coins-work-${testInfo.project.name}.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "How coins work" })).toBeHidden();
  await expect(page.locator(".wr-wallet-transaction-row")).toHaveCount(25);
  await page.screenshot({ path: `artifacts/screenshots/coin-wallet-all-${testInfo.project.name}.png`, fullPage: true });

  await page.getByRole("tab", { name: "Credits" }).click();
  await expect(page.getByText("Community reward").first()).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/coin-wallet-credits-${testInfo.project.name}.png`, fullPage: true });

  await page.getByRole("tab", { name: "Debits" }).click();
  await expect(page.getByText("External link import").first()).toBeVisible();

  await page.getByLabel("Range").selectOption("custom");
  await page.getByRole("textbox", { name: "From" }).fill("2026-07-15");
  await page.getByRole("textbox", { name: "To" }).fill("2026-07-14");
  await expect(page.getByText("End date must be on or after start date.")).toBeVisible();
  await page.getByRole("textbox", { name: "From" }).fill("2026-07-14");
  await page.getByRole("button", { name: "Apply" }).click();
  await page.screenshot({ path: `artifacts/screenshots/coin-wallet-custom-range-${testInfo.project.name}.png`, fullPage: true });

  await page.getByLabel("Range").selectOption("6m");
  await page.getByRole("tab", { name: "All" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText(/Page 2 of 3/)).toBeVisible();
  await expect(page.locator(".wr-wallet-transaction-row")).toHaveCount(25);
  await page.screenshot({ path: `artifacts/screenshots/coin-wallet-page-2-${testInfo.project.name}.png`, fullPage: true });
  await page.getByLabel("Sort").selectOption("oldest");
  await expect(page.getByText(/Page 1 of 3/)).toBeVisible();
  await page.getByLabel("Sort").selectOption("amount_asc");
  await page.getByLabel("Sort").selectOption("amount_desc");
  await page.getByLabel("Range").selectOption("7d");
  await expect.poll(() => state.ledgerRequests?.at(-1) || "").toContain("datePreset=7d");
  const finalRequest = state.ledgerRequests?.at(-1) || "";
  expect(finalRequest).toContain("sort=amount_desc");
  expect(finalRequest).toContain("page=1");
});

test("wallet Your Impact dashboard renders summary, top recommendations, trend, mobile, dark, and empty CTA", async ({ page }, testInfo) => {
  const state: CoinState = {
    balanceMillis: 497_000,
    transactions: [
      coinTransaction({
        id: "impact-ledger-reward",
        type: "recommender_reward",
        direction: "credit",
        amountMillis: 6_700,
        balanceAfterMillis: 497_000,
        metadata: { title: "Blue Tokai Coffee" },
      }),
    ],
    savedPlaces: [],
    analyticsEvents: [],
  };
  await seedAuthenticatedSnapshot(page);
  await installCoinApi(page, state);

  await page.goto("/wallet");
  await expect(page.getByRole("heading", { name: "Your Impact" })).toBeVisible();
  await expect(page.locator(".wr-impact-hero strong")).toHaveText("482");
  await expect(page.getByText("travelers discover amazing places.")).toBeVisible();
  await expect(page.getByText("City Curator · Contribution Score 84/100")).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Places Added" }).getByText("127")).toBeVisible();
  await expect(page.getByText("Places Added")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Top Recommendations" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Blue Tokai Coffee/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monthly Trend" })).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/coin-impact-dashboard-${testInfo.project.name}.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 760 });
  await page.screenshot({ path: `artifacts/screenshots/coin-impact-dashboard-mobile-${testInfo.project.name}.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.screenshot({ path: `artifacts/screenshots/coin-impact-dashboard-dark-${testInfo.project.name}.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });

  state.impact = createImpactPayload({
    balanceMillis: 999_999_000,
    travelersHelped: 1_250_000,
    placesAdded: 100_000,
    communitySaves: 1_250_000,
    placesRecommended: 100_000,
    coinsEarnedMillis: 8_888_888,
    coinsSavedMillis: 321_000,
    topRecommendations: [
      {
        placeId: "large-top-place",
        title: "A Very Popular Community Coffee House",
        communitySaves: 987_654,
        coinsEarnedMillis: 123_456,
        coinsEarnedCoins: 123.456,
        addedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
  });
  await page.reload();
  await expect(page.locator(".wr-impact-hero strong")).toHaveText("1,250,000");
  await expect(page.getByRole("article").filter({ hasText: "Places Recommended" }).getByText("100,000")).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/coin-impact-large-account-${testInfo.project.name}.png`, fullPage: true });

  state.impact = createImpactPayload({
    balanceMillis: 500_000,
    travelersHelped: 0,
    placesAdded: 0,
    communitySaves: 0,
    placesRecommended: 0,
    coinsEarnedMillis: 0,
    coinsSavedMillis: 0,
    topRecommendations: [],
    monthlyTrend: [],
  });
  await page.reload();
  await expect(page.getByText("Start recommending amazing places.")).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/coin-impact-empty-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Recommend a Place" }).click();
  await expect(page.getByRole("heading", { name: "Add a Wandreel" })).toBeVisible();
  expect(state.analyticsEvents).toContain("impact_empty_cta_clicked");
});

test("wallet shows skeleton loading and empty states", async ({ page }) => {
  let releaseLedger: () => void = () => undefined;
  const ledgerGate = new Promise<void>((resolve) => {
    releaseLedger = resolve;
  });
  await seedAuthenticatedSnapshot(page);
  await page.route("**/api/auth/session/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, user: { ...user, coinBalance: 500 } }),
    });
  });
  await page.route("**/api/economy/impact", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(createImpactPayload({ balanceMillis: 500_000, travelersHelped: 0, placesAdded: 0, communitySaves: 0, placesRecommended: 0, coinsEarnedMillis: 0, coinsSavedMillis: 0, topRecommendations: [] })),
    });
  });
  await page.route("**/api/economy/ledger**", async (route) => {
    await ledgerGate;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        wallet: {
          userId: user.userId,
          balanceCoins: 500,
          balanceMillis: 500_000,
          createdAt: "2026-07-14T00:00:00.000Z",
          updatedAt: new Date().toISOString(),
        },
        transactions: [],
        pagination: {
          page: 1,
          pageSize: 25,
          totalCount: 0,
          totalItems: 0,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false,
        },
        filters: { type: "all", datePreset: "6m", from: null, to: null, sort: "newest" },
      }),
    });
  });

  await page.goto("/wallet");
  await expect(page.locator(".wr-wallet-skeleton-list")).toBeVisible();
  releaseLedger();
  await expect(page.getByText("No wallet activity for these filters.")).toBeVisible();
});

test("wallet shows error and retry states", async ({ page }) => {
  const state: CoinState = {
    balanceMillis: 500_000,
    transactions: [],
    savedPlaces: [],
    ledgerFailuresRemaining: 1,
  };
  await seedAuthenticatedSnapshot(page);
  await installCoinApi(page, state);

  await page.goto("/wallet");
  await expect(page.getByText("Ledger unavailable.")).toBeVisible();
  state.transactions.push(coinTransaction({
    id: "retry-reward",
    type: "recommender_reward",
    direction: "credit",
    amountMillis: 500,
    balanceAfterMillis: 500_500,
    metadata: { title: "Fractional reward" },
  }));
  await page.getByRole("button", { name: /retry/i }).click();
  await expect(page.getByText("Community reward")).toBeVisible();
  await expect(page.getByText("+0.5")).toBeVisible();

  state.transactions = [];
  await page.getByRole("tab", { name: "Debits" }).click();
  await expect(page.getByText("No wallet activity for these filters.")).toBeVisible();
});

test("external Add shows the 2-coin cost hint", async ({ page }, testInfo) => {
  const state: CoinState = {
    balanceMillis: 500_000,
    transactions: [],
    savedPlaces: [],
  };
  await seedAuthenticatedSnapshot(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("wr_add_detected_draft_v2", JSON.stringify({
      detectedPlaces: [{
        id: "draft-place-1",
        runId: 1,
        sourceUrl: "https://instagram.com/p/test",
        retryCount: 0,
        name: "Seeded Cafe",
        category: "Taste",
        locality: "Patna",
        source: "Instagram",
        imageUrl: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=1200",
        fullAddress: "Patna",
        videoUrl: "https://instagram.com/p/test",
        confidence: "high",
        evidenceText: null,
        intent: null,
        placeId: "seeded-cafe",
        lat: null,
        lng: null,
        city: "Patna",
        state: null,
        country: null,
      }],
      selectedDetectedCategory: "Auto-detect",
      selectedPreviewIndex: 0,
      isPreviewVisible: true,
      linkInput: "https://instagram.com/p/test",
      pendingJobs: [],
    }));
  });
  await installCoinApi(page, state);

  await page.goto("/");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Seeded Cafe")).toBeVisible();
  await expect(page.getByText("Costs 2 coins")).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/coin-add-cost-hint-${testInfo.project.name}.png`, fullPage: true });
});

test("direct wallet navigation while unauthenticated follows login behaviour", async ({ page }) => {
  await page.route("**/api/auth/session/me", async (route) => {
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false }) });
  });

  await page.goto("/wallet");
  await expect(page.getByRole("heading", { name: "Wallet" })).toBeVisible();
  await expect(page.getByText("Log in to view wallet activity.")).toBeVisible();
  await expect(page.locator(".wr-wallet-transaction-row")).toHaveCount(0);
});
