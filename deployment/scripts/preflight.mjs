#!/usr/bin/env node
import { promises as dns } from "node:dns";

const requiredEnv = [
  "APP_URL",
  "API_BASE_URL",
  "CORS_ALLOWED_ORIGINS",
  "COOKIE_DOMAIN",
  "CLIENT_ORIGIN",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "DATABASE_URL",
  "VITE_GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_ID",
];

const results = [];

function addResult(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  const line = `[${mark}] ${name}${detail ? ` - ${detail}` : ""}`;
  if (ok) {
    console.log(line);
  } else {
    console.error(line);
  }
}

function parseCsv(input) {
  return String(input || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

async function checkDns(hostname, label) {
  try {
    const records = await dns.lookup(hostname, { all: true });
    addResult(`${label} DNS`, records.length > 0, `${hostname} resolved`);
  } catch (error) {
    addResult(`${label} DNS`, false, `${hostname} unresolved (${error.message})`);
  }
}

async function checkHttp(url, label) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "user-agent": "wandreel-preflight/1.0" },
    });
    addResult(
      `${label} HTTP`,
      response.status < 500,
      `status ${response.status}`,
    );
  } catch (error) {
    addResult(`${label} HTTP`, false, error.message);
  }
}

async function checkCors(apiBaseUrl, origin) {
  const endpoint = new URL("/api/intelligence/extract", apiBaseUrl).toString();
  try {
    const response = await fetch(endpoint, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });

    const allowedOrigin = response.headers.get("access-control-allow-origin");
    const wildcardAllowed = allowedOrigin === "*";
    const exactAllowed = allowedOrigin === origin;
    const ok = response.status < 500 && (wildcardAllowed || exactAllowed);

    addResult(
      "CORS intelligence endpoint",
      ok,
      `status ${response.status}, allow-origin=${allowedOrigin ?? "missing"}`,
    );
  } catch (error) {
    addResult("CORS intelligence endpoint", false, error.message);
  }
}

async function main() {
  console.log("Wandreel deployment preflight starting...\n");

  for (const key of requiredEnv) {
    const value = process.env[key];
    addResult(`Env ${key}`, Boolean(value && String(value).trim()), value ? "set" : "missing");
  }

  const appUrl = process.env.APP_URL || "";
  const apiBaseUrl = process.env.API_BASE_URL || "";

  addResult("APP_URL format", isHttpsUrl(appUrl), appUrl || "missing");
  addResult("API_BASE_URL format", isHttpsUrl(apiBaseUrl), apiBaseUrl || "missing");

  const allowedOrigins = parseCsv(process.env.CORS_ALLOWED_ORIGINS);
  addResult(
    "CORS_ALLOWED_ORIGINS contains APP_URL",
    allowedOrigins.includes(appUrl),
    allowedOrigins.length ? allowedOrigins.join(", ") : "empty",
  );

  const clientOrigin = process.env.CLIENT_ORIGIN || "";
  addResult("CLIENT_ORIGIN format", isHttpsUrl(clientOrigin), clientOrigin || "missing");
  addResult(
    "CLIENT_ORIGIN matches APP_URL",
    Boolean(clientOrigin) && clientOrigin === appUrl,
    clientOrigin || "missing",
  );

  const googleClientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  const viteGoogleClientId = String(process.env.VITE_GOOGLE_CLIENT_ID || "").trim();
  addResult(
    "Google client ids match",
    Boolean(googleClientId) && googleClientId === viteGoogleClientId,
    googleClientId && viteGoogleClientId ? "matched check" : "missing",
  );

  if (isHttpsUrl(appUrl)) {
    await checkDns(new URL(appUrl).hostname, "App domain");
    await checkHttp(appUrl, "App domain");
  }

  if (isHttpsUrl(apiBaseUrl)) {
    await checkDns(new URL(apiBaseUrl).hostname, "API domain");
    await checkHttp(apiBaseUrl, "API base");
  }

  if (isHttpsUrl(apiBaseUrl) && isHttpsUrl(appUrl)) {
    await checkCors(apiBaseUrl, appUrl);
  }

  const failures = results.filter((entry) => !entry.ok);

  console.log("\nPreflight summary:");
  console.log(`- Total checks: ${results.length}`);
  console.log(`- Passed: ${results.length - failures.length}`);
  console.log(`- Failed: ${failures.length}`);

  if (failures.length > 0) {
    process.exitCode = 1;
    console.error("\nDeployment preflight failed. Fix failing checks before cutover.");
    return;
  }

  console.log("\nDeployment preflight passed.");
}

main().catch((error) => {
  console.error("Unhandled preflight error:", error);
  process.exit(1);
});
