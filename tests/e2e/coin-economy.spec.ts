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

async function installCoinApi(page: Page, state: CoinState) {
  await page.route("**/api/auth/session/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        user: {
          ...user,
          coinBalance: state.balanceMillis / 1000,
        },
      }),
    });
  });

  await page.route("**/api/economy/ledger**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        wallet: {
          userId: user.userId,
          balanceCoins: state.balanceMillis / 1000,
          balanceMillis: state.balanceMillis,
          createdAt: "2026-07-14T00:00:00.000Z",
          updatedAt: new Date().toISOString(),
        },
        transactions: state.transactions,
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
            userId: user.userId,
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

async function seedAuthenticatedSnapshot(page: Page) {
  await page.addInitScript((sessionUser) => {
    window.localStorage.setItem("wr_auth_session_snapshot_v1", JSON.stringify({
      user: sessionUser,
      savedAtMs: Date.now(),
    }));
  }, { ...user, coinBalance: 500 });
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
  await page.getByRole("button", { name: /refresh/i }).click();
  await expect(page.getByText("External link import")).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/coin-profile-after-external-save-${testInfo.project.name}.png`, fullPage: true });

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
  await page.getByRole("button", { name: /refresh/i }).click();
  await expect(page.getByText("Discover save")).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/coin-profile-after-discover-save-${testInfo.project.name}.png`, fullPage: true });
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
  await page.getByRole("button", { name: /refresh/i }).click();
  await expect(page.getByText("No coin activity yet.")).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/coin-insufficient-balance-${testInfo.project.name}.png`, fullPage: true });
});
