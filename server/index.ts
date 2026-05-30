import "dotenv/config";
import express from "express";
import { extractionJobStore, runExtractionPipeline, type ExtractionMode } from "./extraction";
import { intelligenceJobStore, runIntelligencePipeline, type IntelligenceMode } from "./intelligence";
import { buildDraftIntelligenceOutput } from "./intelligence/draft";
import { phoneOtpStore } from "./auth/phoneOtpStore";
import {
  buildClearSessionCookie,
  buildSessionCookie,
  createOrReuseEmailVerifiedUser,
  createSession,
  ensureAuthSchema,
  findSessionUser,
  getSessionCookieName,
  isPostgresConfigured,
  issueEmailOtp,
  listSavedPlaces,
  revokeSession,
  upsertGoogleVerifiedUser,
  upsertSavedPlace,
  updateDisplayName,
  verifyEmailOtp,
  deleteSavedPlace,
} from "./auth/postgresAuth";
import { featureFlags } from "./featureFlags";

const app = express();
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", clientOrigin);
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,OPTIONS");
  res.header("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});
app.use(express.json({ limit: "1mb" }));

function parseCookies(headerValue: string | undefined) {
  const out: Record<string, string> = {};
  for (const piece of String(headerValue || "").split(";")) {
    const [rawKey, ...rawValueParts] = piece.split("=");
    const key = rawKey?.trim();
    if (!key) continue;
    out[key] = decodeURIComponent(rawValueParts.join("=").trim());
  }
  return out;
}

async function resolveSessionUser(req: express.Request) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[getSessionCookieName()];
  if (!token) return null;
  return findSessionUser(token);
}

async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const user = await resolveSessionUser(req);
    if (!user) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    (req as express.Request & { authUser?: NonNullable<typeof user> }).authUser = user;
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return res.status(401).json({ ok: false, error: message });
  }
}

if (isPostgresConfigured()) {
  ensureAuthSchema().catch((error) => {
    console.error("auth schema bootstrap failed", error);
  });
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "wandreel-api" });
});

app.get("/api/location/reverse-geocode", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ ok: false, error: "valid lat/lng required" });
    }
    const apiKey = String(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || "").trim();
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: "Google Maps key missing" });
    }
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${lat},${lng}`);
    url.searchParams.set("key", apiKey);
    const response = await fetch(url.toString());
    if (!response.ok) {
      return res.status(502).json({ ok: false, error: "reverse geocode failed" });
    }
    const data = (await response.json()) as {
      status?: string;
      results?: Array<{ address_components?: Array<{ long_name?: string; types?: string[] }> }>;
    };
    const components = data.results?.[0]?.address_components || [];
    const pick = (type: string) => components.find((c) => c.types?.includes(type))?.long_name || null;
    const locality =
      pick("sublocality_level_1") ||
      pick("locality") ||
      pick("administrative_area_level_2");
    const state = pick("administrative_area_level_1");
    const label = [locality, state].filter(Boolean).join(", ") || "Current location";
    return res.json({ ok: true, label });
  } catch (error) {
    const message = error instanceof Error ? error.message : "reverse geocode failed";
    return res.status(500).json({ ok: false, error: message });
  }
});

app.post("/api/metadata/extract", async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    const modeRaw = String(req.body?.mode || "quick").trim().toLowerCase();
    const mode: ExtractionMode = modeRaw === "deep" ? "deep" : "quick";

    if (!url) {
      return res.status(400).json({ ok: false, error: "url is required" });
    }

    const result = await runExtractionPipeline({ url, mode });
    if (featureFlags.extractionV2) {
      return res.json({ ok: true, ...result });
    }
    const { source, platform, canonicalUrl, stageStatus, stages, stageTimingsMs, stageFailures, sla, ...legacy } = result;
    return res.json({ ok: true, ...legacy });
  } catch (error) {
    const message = error instanceof Error ? error.message : "extraction failed";
    return res.status(500).json({ ok: false, error: message });
  }
});

app.post("/api/metadata/extract/deep-async", async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    if (!url) {
      return res.status(400).json({ ok: false, error: "url is required" });
    }

    const quick = await runExtractionPipeline({ url, mode: "quick" });
    const job = await extractionJobStore.createDeep(url);

    return res.status(202).json({
      ok: true,
      mode: "deep_async",
      quick,
      jobId: job.id,
      status: job.status,
      createdAtIso: job.createdAtIso,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "deep async extraction failed";
    return res.status(500).json({ ok: false, error: message });
  }
});

app.get("/api/metadata/jobs/:jobId", async (req, res) => {
  const jobId = String(req.params.jobId || "").trim();
  if (!jobId) {
    return res.status(400).json({ ok: false, error: "jobId is required" });
  }
  const job = await extractionJobStore.get(jobId);
  if (!job) {
    return res.status(404).json({ ok: false, error: "job not found" });
  }
  return res.json({ ok: true, job });
});

app.post("/api/intelligence/extract", async (req, res) => {
  try {
    const modeRaw = String(req.body?.mode || "sync").trim().toLowerCase();
    const mode: IntelligenceMode =
      modeRaw === "async"
        ? "async"
        : modeRaw === "draft_async"
          ? "draft_async"
          : "sync";
    const source = req.body?.source;

    if (!source || typeof source !== "object") {
      return res.status(400).json({ ok: false, error: "source extraction payload is required" });
    }

    if (mode === "async") {
      const job = await intelligenceJobStore.create({ source });
      return res.status(202).json({
        ok: true,
        mode,
        jobId: job.id,
        status: job.status,
        createdAtIso: job.createdAtIso,
      });
    }

    if (mode === "draft_async") {
      const job = await intelligenceJobStore.create({ source });
      const draftOutput = buildDraftIntelligenceOutput(source);
      return res.status(202).json({
        ok: true,
        mode,
        draft: true,
        output: draftOutput,
        validationErrors: [],
        fixed: false,
        timingsMs: {
          total: 0,
          provider: 0,
          schemaFirstPass: 0,
          normalize: 0,
          schemaSecondPass: 0,
        },
        providerMeta: {
          model: "heuristic-draft",
        },
        jobId: job.id,
        status: job.status,
        createdAtIso: job.createdAtIso,
      });
    }

    if (!featureFlags.intelligenceStructured) {
      const draftOutput = buildDraftIntelligenceOutput(source);
      return res.json({
        ok: true,
        mode,
        output: draftOutput,
        validationErrors: [],
        fixed: false,
        timingsMs: {
          total: 0,
          provider: 0,
          schemaFirstPass: 0,
          normalize: 0,
          schemaSecondPass: 0,
        },
        providerMeta: {
          model: "heuristic-fallback",
        },
      });
    }

    const result = await runIntelligencePipeline({ source });
    return res.json({ ok: true, mode, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "intelligence extraction failed";
    return res.status(500).json({ ok: false, error: message });
  }
});

app.get("/api/intelligence/jobs/:jobId", async (req, res) => {
  const jobId = String(req.params.jobId || "").trim();
  if (!jobId) {
    return res.status(400).json({ ok: false, error: "jobId is required" });
  }

  const job = await intelligenceJobStore.get(jobId);
  if (!job) {
    return res.status(404).json({ ok: false, error: "job not found" });
  }

  return res.json({ ok: true, job });
});

app.post("/api/auth/phone/request-otp", (req, res) => {
  try {
    const phone = String(req.body?.phone || "").trim();
    if (!phone) {
      return res.status(400).json({ ok: false, error: "phone is required" });
    }

    const result = phoneOtpStore.requestOtp(phone);
    return res.status(201).json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "otp request failed";
    return res.status(400).json({ ok: false, error: message });
  }
});

app.post("/api/auth/phone/verify-otp", (req, res) => {
  try {
    const phone = String(req.body?.phone || "").trim();
    const otp = String(req.body?.otp || "").trim();
    if (!phone || !otp) {
      return res.status(400).json({ ok: false, error: "phone and otp are required" });
    }

    const result = phoneOtpStore.verifyOtp(phone, otp);
    return res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "otp verify failed";
    return res.status(400).json({ ok: false, error: message });
  }
});

app.post("/api/auth/profile/upsert", (_req, res) => {
  return res.status(410).json({ ok: false, error: "Deprecated endpoint. Use authenticated profile update flow." });
});

app.post("/api/auth/google/verify", async (req, res) => {
  try {
    if (!isPostgresConfigured()) {
      return res.status(503).json({ ok: false, error: "Auth database is not configured." });
    }

    const accessToken = String(req.body?.accessToken || "").trim();
    const expectedClientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();

    if (!expectedClientId) {
      return res.status(503).json({ ok: false, error: "Google login is not configured yet." });
    }
    if (!accessToken) {
      return res.status(400).json({ ok: false, error: "accessToken is required" });
    }

    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!userInfoResponse.ok) {
      return res.status(401).json({ ok: false, error: "Google authentication failed." });
    }

    const userInfo = (await userInfoResponse.json()) as {
      sub?: string;
      name?: string;
      email?: string;
      picture?: string;
      email_verified?: boolean;
      aud?: string;
    };

    if (!userInfo?.sub || !userInfo?.email) {
      return res.status(400).json({ ok: false, error: "Google account did not return required profile fields." });
    }
    if (!userInfo.email_verified) {
      return res.status(400).json({ ok: false, error: "Google email is not verified." });
    }
    if (userInfo.aud && userInfo.aud !== expectedClientId) {
      return res.status(401).json({ ok: false, error: "Google token audience mismatch." });
    }

    const user = await upsertGoogleVerifiedUser({
      email: userInfo.email,
      emailVerified: Boolean(userInfo.email_verified),
      displayName: userInfo.name || null,
      avatarUrl: userInfo.picture || null,
      providerId: userInfo.sub,
    });
    const session = await createSession(user.userId);
    res.setHeader("Set-Cookie", buildSessionCookie(session.rawToken));

    return res.json({
      ok: true,
      user,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google authentication failed.";
    return res.status(500).json({ ok: false, error: message });
  }
});

app.post("/api/auth/email/request-otp", async (req, res) => {
  try {
    if (!isPostgresConfigured()) {
      return res.status(503).json({ ok: false, error: "Auth database is not configured." });
    }
    const email = String(req.body?.email || "").trim();
    const result = await issueEmailOtp(email);
    // TODO(email-sender): Integrate SMTP/provider sender and remove otpPreview from response in production.
    return res.status(201).json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send email OTP";
    return res.status(400).json({ ok: false, error: message });
  }
});

app.post("/api/auth/email/verify-otp", async (req, res) => {
  try {
    if (!isPostgresConfigured()) {
      return res.status(503).json({ ok: false, error: "Auth database is not configured." });
    }
    const email = String(req.body?.email || "").trim();
    const otp = String(req.body?.otp || "").trim();
    const displayName = req.body?.displayName ? String(req.body.displayName).trim() : null;
    await verifyEmailOtp(email, otp);
    const user = await createOrReuseEmailVerifiedUser({ email, displayName });
    const session = await createSession(user.userId);
    res.setHeader("Set-Cookie", buildSessionCookie(session.rawToken));
    return res.json({ ok: true, user, requiresDisplayName: !user.displayName });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not verify email OTP";
    return res.status(400).json({ ok: false, error: message });
  }
});

app.get("/api/auth/session/me", requireAuth, async (_req, res) => {
  const user = (_req as express.Request & { authUser?: { userId: string } }).authUser;
  return res.json({ ok: true, user });
});

app.post("/api/auth/profile/display-name", requireAuth, async (req, res) => {
  try {
    const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
    const displayName = String(req.body?.displayName || "").trim();
    const user = await updateDisplayName(authUser!.userId, displayName);
    return res.status(200).json({ ok: true, user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update profile";
    return res.status(400).json({ ok: false, error: message });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[getSessionCookieName()];
    if (token) {
      await revokeSession(token);
    }
    res.setHeader("Set-Cookie", buildClearSessionCookie());
    return res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not logout";
    return res.status(400).json({ ok: false, error: message });
  }
});

app.get("/api/saved-places", requireAuth, async (req, res) => {
  try {
    const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
    const items = await listSavedPlaces(authUser!.userId);
    return res.json({ ok: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fetch saved places";
    return res.status(400).json({ ok: false, error: message });
  }
});

app.post("/api/saved-places", requireAuth, async (req, res) => {
  try {
    const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
    const placeId = String(req.body?.placeId || "").trim();
    const title = String(req.body?.title || "").trim();
    const category = req.body?.category ? String(req.body.category).trim() : null;
    const metadata = req.body?.metadata ?? {};

    const item = await upsertSavedPlace(authUser!.userId, {
      placeId,
      title,
      category,
      metadata,
    });
    return res.status(201).json({ ok: true, item });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save place";
    return res.status(400).json({ ok: false, error: message });
  }
});

app.delete("/api/saved-places/:placeId", requireAuth, async (req, res) => {
  try {
    const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
    const result = await deleteSavedPlace(authUser!.userId, String(req.params.placeId || ""));
    return res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete saved place";
    return res.status(400).json({ ok: false, error: message });
  }
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`wandreel api running on http://localhost:${port}`);
});
