import "dotenv/config";
import { createHash } from "node:crypto";
import express from "express";
import { extractionJobStore, runExtractionPipeline, type ExtractionMode } from "./extraction";
import { intelligenceJobStore, runIntelligencePipeline, type IntelligenceMode } from "./intelligence";
import { buildDraftIntelligenceOutput } from "./intelligence/draft";
import { phoneOtpStore } from "./auth/phoneOtpStore";
import {
  buildClearSessionCookie,
  buildSessionCookie,
  createReelAnalyticsAttempt,
  createReelJob,
  createOrReuseEmailVerifiedUser,
  createSession,
  deleteSavedPlace,
  ensureAuthSchema,
  finalizeReelAnalyticsAttempt,
  findSessionUser,
  getReelAnalyticsRunIdByClientRunId,
  getReelJob,
  getSessionCookieName,
  isPostgresConfigured,
  issueEmailOtp,
  listSavedPlaces,
  markReelAnalyticsEntityOutcome,
  recordReelAnalyticsEvent,
  persistReelAnalyticsAttemptArtifacts,
  revokeSession,
  upsertReelAnalyticsEntities,
  upsertGoogleVerifiedUser,
  upsertSavedPlace,
  updateDisplayName,
  verifyEmailOtp,
} from "./auth/postgresAuth";
import { featureFlags } from "./featureFlags";
import { saveAttemptHypothesisSummary } from "./attemptHypothesisStore";
import { buildAttemptHypothesisSummary } from "./intelligence/hypothesisSummary";
import type { IntelligencePipelineResult } from "./intelligence/types";
import { canonicalizeUrl } from "./extraction/url";

const app = express();
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const allowedOrigins = Array.from(
  new Set(
    [
      ...String(process.env.CORS_ALLOWED_ORIGINS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      clientOrigin,
    ].filter(Boolean),
  ),
);
app.use((req, res, next) => {
  const requestOrigin = String(req.headers.origin || "").trim();
  const resolvedOrigin =
    requestOrigin && allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : allowedOrigins[0] || clientOrigin;
  res.header("Access-Control-Allow-Origin", resolvedOrigin);
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Vary", "Origin");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});
app.use(express.json({ limit: "1mb" }));

type MetadataExtractionRouteName = "stream" | "non_stream" | "stream_test";

type MetadataExtractionRequestContext = {
  key: string;
  requestId: string;
  clientRunId: string | null;
  urlHash: string;
  attemptNumber: number;
  triggerType: "initial" | "retry";
  routeName: MetadataExtractionRouteName;
  mode: ExtractionMode;
};

type MetadataExtractionInFlightEntry = {
  context: MetadataExtractionRequestContext;
  startedAt: number;
  promise: Promise<Awaited<ReturnType<typeof runExtractionPipeline>>>;
};

const metadataExtractionInFlight = new Map<string, MetadataExtractionInFlightEntry>();

function parseExtractionRequest(req: express.Request) {
  const url = String(req.body?.url || "").trim();
  const modeRaw = String(req.body?.mode || "quick").trim().toLowerCase();
  const mode: ExtractionMode = modeRaw === "deep" ? "deep" : "quick";
  const analyticsPayload = req.body?.analytics && typeof req.body.analytics === "object" ? req.body.analytics : null;
  const debugRaw = String(req.body?.debug ?? req.query?.debug ?? "").trim().toLowerCase();
  const debug =
    debugRaw === "1" ||
    debugRaw === "true" ||
    debugRaw === "yes" ||
    /[?&](debug|fresh)=frame-debug/i.test(url) ||
    /[?&]fresh=[^&]*frame-debug/i.test(url);
  const attemptNumber = Number(req.body?.attemptNumber ?? analyticsPayload?.attemptNumber) || 1;
  const triggerType =
    (req.body?.triggerType === "retry" || analyticsPayload?.triggerType === "retry") ? "retry" : "initial";

  return {
    url,
    mode,
    analyticsPayload,
    clientRunId: analyticsPayload?.clientRunId ? String(analyticsPayload.clientRunId) : null,
    debug,
    attemptNumber,
    triggerType: triggerType as "initial" | "retry",
  };
}

function buildMetadataUrlHash(url: string): string {
  const canonicalUrl = canonicalizeUrl(url);
  return createHash("sha1").update(canonicalUrl).digest("hex").slice(0, 12);
}

function buildMetadataExtractionContext(input: {
  url: string;
  clientRunId?: string | null;
  attemptNumber: number;
  triggerType: "initial" | "retry";
  routeName: MetadataExtractionRouteName;
  mode: ExtractionMode;
}): MetadataExtractionRequestContext {
  const clientRunId = input.clientRunId ? String(input.clientRunId) : null;
  const urlHash = buildMetadataUrlHash(input.url);
  return {
    key: `${clientRunId || "anon"}:${urlHash}:${input.attemptNumber}:${input.triggerType}`,
    requestId: clientRunId || `${input.routeName}:${urlHash}:${input.attemptNumber}:${input.triggerType}`,
    clientRunId,
    urlHash,
    attemptNumber: input.attemptNumber,
    triggerType: input.triggerType,
    routeName: input.routeName,
    mode: input.mode,
  };
}

function getOrStartMetadataExtraction(
  context: MetadataExtractionRequestContext,
  work: () => Promise<Awaited<ReturnType<typeof runExtractionPipeline>>>,
) {
  const existing = metadataExtractionInFlight.get(context.key);
  if (existing) {
    console.warn("[metadata-extraction]", {
      event: "join_inflight",
      routeName: context.routeName,
      existingRouteName: existing.context.routeName,
      requestId: context.requestId,
      clientRunId: context.clientRunId,
      urlHash: context.urlHash,
      attemptNumber: context.attemptNumber,
      triggerType: context.triggerType,
      mode: context.mode,
    });
    return {
      promise: existing.promise,
      isPrimary: false,
      existingRouteName: existing.context.routeName,
    };
  }

  const startedAt = Date.now();
  console.info("[metadata-extraction]", {
    event: "start",
    routeName: context.routeName,
    requestId: context.requestId,
    clientRunId: context.clientRunId,
    urlHash: context.urlHash,
    attemptNumber: context.attemptNumber,
    triggerType: context.triggerType,
    mode: context.mode,
  });

  const promise = work().finally(() => {
    metadataExtractionInFlight.delete(context.key);
    console.info("[metadata-extraction]", {
      event: "finish",
      routeName: context.routeName,
      requestId: context.requestId,
      clientRunId: context.clientRunId,
      urlHash: context.urlHash,
      attemptNumber: context.attemptNumber,
      triggerType: context.triggerType,
      mode: context.mode,
      elapsedMs: getElapsedMs(startedAt),
    });
  });
  metadataExtractionInFlight.set(context.key, {
    context,
    startedAt,
    promise,
  });
  return {
    promise,
    isPrimary: true,
    existingRouteName: null,
  };
}

function getElapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function setupSse(res: express.Response, req: express.Request, label: string) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let closed = false;
  req.on("close", () => {
    closed = true;
    console.info(`[sse] client closed`, { label });
  });

  const flushResponse = () => {
    const flush = (res as express.Response & { flush?: () => void }).flush;
    if (typeof flush === "function") {
      flush.call(res);
    }
  };

  const writeEvent = (event: string, payload: Record<string, unknown>) => {
    if (closed) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    flushResponse();
    console.info(`[sse] wrote event ${event}`, { label, stage: payload.stage ?? null });
  };

  return {
    get closed() {
      return closed;
    },
    writeEvent,
    end() {
      if (closed) return;
      res.end();
    },
  };
}

function inferStreamProgressFromResult(result: any) {
  const events: Array<{ stage: string; message: string; elapsedMs?: number }> = [];
  const timings = result?.debug?.timings || {};
  const orchestration = result?.debug?.orchestration || {};
  const fastPath = result?.debug?.fastPathIntelligence || {};

  events.push({ stage: "metadata_done", message: "Metadata fetched.", elapsedMs: Number(timings.metadataMs) || undefined });

  if (fastPath.tinyFastExtractorUsed) {
    events.push({ stage: "tiny_extractor_started", message: "Running tiny caption extractor." });
    events.push({
      stage: "tiny_extractor_done",
      message: fastPath.tinyFastExtractorAccepted ? "Tiny caption extractor finished." : "Tiny caption extractor was inconclusive.",
      elapsedMs: Number(fastPath.tinyFastExtractorMs) || undefined,
    });
  }

  if (orchestration.acceptedAfter === "description") {
    events.push({ stage: "accepted_description", message: "Accepted after caption evidence." });
  }

  if (result?.transcript?.attempted) {
    events.push({ stage: "transcript_started", message: "Reading transcript clues." });
    events.push({ stage: "transcript_done", message: "Transcript step finished." });
  }
  if (result?.debug?.frameExtraction?.didRun) {
    events.push({ stage: "frame_extraction_started", message: "Checking video frames." });
    events.push({ stage: "frame_extraction_done", message: "Frame check finished." });
  }
  if (result?.ocr?.attempted) {
    events.push({ stage: "ocr_started", message: "Reading on-screen text." });
    events.push({ stage: "ocr_done", message: "On-screen text step finished." });
  }
  if (result?.visualFallback?.attempted) {
    events.push({ stage: "visual_started", message: "Trying visual match." });
    events.push({ stage: "visual_done", message: "Visual match finished." });
  }

  return events;
}

async function executeMetadataExtraction(
  input: {
    url: string;
    mode: ExtractionMode;
    debug: boolean;
    attemptNumber: number;
    triggerType: "initial" | "retry";
    clientRunId?: string | null;
  },
) {
  return runExtractionPipeline({
    url: input.url,
    mode: input.mode,
    debug: input.debug,
    attemptNumber: input.attemptNumber,
    triggerType: input.triggerType,
    clientRunId: input.clientRunId ?? null,
  });
}

async function persistMetadataExtractionArtifacts(
  req: express.Request,
  result: Awaited<ReturnType<typeof runExtractionPipeline>>,
) {
  const attemptRecord = await createAnalyticsAttemptFromRequest(req, result);
  if (attemptRecord?.attemptId) {
    try {
      await persistReelAnalyticsAttemptArtifacts({
        attemptId: attemptRecord.attemptId,
        extractionResult: result,
      });
    } catch (artifactError) {
      console.error("persist extraction attempt artifacts failed", artifactError);
    }
  }
}

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

async function optionalAuth(req: express.Request, _res: express.Response, next: express.NextFunction) {
  try {
    const user = await resolveSessionUser(req);
    if (user) {
      (req as express.Request & { authUser?: NonNullable<typeof user> }).authUser = user;
    }
  } catch {
    // Analytics should not fail because auth lookup was unavailable.
  }
  next();
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

app.get("/api/location/suggest", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    if (query.length < 2) {
      return res.json({ ok: true, suggestions: [] });
    }
    const apiKey = String(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || "").trim();
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: "Google Maps key missing" });
    }
    const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
    url.searchParams.set("input", query);
    url.searchParams.set("key", apiKey);
    const response = await fetch(url.toString());
    if (!response.ok) {
      return res.status(502).json({ ok: false, error: "place autocomplete failed" });
    }
    const data = (await response.json()) as {
      status?: string;
      error_message?: string;
      predictions?: Array<{
        place_id?: string;
        description?: string;
        structured_formatting?: { main_text?: string; secondary_text?: string };
      }>;
    };
    if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return res.status(502).json({
        ok: false,
        error: data.error_message || `place autocomplete status: ${data.status}`,
      });
    }
    let suggestions = (data.predictions || []).slice(0, 7).map((p) => ({
      placeId: String(p.place_id || ""),
      label: String(p.structured_formatting?.main_text || p.description || "").trim(),
      secondaryText: String(p.structured_formatting?.secondary_text || "").trim() || null,
      description: String(p.description || "").trim() || null,
    })).filter((s) => s.placeId && s.label);

    // Fallback: if Places autocomplete returns nothing, use geocoding text search.
    if (suggestions.length === 0) {
      const geocodeUrl = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      geocodeUrl.searchParams.set("address", query);
      geocodeUrl.searchParams.set("key", apiKey);
      const geocodeRes = await fetch(geocodeUrl.toString());
      if (geocodeRes.ok) {
        const geocodeData = (await geocodeRes.json()) as {
          status?: string;
          error_message?: string;
          results?: Array<{
            place_id?: string;
            formatted_address?: string;
            address_components?: Array<{ long_name?: string; types?: string[] }>;
          }>;
        };
        if (geocodeData.status && geocodeData.status !== "OK" && geocodeData.status !== "ZERO_RESULTS") {
          return res.status(502).json({
            ok: false,
            error: geocodeData.error_message || `geocode status: ${geocodeData.status}`,
          });
        }
        suggestions = (geocodeData.results || []).slice(0, 7).map((item) => {
          const components = item.address_components || [];
          const pick = (type: string) => components.find((c) => c.types?.includes(type))?.long_name || null;
          const label =
            pick("locality") ||
            pick("administrative_area_level_2") ||
            pick("administrative_area_level_1") ||
            String(item.formatted_address || "").split(",")[0]?.trim() ||
            "";
          return {
            placeId: String(item.place_id || ""),
            label: String(label).trim(),
            secondaryText: String(item.formatted_address || "").trim() || null,
            description: String(item.formatted_address || "").trim() || null,
          };
        }).filter((s) => s.placeId && s.label);
      }
    }
    return res.json({ ok: true, suggestions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "place autocomplete failed";
    return res.status(500).json({ ok: false, error: message });
  }
});

app.get("/api/location/resolve-place", async (req, res) => {
  try {
    const placeId = String(req.query.placeId || "").trim();
    if (!placeId) {
      return res.status(400).json({ ok: false, error: "placeId is required" });
    }
    const apiKey = String(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || "").trim();
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: "Google Maps key missing" });
    }
    const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    detailsUrl.searchParams.set("place_id", placeId);
    detailsUrl.searchParams.set("fields", "geometry/location,address_components,name,formatted_address");
    detailsUrl.searchParams.set("key", apiKey);
    const response = await fetch(detailsUrl.toString());
    if (!response.ok) {
      return res.status(502).json({ ok: false, error: "place details failed" });
    }
    const data = (await response.json()) as {
      result?: {
        geometry?: { location?: { lat?: number; lng?: number } };
        address_components?: Array<{ long_name?: string; types?: string[] }>;
        name?: string;
      };
    };
    const location = data.result?.geometry?.location;
    if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
      return res.status(404).json({ ok: false, error: "place location not found" });
    }
    const components = data.result?.address_components || [];
    const pick = (type: string) => components.find((c) => c.types?.includes(type))?.long_name || null;
    const locality =
      pick("sublocality_level_1") ||
      pick("locality") ||
      pick("administrative_area_level_2") ||
      data.result?.name ||
      "Selected place";
    const state = pick("administrative_area_level_1");
    const label = [locality, state].filter(Boolean).join(", ");
    return res.json({
      ok: true,
      location: { lat: location.lat, lng: location.lng },
      label,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "place resolve failed";
    return res.status(500).json({ ok: false, error: message });
  }
});

app.post("/api/metadata/extract", async (req, res) => {
  const { url, mode, debug, attemptNumber, triggerType, clientRunId } = parseExtractionRequest(req);
  try {
    if (!url) {
      return res.status(400).json({ ok: false, error: "url is required" });
    }

    const context = buildMetadataExtractionContext({
      url,
      mode,
      clientRunId,
      attemptNumber,
      triggerType,
      routeName: "non_stream",
    });
    const execution = getOrStartMetadataExtraction(context, () => executeMetadataExtraction({
      url,
      mode,
      debug,
      attemptNumber,
      triggerType,
      clientRunId,
    }));
    const result = await execution.promise;
    if (execution.isPrimary) {
      await persistMetadataExtractionArtifacts(req, result);
    }
    if (featureFlags.extractionV2) {
      return res.json({ ok: true, ...result });
    }
    const { source, platform, canonicalUrl, stageStatus, stages, stageTimingsMs, stageFailures, sla, ...legacy } = result;
    return res.json({ ok: true, ...legacy });
  } catch (error) {
    const message = error instanceof Error ? error.message : "extraction failed";
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const stackPreview =
      debug || process.env.NODE_ENV !== "production"
        ? String(error instanceof Error ? error.stack || "" : "")
            .split(/\r?\n/)
            .slice(0, 5)
        : undefined;
    const diagnostics = {
      error: message,
      errorName,
      stackPreview,
      url,
      mode,
      attemptNumber,
      triggerType,
      debug,
    };
    console.error("[metadata-extract-error]", diagnostics);
    return res.status(500).json({
      ok: false,
      ...diagnostics,
    });
  }
});

app.post("/api/metadata/extract/stream-test", async (req, res) => {
  const { url, mode, debug, attemptNumber, triggerType, clientRunId } = parseExtractionRequest(req);
  if (!url) {
    return res.status(400).json({ ok: false, error: "url is required" });
  }

  const startedAt = Date.now();
  const sse = setupSse(res, req, "metadata_extract_stream_test");
  console.info("[sse] client connected", { label: "metadata_extract_stream_test", url, mode, attemptNumber, triggerType });

  let heartbeatTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
    if (sse.closed) {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      return;
    }
    sse.writeEvent("heartbeat", {
      stage: "heartbeat",
      message: "Still working...",
      elapsedMs: getElapsedMs(startedAt),
      attemptNumber,
    });
  }, 12000);

  sse.writeEvent("connected", {
    stage: "connected",
    message: "Starting analysis...",
    elapsedMs: 0,
    attemptNumber,
  });
  sse.writeEvent("started", {
    stage: "started",
    message: "Running known-good extraction path.",
    elapsedMs: getElapsedMs(startedAt),
    attemptNumber,
  });

  try {
    const context = buildMetadataExtractionContext({
      url,
      mode,
      clientRunId,
      attemptNumber,
      triggerType,
      routeName: "stream_test",
    });
    const execution = getOrStartMetadataExtraction(context, () => executeMetadataExtraction({
      url,
      mode,
      debug,
      attemptNumber,
      triggerType,
      clientRunId,
    }));
    if (!execution.isPrimary) {
      sse.writeEvent("joined_inflight", {
        stage: "joined_inflight",
        message: `Joined existing ${execution.existingRouteName || "metadata"} extraction.`,
        elapsedMs: getElapsedMs(startedAt),
        attemptNumber,
      });
    }
    const result = await execution.promise;
    if (execution.isPrimary) {
      await persistMetadataExtractionArtifacts(req, result);
    }

    for (const event of inferStreamProgressFromResult(result)) {
      if (sse.closed) return;
      sse.writeEvent(event.stage, {
        stage: event.stage,
        message: event.message,
        elapsedMs: typeof event.elapsedMs === "number" ? event.elapsedMs : getElapsedMs(startedAt),
        attemptNumber,
      });
    }

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    if (sse.closed) return;
    sse.writeEvent("completed", {
      stage: "completed",
      message: "Extraction completed.",
      elapsedMs: result.debug?.timings && typeof (result.debug as any).timings.extractionTotalMs === "number"
        ? (result.debug as any).timings.extractionTotalMs
        : result.sla?.totalMs ?? result.perf?.totalMs ?? getElapsedMs(startedAt),
      attemptNumber,
      result: { ok: true, ...result },
    });
    sse.end();
  } catch (error) {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    const message = error instanceof Error ? error.message : "extraction failed";
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const stackPreview =
      debug || process.env.NODE_ENV !== "production"
        ? String(error instanceof Error ? error.stack || "" : "")
            .split(/\r?\n/)
            .slice(0, 5)
        : undefined;
    const diagnostics = {
      error: message,
      errorName,
      stackPreview,
      url,
      mode,
      attemptNumber,
      triggerType,
      debug,
    };
    console.error("[sse] error", { label: "metadata_extract_stream_test", diagnostics });
    console.error("[metadata-extract-error]", diagnostics);
    if (!sse.closed) {
      sse.writeEvent("failed", {
        stage: "failed",
        message,
        elapsedMs: getElapsedMs(startedAt),
        attemptNumber,
        error: diagnostics,
      });
      sse.end();
    }
  }
});

app.post("/api/metadata/extract/stream", async (req, res) => {
  const { url, mode, debug, attemptNumber, triggerType, clientRunId } = parseExtractionRequest(req);
  if (!url) {
    return res.status(400).json({ ok: false, error: "url is required" });
  }

  const startedAt = Date.now();
  const sse = setupSse(res, req, "metadata_extract_stream");
  console.info("[sse] client connected", { label: "metadata_extract_stream", url, mode, attemptNumber, triggerType });
  const seenStages = new Set<string>();

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  const clearHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const writeProgressEvent = (event: string, payload: Record<string, unknown>) => {
    const stage = typeof payload.stage === "string" ? payload.stage : event;
    seenStages.add(stage);
    sse.writeEvent(event, payload);
  };

  writeProgressEvent("connected", {
    stage: "connected",
    message: "Starting analysis...",
    elapsedMs: 0,
    attemptNumber,
  });

  heartbeatTimer = setInterval(() => {
    if (sse.closed) {
      clearHeartbeat();
      return;
    }
    writeProgressEvent("heartbeat", {
      stage: "heartbeat",
      message: "Still working...",
      elapsedMs: getElapsedMs(startedAt),
      attemptNumber,
    });
  }, 12000);

  try {
    const context = buildMetadataExtractionContext({
      url,
      mode,
      clientRunId,
      attemptNumber,
      triggerType,
      routeName: "stream",
    });
    const execution = getOrStartMetadataExtraction(context, () => executeMetadataExtraction({
      url,
      mode,
      debug,
      attemptNumber,
      triggerType,
      clientRunId,
    }));
    console.info("[sse] before runExtractionPipeline", { label: "metadata_extract_stream", url, mode, attemptNumber, triggerType });
    writeProgressEvent("started", {
      stage: "started",
      message: execution.isPrimary ? "Extraction started." : `Joined existing ${execution.existingRouteName || "metadata"} extraction.`,
      elapsedMs: getElapsedMs(startedAt),
      attemptNumber,
    });
    if (!seenStages.has("metadata_started")) {
      writeProgressEvent("metadata_started", {
        stage: "metadata_started",
        message: "Fetching metadata.",
        elapsedMs: getElapsedMs(startedAt),
        attemptNumber,
      });
    }
    if (!execution.isPrimary) {
      writeProgressEvent("joined_inflight", {
        stage: "joined_inflight",
        message: `Joined existing ${execution.existingRouteName || "metadata"} extraction.`,
        elapsedMs: getElapsedMs(startedAt),
        attemptNumber,
      });
    }
    const result = await execution.promise;
    for (const event of inferStreamProgressFromResult(result)) {
      if (seenStages.has(event.stage)) continue;
      writeProgressEvent(event.stage, {
        stage: event.stage,
        message: event.message,
        elapsedMs: typeof event.elapsedMs === "number" ? event.elapsedMs : getElapsedMs(startedAt),
        attemptNumber,
      });
    }
    clearHeartbeat();
    writeProgressEvent("completed", {
      stage: "completed",
      message: "Extraction completed.",
      elapsedMs: result.debug?.timings && typeof (result.debug as any).timings.extractionTotalMs === "number"
        ? (result.debug as any).timings.extractionTotalMs
        : result.sla?.totalMs ?? result.perf?.totalMs ?? 0,
      attemptNumber,
      result: { ok: true, ...result },
    });
    sse.end();
    if (execution.isPrimary) {
      void persistMetadataExtractionArtifacts(req, result);
    }
  } catch (error) {
    clearHeartbeat();
    const message = error instanceof Error ? error.message : "extraction failed";
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const stackPreview =
      debug || process.env.NODE_ENV !== "production"
        ? String(error instanceof Error ? error.stack || "" : "")
            .split(/\r?\n/)
            .slice(0, 5)
        : undefined;
    const diagnostics = {
      error: message,
      errorName,
      stackPreview,
      url,
      mode,
      attemptNumber,
      triggerType,
      debug,
    };
    console.error("[sse] error", { label: "metadata_extract_stream", diagnostics });
    console.error("[metadata-extract-error]", diagnostics);
    writeProgressEvent("failed", {
      stage: "failed",
      message,
      elapsedMs: getElapsedMs(startedAt),
      attemptNumber,
      error: diagnostics,
    });
    sse.end();
  }
});

app.get("/api/debug/sse", async (req, res) => {
  const startedAt = Date.now();
  const sse = setupSse(res, req, "debug_sse");
  console.info("[sse] client connected", { label: "debug_sse" });
  sse.writeEvent("connected", {
    stage: "connected",
    message: "Debug stream connected.",
    elapsedMs: 0,
    attemptNumber: 1,
  });
  sse.writeEvent("started", {
    stage: "started",
    message: "Starting debug stream...",
    elapsedMs: 0,
    attemptNumber: 1,
  });

  for (let index = 1; index <= 5; index += 1) {
    if (sse.closed) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    sse.writeEvent("tick", {
      stage: "heartbeat",
      message: `Tick ${index}`,
      elapsedMs: getElapsedMs(startedAt),
      attemptNumber: 1,
    });
  }

  if (sse.closed) return;
  sse.writeEvent("completed", {
    stage: "completed",
    message: "Debug stream completed.",
    elapsedMs: getElapsedMs(startedAt),
    attemptNumber: 1,
  });
  sse.end();
});

app.post("/api/metadata/extract/deep-async", async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    if (!url) {
      return res.status(400).json({ ok: false, error: "url is required" });
    }

    const quick = await runExtractionPipeline({ url, mode: "quick" });
    const job = await extractionJobStore.createDeep(url);
    if (isPostgresConfigured()) {
      try {
        await createReelJob({
          jobId: job.id,
          jobType: "extraction_deep_async",
          status: job.status,
          progressJson: { stage: "extraction", mode: "deep", sourceUrl: url },
        });
      } catch (jobError) {
        console.error("create extraction reel job failed", jobError);
      }
    }

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
  if (job) {
    return res.json({ ok: true, job });
  }
  if (isPostgresConfigured()) {
    const durableJob = await getReelJob(jobId);
    if (durableJob) {
      return res.json({
        ok: true,
        job: {
          id: durableJob.id,
          status: durableJob.status,
          createdAtIso: durableJob.createdAt,
          updatedAtIso: durableJob.updatedAt,
          error: durableJob.errorMessage,
          result: durableJob.resultJson,
        },
      });
    }
  }
  return res.status(404).json({ ok: false, error: "job not found" });
});

async function createAnalyticsAttemptFromRequest(
  req: express.Request,
  source: any,
) {
  if (!isPostgresConfigured()) return null;
  const analyticsPayload = req.body?.analytics && typeof req.body.analytics === "object" ? req.body.analytics : null;
  if (!analyticsPayload?.clientRunId) return null;
  const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
  try {
    return await createReelAnalyticsAttempt({
      clientRunId: String(analyticsPayload.clientRunId),
      userId: authUser?.userId ?? null,
      anonymousId: analyticsPayload?.anonymousId ? String(analyticsPayload.anonymousId) : null,
      sourceUrl: String(source?.metadata?.canonicalUrl || source?.metadata?.sourceUrl || source?.source || ""),
      sourcePlatform: source?.metadata?.platform ? String(source.metadata.platform) : null,
      attemptNumber: Number(analyticsPayload?.attemptNumber) || 1,
      triggerType: analyticsPayload?.triggerType === "retry" ? "retry" : "initial",
    });
  } catch (attemptError) {
    console.error("create analytics attempt failed", attemptError);
    return null;
  }
}

async function persistAnalyticsEntitiesForAttempt(input: {
  runId: string;
  attemptId?: string | null;
  attemptNumber: number;
  result: {
    output?: {
      structuredEntities?: Array<Record<string, unknown>>;
      entities?: Array<Record<string, unknown>>;
    };
  };
}) {
  const structuredEntities = Array.isArray(input.result.output?.structuredEntities)
    ? input.result.output?.structuredEntities ?? []
    : [];
  const entities = Array.isArray(input.result.output?.entities) ? input.result.output?.entities ?? [] : [];

  await upsertReelAnalyticsEntities({
    runId: input.runId,
    attemptId: input.attemptId ?? null,
    attemptNumber: input.attemptNumber,
    entities: structuredEntities.map((entity, index) => {
      const rawEntity = entities[index] || {};
      const locality = typeof entity.locality === "string" ? entity.locality : null;
      const city = typeof entity.city === "string" ? entity.city : null;
      const subtitle = locality || city || (typeof entity.address === "string" ? entity.address : null);
      return {
        entityIndex: index,
        entityType:
          typeof rawEntity.entityType === "string"
            ? rawEntity.entityType
            : typeof entity.category === "string"
              ? entity.category
              : null,
        title: typeof entity.name === "string" ? entity.name : null,
        subtitle,
        placeCandidateId:
          typeof entity.placeId === "string"
            ? entity.placeId
            : typeof entity.googleMapsQuery === "string"
              ? entity.googleMapsQuery
              : null,
        finalPlaceId: typeof entity.placeId === "string" ? entity.placeId : null,
        confidence:
          typeof entity.confidence === "number"
            ? entity.confidence
            : entity.confidence === "high"
              ? 0.9
              : entity.confidence === "medium"
                ? 0.6
                : entity.confidence === "low"
                  ? 0.3
                  : null,
        metadataJson: {
          structuredEntity: entity,
          rawEntity,
        },
      };
    }),
  });
}

function getAttempt1FastPathIntelligenceResult(source: any): IntelligencePipelineResult | null {
  const attemptNumber = Number(source?.attemptInfo?.attemptNumber ?? source?.debug?.orchestration?.attemptNumber ?? 1) || 1;
  const acceptedAfter = String(source?.debug?.orchestration?.acceptedAfter || "");
  const fastPath = source?.debug?.fastPathIntelligence;
  if (attemptNumber !== 1 || acceptedAfter !== "description") return null;
  if (!fastPath || fastPath.accepted !== true || !fastPath.result) return null;
  return fastPath.result as IntelligencePipelineResult;
}

app.post("/api/intelligence/extract", optionalAuth, async (req, res) => {
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
      const attemptRecord = await createAnalyticsAttemptFromRequest(req, source);
      const analyticsPayload = req.body?.analytics && typeof req.body.analytics === "object" ? req.body.analytics : null;
      const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
      const job = await intelligenceJobStore.create({
        source,
        analytics: {
          attemptId: attemptRecord?.attemptId ?? null,
          runId: attemptRecord?.runId ?? null,
          clientRunId: analyticsPayload?.clientRunId ? String(analyticsPayload.clientRunId) : null,
          attemptNumber: Number(analyticsPayload?.attemptNumber) || 1,
          triggerType: analyticsPayload?.triggerType === "retry" ? "retry" : "initial",
          anonymousId: analyticsPayload?.anonymousId ? String(analyticsPayload.anonymousId) : null,
          userId: authUser?.userId ?? null,
        },
      });
      if (isPostgresConfigured()) {
        try {
          await createReelJob({
            jobId: job.id,
            runId: attemptRecord?.runId ?? null,
            attemptId: attemptRecord?.attemptId ?? null,
            attemptNumber: Number(analyticsPayload?.attemptNumber) || 1,
            jobType: "intelligence_async",
            status: job.status,
            progressJson: { mode, stage: "intelligence" },
          });
        } catch (jobError) {
          console.error("create reel job failed", jobError);
        }
      }
      return res.status(202).json({
        ok: true,
        mode,
        jobId: job.id,
        status: job.status,
        createdAtIso: job.createdAtIso,
      });
    }

    if (mode === "draft_async") {
        const fastPathResult = getAttempt1FastPathIntelligenceResult(source);
      if (fastPathResult) {
        return res.json({
          ok: true,
          mode,
          draft: false,
          ...fastPathResult,
        });
      }
      const attemptRecord = await createAnalyticsAttemptFromRequest(req, source);
      const analyticsPayload = req.body?.analytics && typeof req.body.analytics === "object" ? req.body.analytics : null;
      const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
      const job = await intelligenceJobStore.create({
        source,
        analytics: {
          attemptId: attemptRecord?.attemptId ?? null,
          runId: attemptRecord?.runId ?? null,
          clientRunId: analyticsPayload?.clientRunId ? String(analyticsPayload.clientRunId) : null,
          requestId: analyticsPayload?.clientRunId ? `intelligence:${String(analyticsPayload.clientRunId)}:draft_async` : null,
          attemptNumber: Number(analyticsPayload?.attemptNumber) || 1,
          triggerType: analyticsPayload?.triggerType === "retry" ? "retry" : "initial",
          anonymousId: analyticsPayload?.anonymousId ? String(analyticsPayload.anonymousId) : null,
          userId: authUser?.userId ?? null,
        },
      });
      if (isPostgresConfigured()) {
        try {
          await createReelJob({
            jobId: job.id,
            runId: attemptRecord?.runId ?? null,
            attemptId: attemptRecord?.attemptId ?? null,
            attemptNumber: Number(analyticsPayload?.attemptNumber) || 1,
            jobType: "intelligence_draft_async",
            status: job.status,
            progressJson: { mode, stage: "intelligence", draft: true },
          });
        } catch (jobError) {
          console.error("create reel job failed", jobError);
        }
      }
      const draftOutput = buildDraftIntelligenceOutput(source);
      console.info("[draft-async]", {
        event: "draft_output",
        clientRunId: analyticsPayload?.clientRunId ? String(analyticsPayload.clientRunId) : null,
        attemptNumber: Number(analyticsPayload?.attemptNumber) || 1,
        acceptedAfter: String(source?.debug?.orchestration?.acceptedAfter || ""),
        ocrChars: String(source?.ocr?.text || "").trim().length,
        entityCount: Array.isArray(draftOutput.structuredEntities) ? draftOutput.structuredEntities.length : 0,
        entities: (draftOutput.structuredEntities || []).map((entity) => ({
          name: entity.name,
          category: entity.category,
          locality: entity.locality,
          confidence: entity.confidence,
        })),
        status: draftOutput.status,
      });
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

    const attemptRecord = await createAnalyticsAttemptFromRequest(req, source);
    const analyticsPayload = req.body?.analytics && typeof req.body.analytics === "object" ? req.body.analytics : null;
    const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
    const fastPathResult = getAttempt1FastPathIntelligenceResult(source);
    const result = fastPathResult || await runIntelligencePipeline({
      source,
      analytics: {
        attemptId: attemptRecord?.attemptId ?? null,
        runId: attemptRecord?.runId ?? null,
        clientRunId: analyticsPayload?.clientRunId ? String(analyticsPayload.clientRunId) : null,
        requestId: analyticsPayload?.clientRunId ? `intelligence:${String(analyticsPayload.clientRunId)}:${mode}` : null,
        attemptNumber: Number(analyticsPayload?.attemptNumber) || 1,
        triggerType: analyticsPayload?.triggerType === "retry" ? "retry" : "initial",
        anonymousId: analyticsPayload?.anonymousId ? String(analyticsPayload.anonymousId) : null,
        userId: authUser?.userId ?? null,
      },
    });
    const attemptNumber = Number(analyticsPayload?.attemptNumber) || 1;
    const hypothesisSummary = buildAttemptHypothesisSummary({
      source,
      result,
      attemptNumber,
    });
    saveAttemptHypothesisSummary({
      mode: source.mode === "deep" ? "deep" : "quick",
      url: source.canonicalUrl || source.metadata?.canonicalUrl || source.metadata?.sourceUrl || source.source,
      attemptNumber,
      summary: hypothesisSummary,
    });
    if (attemptRecord?.attemptId) {
      try {
        await finalizeReelAnalyticsAttempt({
          attemptId: attemptRecord.attemptId,
          status: "completed",
          sourcePlatform: source?.metadata?.platform ? String(source.metadata.platform) : null,
          model: result.providerMeta?.model ?? null,
          inputTokens: result.usage?.inputTokens ?? null,
          outputTokens: result.usage?.outputTokens ?? null,
          totalTokens: result.usage?.totalTokens ?? null,
          providerLatencyMs: result.timingsMs?.provider ?? null,
          totalLatencyMs: result.timingsMs?.total ?? null,
          entityCount: Array.isArray(result.output?.structuredEntities) ? result.output.structuredEntities.length : 0,
          intelligenceStatus: result.output?.status ?? null,
          validationErrorCount: Array.isArray(result.validationErrors) ? result.validationErrors.length : 0,
        });
      } catch (attemptFinalizeError) {
        console.error("finalize analytics attempt failed", attemptFinalizeError);
      }
      try {
        await persistReelAnalyticsAttemptArtifacts({
          attemptId: attemptRecord.attemptId,
          intelligenceResult: result,
          hypothesisSummary,
        });
      } catch (artifactError) {
        console.error("persist intelligence attempt artifacts failed", artifactError);
      }
    }
    if (attemptRecord?.runId) {
      try {
        await persistAnalyticsEntitiesForAttempt({
          runId: attemptRecord.runId,
          attemptId: attemptRecord.attemptId,
          attemptNumber: Number(req.body?.analytics?.attemptNumber) || 1,
          result,
        });
      } catch (entityError) {
        console.error("persist analytics entities failed", entityError);
      }
    }
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
  if (job) {
    return res.json({ ok: true, job });
  }
  if (isPostgresConfigured()) {
    const durableJob = await getReelJob(jobId);
    if (durableJob) {
      return res.json({
        ok: true,
        job: {
          id: durableJob.id,
          status: durableJob.status,
          createdAtIso: durableJob.createdAt,
          updatedAtIso: durableJob.updatedAt,
          error: durableJob.errorMessage,
          result: durableJob.resultJson,
        },
      });
    }
  }
  return res.status(404).json({ ok: false, error: "job not found" });
});

app.post("/api/analytics/reel-event", optionalAuth, async (req, res) => {
  try {
    if (!isPostgresConfigured()) {
      return res.status(204).end();
    }
    const clientRunId = String(req.body?.clientRunId || "").trim();
    const eventName = String(req.body?.eventName || "").trim();
    if (!clientRunId || !["saved", "edited", "discarded"].includes(eventName)) {
      return res.status(400).json({ ok: false, error: "clientRunId and valid eventName are required" });
    }
    const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
    await recordReelAnalyticsEvent({
      clientRunId,
      userId: authUser?.userId ?? null,
      anonymousId: req.body?.anonymousId ? String(req.body.anonymousId).trim() : null,
      sourceUrl: req.body?.sourceUrl ? String(req.body.sourceUrl).trim() : null,
      sourcePlatform: req.body?.sourcePlatform ? String(req.body.sourcePlatform).trim() : null,
      attemptNumber: Number(req.body?.attemptNumber) || null,
      eventName: eventName as "saved" | "edited" | "discarded",
      payload: req.body?.payload ?? {},
    });
    try {
      const runId = await getReelAnalyticsRunIdByClientRunId(clientRunId);
      if (runId) {
        const payloadEntityIndex =
          req.body?.payload && typeof req.body.payload === "object" && Number.isFinite(Number((req.body.payload as Record<string, unknown>).entityIndex))
            ? Number((req.body.payload as Record<string, unknown>).entityIndex)
            : null;
        await markReelAnalyticsEntityOutcome({
          runId,
          attemptNumber: Number(req.body?.attemptNumber) || 1,
          entityId: req.body?.entityId ? String(req.body.entityId).trim() : null,
          entityIndex: Number.isFinite(Number(req.body?.entityIndex)) ? Number(req.body.entityIndex) : payloadEntityIndex,
          eventName: eventName as "saved" | "edited" | "discarded",
          finalPlaceId: req.body?.finalPlaceId ? String(req.body.finalPlaceId).trim() : null,
        });
      }
    } catch (entityError) {
      console.error("mark analytics entity outcome failed", entityError);
    }
    return res.status(201).json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record analytics event";
    return res.status(400).json({ ok: false, error: message });
  }
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
