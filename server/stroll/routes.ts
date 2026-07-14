import type express from "express";
import {
  acceptStrollOrderSchema,
  createDraftStrollSchema,
  heroBookmarkSchema,
  heroInteractionSchema,
  removeHeroBookmarkSchema,
  updateDraftStrollSchema,
  updateOnboardingSchema,
} from "./contracts";
import { recommendStrollAdaptation } from "./adaptation";
import {
  StrollCurationConflictError,
  strollCurationJobStore,
  type StrollCurationJob,
  type TriggerStrollCurationMode,
} from "./jobStore";
import {
  strollLiveIntelligenceService,
  type StrollLiveConditionsResponse,
} from "./liveIntelligence";
import { createInMemoryRateLimit, type RateLimitOptions } from "./rateLimits";
import {
  acceptStrollStopOrder,
  archiveStroll,
  createDraftStroll,
  getStrollDetail,
  getStrollOnboarding,
  listHeroBookmarks,
  listStrolls,
  recordHeroInteraction,
  removeHeroBookmark,
  StrollDraftValidationError,
  StrollUpdateValidationError,
  StrollReorderValidationError,
  updateDraftStroll,
  updateStrollOnboarding,
  upsertHeroBookmark,
} from "./store";

type AuthenticatedRequest = express.Request & {
  authUser?: {
    userId: string;
  };
};

type RegisterStrollRoutesOptions = {
  requireAuth: express.RequestHandler;
  curationJobStore?: {
    getStatus: (userId: string, strollId: string) => Promise<unknown | null>;
    trigger: (options: {
      userId: string;
      strollId: string;
      mode?: TriggerStrollCurationMode;
    }) => Promise<{ duplicate: boolean; job: StrollCurationJob; stroll: unknown; completion: Promise<unknown> }>;
  };
  liveConditionsService?: {
    getLiveConditions: (stroll: NonNullable<Awaited<ReturnType<typeof getStrollDetail>>>) => Promise<StrollLiveConditionsResponse>;
  };
  rateLimits?: Partial<Record<"create" | "retry" | "live" | "adaptation" | "reorder", RateLimitOptions | false>>;
};

function getUserId(req: express.Request) {
  return (req as AuthenticatedRequest).authUser?.userId;
}

function sendValidationError(res: express.Response, error: unknown) {
  return res.status(400).json({
    ok: false,
    error: "Invalid request",
    issues: error,
  });
}

function serializeCurationJob(job: StrollCurationJob) {
  return {
    id: job.id,
    userId: job.userId,
    strollId: job.strollId,
    status: job.status,
    failureCode: job.failureCode,
    failureMessage: job.failureMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function sendCurationError(res: express.Response, error: unknown, fallbackMessage: string) {
  if (error instanceof StrollCurationConflictError) {
    return res.status(error.statusCode).json({ ok: false, error: error.message, code: error.code });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ ok: false, error: "Failed to curate Stroll" });
}

function unavailableLiveConditions(strollId: string): StrollLiveConditionsResponse {
  const now = new Date().toISOString();
  return {
    strollId,
    status: "unavailable",
    fetchedTimestamp: now,
    expiryTimestamp: null,
    conditions: [],
    providers: [],
  };
}

function parseCurrentLocation(req: express.Request) {
  const latitude = Number(req.query.currentLat);
  const longitude = Number(req.query.currentLng);
  if (Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
    return { latitude, longitude };
  }
  return null;
}

const defaultRateLimits: Record<"create" | "retry" | "live" | "adaptation" | "reorder", RateLimitOptions> = {
  create: { keyPrefix: "stroll-create", windowMs: 60_000, max: 20 },
  retry: { keyPrefix: "stroll-retry", windowMs: 60_000, max: 20 },
  live: { keyPrefix: "stroll-live", windowMs: 60_000, max: 120 },
  adaptation: { keyPrefix: "stroll-adaptation", windowMs: 60_000, max: 120 },
  reorder: { keyPrefix: "stroll-reorder", windowMs: 60_000, max: 30 },
};

function resolveRateLimit(
  options: RegisterStrollRoutesOptions,
  name: keyof typeof defaultRateLimits,
): express.RequestHandler {
  const configured = options.rateLimits?.[name];
  if (configured === false) return (_req, _res, next) => next();
  return createInMemoryRateLimit(configured ?? defaultRateLimits[name]);
}

export function registerStrollRoutes(app: express.Express, options: RegisterStrollRoutesOptions) {
  const { requireAuth } = options;
  const curationJobs = options.curationJobStore ?? strollCurationJobStore;
  const liveConditions = options.liveConditionsService ?? strollLiveIntelligenceService;
  const createLimit = resolveRateLimit(options, "create");
  const retryLimit = resolveRateLimit(options, "retry");
  const liveLimit = resolveRateLimit(options, "live");
  const adaptationLimit = resolveRateLimit(options, "adaptation");
  const reorderLimit = resolveRateLimit(options, "reorder");

  app.get("/api/stroll/onboarding", requireAuth, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const onboarding = await getStrollOnboarding(userId);
      return res.json({ ok: true, onboarding });
    } catch (error) {
      console.error("stroll onboarding read failed", error);
      return res.status(500).json({ ok: false, error: "Failed to read Stroll onboarding" });
    }
  });

  app.patch("/api/stroll/onboarding", requireAuth, async (req, res) => {
    const parsed = updateOnboardingSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendValidationError(res, parsed.error.flatten());

    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const onboarding = await updateStrollOnboarding(userId, parsed.data);
      return res.json({ ok: true, onboarding });
    } catch (error) {
      console.error("stroll onboarding update failed", error);
      return res.status(500).json({ ok: false, error: "Failed to update Stroll onboarding" });
    }
  });

  app.post("/api/strolls", requireAuth, createLimit, async (req, res) => {
    const parsed = createDraftStrollSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendValidationError(res, parsed.error.flatten());

    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const result = await createDraftStroll(userId, parsed.data);
      return res.status(result.created ? 201 : 200).json({
        ok: true,
        created: result.created,
        stroll: result.stroll,
      });
    } catch (error) {
      if (error instanceof StrollDraftValidationError) {
        return res.status(error.statusCode).json({ ok: false, error: error.message, code: error.code });
      }
      console.error("draft stroll create failed", error);
      return res.status(500).json({ ok: false, error: "Failed to create draft Stroll" });
    }
  });

  app.get("/api/strolls", requireAuth, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const includeArchived = String(req.query.includeArchived || "").toLowerCase() === "true";
      const strolls = await listStrolls(userId, includeArchived);
      return res.json({ ok: true, strolls });
    } catch (error) {
      console.error("stroll list failed", error);
      return res.status(500).json({ ok: false, error: "Failed to list Strolls" });
    }
  });

  app.post("/api/strolls/:strollId/curate", requireAuth, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const result = await curationJobs.trigger({
        userId,
        strollId: String(req.params.strollId || ""),
        mode: "initial",
      });
      void result.completion;
      return res.status(result.duplicate ? 200 : 202).json({
        ok: true,
        duplicate: result.duplicate,
        job: serializeCurationJob(result.job),
        stroll: result.stroll,
      });
    } catch (error) {
      return sendCurationError(res, error, "stroll curation trigger failed");
    }
  });

  app.get("/api/strolls/:strollId/status", requireAuth, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const stroll = await curationJobs.getStatus(userId, String(req.params.strollId || ""));
      if (!stroll) return res.status(404).json({ ok: false, error: "Stroll not found" });
      return res.json({ ok: true, stroll });
    } catch (error) {
      console.error("stroll status read failed", error);
      return res.status(500).json({ ok: false, error: "Failed to read Stroll status" });
    }
  });

  app.post("/api/strolls/:strollId/retry", requireAuth, retryLimit, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const result = await curationJobs.trigger({
        userId,
        strollId: String(req.params.strollId || ""),
        mode: "retry",
      });
      void result.completion;
      return res.status(result.duplicate ? 200 : 202).json({
        ok: true,
        duplicate: result.duplicate,
        job: serializeCurationJob(result.job),
        stroll: result.stroll,
      });
    } catch (error) {
      return sendCurationError(res, error, "stroll curation retry failed");
    }
  });

  app.get("/api/strolls/:strollId", requireAuth, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const stroll = await getStrollDetail(userId, String(req.params.strollId || ""));
      if (!stroll) return res.status(404).json({ ok: false, error: "Stroll not found" });
      return res.json({ ok: true, stroll });
    } catch (error) {
      console.error("stroll detail failed", error);
      return res.status(500).json({ ok: false, error: "Failed to read Stroll" });
    }
  });

  app.patch("/api/strolls/:strollId", requireAuth, async (req, res) => {
    const parsed = updateDraftStrollSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendValidationError(res, parsed.error.flatten());

    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const stroll = await updateDraftStroll(userId, String(req.params.strollId || ""), parsed.data);
      if (!stroll) return res.status(404).json({ ok: false, error: "Stroll not found" });
      return res.json({ ok: true, stroll });
    } catch (error) {
      if (error instanceof StrollUpdateValidationError) {
        return res.status(error.statusCode).json({ ok: false, error: error.message, code: error.code });
      }
      console.error("stroll update failed", error);
      return res.status(500).json({ ok: false, error: "Failed to update Stroll" });
    }
  });

  app.get("/api/strolls/:strollId/live-conditions", requireAuth, liveLimit, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const stroll = await getStrollDetail(userId, String(req.params.strollId || ""));
      if (!stroll) return res.status(404).json({ ok: false, error: "Stroll not found" });
      const live = await liveConditions.getLiveConditions(stroll);
      return res.json({ ok: true, live });
    } catch (error) {
      console.error("stroll live conditions failed", error);
      return res.status(500).json({ ok: false, error: "Failed to read Stroll live conditions" });
    }
  });

  app.get("/api/strolls/:strollId/adaptation-recommendation", requireAuth, adaptationLimit, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const stroll = await getStrollDetail(userId, String(req.params.strollId || ""));
      if (!stroll) return res.status(404).json({ ok: false, error: "Stroll not found" });
      const live = await liveConditions.getLiveConditions(stroll).catch((error) => {
        console.error("stroll adaptation live input failed", error);
        return unavailableLiveConditions(stroll.id);
      });
      const recommendation = recommendStrollAdaptation(stroll, {
        liveConditions: live,
        currentLocation: parseCurrentLocation(req),
      });
      return res.json({ ok: true, recommendation });
    } catch (error) {
      console.error("stroll adaptation recommendation failed", error);
      return res.status(500).json({ ok: false, error: "Failed to read Stroll adaptation recommendation" });
    }
  });

  app.post("/api/strolls/:strollId/reorder", requireAuth, reorderLimit, async (req, res) => {
    const parsed = acceptStrollOrderSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendValidationError(res, parsed.error.flatten());

    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const stroll = await acceptStrollStopOrder(userId, String(req.params.strollId || ""), parsed.data.stopIds);
      if (!stroll) return res.status(404).json({ ok: false, error: "Stroll not found" });
      return res.json({ ok: true, stroll });
    } catch (error) {
      if (error instanceof StrollReorderValidationError) {
        return res.status(error.statusCode).json({ ok: false, error: error.message, code: error.code });
      }
      console.error("stroll reorder failed", error);
      return res.status(500).json({ ok: false, error: "Failed to reorder Stroll" });
    }
  });

  app.post("/api/strolls/:strollId/archive", requireAuth, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const stroll = await archiveStroll(userId, String(req.params.strollId || ""));
      if (!stroll) return res.status(404).json({ ok: false, error: "Stroll not found" });
      return res.json({ ok: true, stroll });
    } catch (error) {
      console.error("stroll archive failed", error);
      return res.status(500).json({ ok: false, error: "Failed to archive Stroll" });
    }
  });

  app.get("/api/hero-bookmarks", requireAuth, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const bookmarks = await listHeroBookmarks(userId);
      return res.json({ ok: true, bookmarks });
    } catch (error) {
      console.error("hero bookmarks list failed", error);
      return res.status(500).json({ ok: false, error: "Failed to list hero bookmarks" });
    }
  });

  app.post("/api/hero-bookmarks", requireAuth, async (req, res) => {
    const parsed = heroBookmarkSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendValidationError(res, parsed.error.flatten());

    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const bookmark = await upsertHeroBookmark(userId, parsed.data);
      return res.json({ ok: true, bookmark });
    } catch (error) {
      console.error("hero bookmark upsert failed", error);
      return res.status(500).json({ ok: false, error: "Failed to save hero bookmark" });
    }
  });

  app.post("/api/hero-bookmarks/remove", requireAuth, async (req, res) => {
    const parsed = removeHeroBookmarkSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendValidationError(res, parsed.error.flatten());

    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const removed = await removeHeroBookmark(userId, parsed.data.cardKey);
      return res.json({ ok: true, removed });
    } catch (error) {
      console.error("hero bookmark remove failed", error);
      return res.status(500).json({ ok: false, error: "Failed to remove hero bookmark" });
    }
  });

  app.post("/api/hero-interactions", requireAuth, async (req, res) => {
    const parsed = heroInteractionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendValidationError(res, parsed.error.flatten());

    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    try {
      await recordHeroInteraction(userId, parsed.data);
      return res.json({ ok: true, recorded: true });
    } catch (error) {
      console.error("hero interaction insert failed", error);
      return res.json({ ok: true, recorded: false });
    }
  });
}
