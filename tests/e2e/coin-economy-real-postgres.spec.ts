import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import path from "node:path";
import { Pool } from "pg";
import { expect, test } from "playwright/test";
import { runDatabaseMigrations } from "../../server/db/migrations";

type Queryable = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>;
  connect: () => Promise<{ query: Queryable["query"]; release: () => void }>;
};

const baseDatabaseUrl = process.env.COIN_ECONOMY_TEST_DATABASE_URL || process.env.DATABASE_URL || "";
const shouldRun = Boolean(baseDatabaseUrl && process.env.COIN_ECONOMY_REAL_PG_BROWSER === "1");
const schemaName = `coin_economy_browser_${process.pid}_${Date.now()}`.toLowerCase();
const apiPort = 8791;
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

let adminPool: Pool | null = null;
let rawPool: Pool | null = null;
let db: Queryable | null = null;
let apiProcess: ChildProcess | null = null;

function cleanProcessEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => value !== undefined && !key.startsWith("=")),
  ) as NodeJS.ProcessEnv;
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function withSearchPath(pool: Pool, schema: string): Queryable {
  const searchPathSql = `set search_path to ${quoteIdentifier(schema)}, public`;
  return {
    query: async (sql, params) => {
      const client = await pool.connect();
      try {
        await client.query(searchPathSql);
        const result = await client.query(sql, params);
        return { rows: result.rows as any[], rowCount: result.rowCount };
      } finally {
        client.release();
      }
    },
    connect: async () => {
      const client = await pool.connect();
      await client.query(searchPathSql);
      return {
        query: async (sql, params) => {
          await client.query(searchPathSql);
          const result = await client.query(sql, params);
          return { rows: result.rows as any[], rowCount: result.rowCount };
        },
        release: () => client.release(),
      };
    },
  };
}

async function waitForApi() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/session/me`, { credentials: "include" });
      if (response.status === 401) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("API server did not become ready");
}

async function createUser(id: string, email = `${id}@example.test`) {
  if (!db) throw new Error("db not ready");
  await db.query(
    `
      insert into users (id, email, email_verified, display_name, auth_provider, created_at, updated_at)
      values ($1, $2, true, $3, 'EMAIL', now(), now())
    `,
    [id, email, id],
  );
}

async function saveGlobalRecommendation(userId: string, placeId: string) {
  if (!db) throw new Error("db not ready");
  await db.query(
    `
      insert into user_saved_places (id, user_id, place_id, title, category, metadata_json, created_at, updated_at)
      values (gen_random_uuid(), $1, $2, 'Recommended Place', 'Taste', $3::jsonb, now(), now())
    `,
    [userId, placeId, JSON.stringify({ locality: "Patna", fullAddress: "Patna", sharedVisibility: "global", isGlobal: true })],
  );
}

async function setWallet(userId: string, balanceMillis: number) {
  if (!db) throw new Error("db not ready");
  await db.query(
    `
      insert into coin_wallets (user_id, balance_millis, created_at, updated_at)
      values ($1, $2, now(), now())
      on conflict (user_id) do update set balance_millis = excluded.balance_millis, updated_at = now()
    `,
    [userId, balanceMillis],
  );
}

test.beforeAll(async () => {
  test.skip(!shouldRun, "Set COIN_ECONOMY_REAL_PG_BROWSER=1 and DATABASE_URL/COIN_ECONOMY_TEST_DATABASE_URL to run real browser DB tests.");

  adminPool = new Pool({
    connectionString: baseDatabaseUrl,
    ssl: baseDatabaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
  });
  await adminPool.query(`create schema ${schemaName}`);

  rawPool = new Pool({
    connectionString: baseDatabaseUrl,
    ssl: baseDatabaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
  db = withSearchPath(rawPool, schemaName);
  await runDatabaseMigrations({ database: db as any });

  apiProcess = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...cleanProcessEnv(),
      PORT: String(apiPort),
      DATABASE_URL: baseDatabaseUrl,
      DATABASE_SEARCH_PATH: schemaName,
      EMAIL_OTP_DEV_MODE: "true",
      CLIENT_ORIGIN: "http://127.0.0.1:5173",
      CORS_ALLOWED_ORIGINS: "http://127.0.0.1:5173",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProcess.once("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`coin economy API exited with ${code}`);
    }
  });
  await waitForApi();
});

test.afterAll(async () => {
  if (apiProcess && !apiProcess.killed) {
    apiProcess.kill();
    await Promise.race([once(apiProcess, "exit"), new Promise((resolve) => setTimeout(resolve, 2000))]).catch(() => undefined);
  }
  await rawPool?.end();
  if (adminPool) {
    await adminPool.query(`drop schema if exists ${schemaName} cascade`).catch(() => undefined);
    await adminPool.end();
  }
});

test("real API profile wallet, saves, recommender reward, and insufficient balance", async ({ page }, testInfo) => {
  test.skip(!shouldRun, "real Postgres browser test disabled");
  const email = `browser-${Date.now()}@example.test`;

  await page.goto("/");
  const loginPayload = await page.evaluate(async ({ apiBaseUrl: baseUrl, emailAddress }) => {
    const request = await fetch(`${baseUrl}/api/auth/email/request-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: emailAddress }),
    });
    const requestPayload = await request.json();
    const verify = await fetch(`${baseUrl}/api/auth/email/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: emailAddress, otp: requestPayload.otpPreview, displayName: "Real Browser" }),
    });
    return await verify.json();
  }, { apiBaseUrl, emailAddress: email });
  expect(loginPayload.ok).toBe(true);
  const userId = loginPayload.user.userId as string;

  await page.reload();
  await expect(page.getByRole("dialog", { name: /you received 500 coins/i })).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/coin-real-onboarding-welcome-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByRole("dialog", { name: /you received 500 coins/i })).toBeHidden();
  await page.reload();
  await expect(page.getByRole("dialog", { name: /you received 500 coins/i })).toHaveCount(0);
  await page.getByRole("button", { name: /login/i }).click();
  await expect(page.locator(".wr-profile-coin-balance strong")).toHaveText("500");
  await page.screenshot({ path: `artifacts/screenshots/coin-real-profile-signup-${testInfo.project.name}.png`, fullPage: true });

  const externalSave = await page.evaluate(async ({ apiBaseUrl: baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/saved-places`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        placeId: "real-external-place",
        title: "Real External Place",
        category: "Taste",
        coinSource: "external_import",
        idempotencyKey: "real-browser-external",
        metadata: { locality: "Patna", fullAddress: "Patna" },
      }),
    });
    const payload = await response.json();
    window.dispatchEvent(new CustomEvent("wr:coin-wallet-updated", { detail: { wallet: payload.coin.wallet } }));
    return payload;
  }, { apiBaseUrl });
  expect(externalSave.coin.wallet.balanceMillis).toBe(498_000);
  await expect(page.locator(".wr-profile-coin-balance strong")).toHaveText("498");

  const recommenderId = randomUUID();
  const discoverPlaceId = "real-discover-place";
  await createUser(recommenderId);
  await saveGlobalRecommendation(recommenderId, discoverPlaceId);

  const discoverSave = await page.evaluate(async ({ apiBaseUrl: baseUrl, placeId }) => {
    const response = await fetch(`${baseUrl}/api/saved-places`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        placeId,
        title: "Real Discover Place",
        category: "Taste",
        coinSource: "discover",
        idempotencyKey: "real-browser-discover",
        metadata: { locality: "Patna", fullAddress: "Patna" },
      }),
    });
    const payload = await response.json();
    window.dispatchEvent(new CustomEvent("wr:coin-wallet-updated", { detail: { wallet: payload.coin.wallet } }));
    return payload;
  }, { apiBaseUrl, placeId: discoverPlaceId });
  expect(discoverSave.coin.wallet.balanceMillis).toBe(497_000);
  await expect(page.locator(".wr-profile-coin-balance strong")).toHaveText("497");
  await expect(page.getByText("Discover save")).toHaveCount(0);
  await page.getByRole("button", { name: /open wallet activity/i }).click();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(page.getByRole("heading", { name: "Your Impact" })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Coins Saved" }).getByText("1")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monthly Trend" })).toBeVisible();
  await expect(page.getByText("Discover save")).toBeVisible();
  await expect(page.getByText("External link import")).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/coin-real-impact-dashboard-${testInfo.project.name}.png`, fullPage: true });
  await page.screenshot({ path: `artifacts/screenshots/coin-real-after-discover-${testInfo.project.name}.png`, fullPage: true });

  const ledgerContract = await page.evaluate(async ({ apiBaseUrl: baseUrl }) => {
    const invalid = await fetch(`${baseUrl}/api/economy/ledger?type=sideways`, { credentials: "include" });
    const largePage = await fetch(`${baseUrl}/api/economy/ledger?pageSize=999`, { credentials: "include" });
    return {
      invalidStatus: invalid.status,
      invalidPayload: await invalid.json(),
      largePagePayload: await largePage.json(),
    };
  }, { apiBaseUrl });
  expect(ledgerContract.invalidStatus).toBe(400);
  expect(ledgerContract.invalidPayload.error).toMatch(/Invalid type/);
  expect(ledgerContract.largePagePayload.balanceMillis).toBe(497_000);
  expect(ledgerContract.largePagePayload.pagination.pageSize).toBe(25);
  expect(ledgerContract.largePagePayload.pagination.totalItems).toBe(3);

  if (!db) throw new Error("db not ready");
  const recommenderWallet = await db.query<{ balance_millis: string }>(
    "select balance_millis::text from coin_wallets where user_id = $1",
    [recommenderId],
  );
  expect(Number(recommenderWallet.rows[0]?.balance_millis)).toBe(500);

  await setWallet(userId, 999);
  const beforeFailedSaveEvents = await db.query<{ count: string }>("select count(*)::text as count from coin_save_events where place_id = 'real-too-expensive'");
  const insufficient = await page.evaluate(async ({ apiBaseUrl: baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/saved-places`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        placeId: "real-too-expensive",
        title: "Too Expensive",
        category: "Taste",
        coinSource: "discover",
        idempotencyKey: "real-browser-insufficient",
        metadata: { locality: "Patna", fullAddress: "Patna" },
      }),
    });
    return { status: response.status, payload: await response.json() };
  }, { apiBaseUrl });
  expect(insufficient.status).toBe(402);
  const afterFailedSaveEvents = await db.query<{ count: string }>("select count(*)::text as count from coin_save_events where place_id = 'real-too-expensive'");
  expect(afterFailedSaveEvents.rows[0]?.count).toBe(beforeFailedSaveEvents.rows[0]?.count);
  await expect(page.getByText("Too Expensive")).toHaveCount(0);
  await page.screenshot({ path: `artifacts/screenshots/coin-real-insufficient-${testInfo.project.name}.png`, fullPage: true });
});
