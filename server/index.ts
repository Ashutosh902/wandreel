import "dotenv/config";
import { createHash } from "node:crypto";
import express from "express";
import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { extractionJobStore, runExtractionPipeline, type ExtractionMode } from "./extraction";
import { intelligenceJobStore, runIntelligencePipeline, sanitizeIntelligenceOutputEntityNames, type IntelligenceMode } from "./intelligence";
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
  findSavedPlaceByUserAndPlaceId,
  finalizeReelAnalyticsAttempt,
  findSessionUser,
  getPostgresDatabase,
  getAdminObservabilityOverview,
  getAdminObservabilityLinks,
  getAdminObservabilityLinkDetail,
  getAdminUsageOverview,
  getAdminUsageUsers,
  getReelAnalyticsRunIdByClientRunId,
  getReelJob,
  getLatestReusableMetadataExtractionByCanonicalUrl,
  getSessionCookieName,
  isPostgresConfigured,
  issueEmailOtp,
  insertEntityFieldEdits,
  listSavedPlaces,
  markReelAnalyticsEntityOutcome,
  recordReelAnalyticsEvent,
  linkRunToSubmittedLink,
  persistReelAnalyticsAttemptArtifacts,
  revokeSession,
  updateAttemptPromotedFields,
  updateRunFinalOutcome,
  upsertAttemptEvidence,
  upsertAttemptStageRuns,
  upsertReelAnalyticsEntities,
  upsertSubmittedLink,
  upsertGoogleVerifiedUser,
  upsertSavedPlace,
  updateDisplayName,
  verifyEmailOtp,
} from "./auth/postgresAuth";
import {
  chargeSavedPlaceCoins,
  completeCoinOnboarding,
  getCoinImpact,
  getCoinLedger,
  getCoinOnboardingState,
  getCoinPricing,
  invalidateCoinImpactCache,
  type CoinSaveSource,
} from "./economy/store";
import { featureFlags } from "./featureFlags";
import { saveAttemptHypothesisSummary } from "./attemptHypothesisStore";
import { buildAttemptHypothesisSummary } from "./intelligence/hypothesisSummary";
import type { IntelligencePipelineResult, StructuredEntity } from "./intelligence/types";
import type { ExtractionResult } from "./extraction/types";
import { canonicalizeUrl } from "./extraction/url";
import { runDatabaseMigrations } from "./db/migrations";
import { getDatabaseHealthReport } from "./db/health";
import { registerStrollRoutes } from "./stroll/routes";
import { strollCurationJobStore } from "./stroll/jobStore";
import { listReadyHeroStrollCandidates, type ReadyHeroStrollCandidate } from "./stroll/store";
import { recordUserPlaceInteraction } from "./stroll/informationFoundation";
import { placeEnrichmentJobStore } from "./placeEnrichment/store";
import {
  bestEffortObservability,
  buildRequestId,
  completeOperationRun,
  createOperationRun,
  isAllowedProductEventType,
  recordFailureEvent,
  recordLocationContext,
  recordProductEvent,
  type LocationContextSource,
  type LocationPermissionStatus,
  type ProductEventOutcome,
} from "./observability/store";

const app = express();
const googleIdTokenClient = new OAuth2Client();

class PublicAuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type VerifiedGoogleProfile = {
  providerId: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
};

function getConfiguredGoogleClientIds() {
  return Array.from(
    new Set(
      [
        process.env.GOOGLE_WEB_CLIENT_ID,
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_ANDROID_CLIENT_ID,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function isVerifiedGoogleIssuer(value: unknown) {
  const issuer = String(value || "").trim();
  return issuer === "accounts.google.com" || issuer === "https://accounts.google.com";
}

function buildGoogleProfile(input: {
  sub?: unknown;
  email?: unknown;
  emailVerified?: unknown;
  name?: unknown;
  picture?: unknown;
}) {
  const providerId = String(input.sub || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  const emailVerified = input.emailVerified === true || input.emailVerified === "true";
  const displayName = typeof input.name === "string" ? input.name.trim() || null : null;
  const avatarUrl = typeof input.picture === "string" ? input.picture.trim() || null : null;

  if (!providerId || !email) {
    throw new PublicAuthError(400, "Google account did not return required profile fields.");
  }
  if (!emailVerified) {
    throw new PublicAuthError(400, "Google email is not verified.");
  }

  return {
    providerId,
    email,
    emailVerified,
    displayName,
    avatarUrl,
  } satisfies VerifiedGoogleProfile;
}

async function verifyGoogleIdToken(idToken: string) {
  const audiences = getConfiguredGoogleClientIds();
  if (!audiences.length) {
    throw new PublicAuthError(503, "Google login is not configured yet.");
  }

  let payload: TokenPayload | undefined;
  try {
    const ticket = await googleIdTokenClient.verifyIdToken({
      idToken,
      audience: audiences,
    });
    payload = ticket.getPayload() ?? undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("audience") || message.includes("recipient")) {
      throw new PublicAuthError(401, "Google token audience mismatch.");
    }
    throw new PublicAuthError(401, "Invalid Google id token.");
  }

  if (!payload) {
    throw new PublicAuthError(401, "Invalid Google id token.");
  }
  if (!isVerifiedGoogleIssuer(payload.iss)) {
    throw new PublicAuthError(401, "Invalid Google id token.");
  }
  if (payload.aud && !audiences.includes(String(payload.aud))) {
    throw new PublicAuthError(401, "Google token audience mismatch.");
  }

  return buildGoogleProfile({
    sub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified,
    name: payload.name,
    picture: payload.picture,
  });
}

async function verifyGoogleAccessToken(accessToken: string) {
  const audiences = getConfiguredGoogleClientIds();
  if (!audiences.length) {
    throw new PublicAuthError(503, "Google login is not configured yet.");
  }

  const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!userInfoResponse.ok) {
    throw new PublicAuthError(401, "Invalid Google access token.");
  }

  const userInfo = (await userInfoResponse.json()) as {
    sub?: string;
    name?: string;
    email?: string;
    picture?: string;
    email_verified?: boolean;
    aud?: string;
  };

  if (userInfo.aud && !audiences.includes(String(userInfo.aud))) {
    throw new PublicAuthError(401, "Google token audience mismatch.");
  }

  return buildGoogleProfile({
    sub: userInfo.sub,
    email: userInfo.email,
    emailVerified: userInfo.email_verified,
    name: userInfo.name,
    picture: userInfo.picture,
  });
}

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
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Request-ID, X-Correlation-ID, X-Client-Platform, X-App-Version");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Vary", "Origin");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const requestId = String(req.headers["x-request-id"] || "").trim() || buildRequestId("api");
  const correlationId = String(req.headers["x-correlation-id"] || "").trim() || requestId;
  (req as express.Request & { observability?: { requestId: string; correlationId: string; startedAt: number } }).observability = {
    requestId,
    correlationId,
    startedAt: Date.now(),
  };
  res.header("X-Request-ID", requestId);
  next();
});

type MetadataExtractionRouteName = "stream" | "non_stream" | "stream_test";
type TrustedEntityEditField = "title" | "category" | "subtitle" | "placeId" | "finalPlaceId" | "lat" | "lng";
type MetadataDuplicateInfo = {
  kind: "link";
  scope: "same_user" | "different_user";
  canonicalUrl: string;
  submittedLinkId: string;
  reused: true;
  costSaved: true;
  reusedRunId: string;
  reusedAttemptNumber: number | null;
  priorStatus: string | null;
};
type SavedPlaceDuplicateInfo = {
  kind: "place";
  scope: "same_user";
  placeId: string;
  existingSavedPlaceId: string;
};

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

function isReusableExtractionResultPayload(
  payload: unknown,
  canonicalUrl: string,
): payload is Awaited<ReturnType<typeof runExtractionPipeline>> {
  if (!payload || typeof payload !== "object") return false;
  const candidateCanonicalUrl = getCanonicalUrlFromSource(payload);
  if (!candidateCanonicalUrl || candidateCanonicalUrl !== canonicalUrl) return false;
  return true;
}

function getDuplicateScopeForMetadataReuse(input: {
  currentUserId?: string | null;
  currentAnonymousId?: string | null;
  priorUserId?: string | null;
  priorAnonymousId?: string | null;
}): "same_user" | "different_user" {
  if (input.currentUserId && input.priorUserId && input.currentUserId === input.priorUserId) {
    return "same_user";
  }
  if (!input.currentUserId && input.currentAnonymousId && input.priorAnonymousId && input.currentAnonymousId === input.priorAnonymousId) {
    return "same_user";
  }
  return "different_user";
}

export async function resolveMetadataDuplicateReuse(input: {
  canonicalUrl: string;
  userId?: string | null;
  anonymousId?: string | null;
}): Promise<{ result: Awaited<ReturnType<typeof runExtractionPipeline>>; duplicate: MetadataDuplicateInfo } | null> {
  const canonicalUrl = String(input.canonicalUrl || "").trim();
  if (!canonicalUrl || !isPostgresConfigured()) return null;
  const reusable = await getLatestReusableMetadataExtractionByCanonicalUrl(canonicalUrl);
  if (!reusable) return null;
  if (!isReusableExtractionResultPayload(reusable.extractionResult, canonicalUrl)) return null;
  return {
    result: reusable.extractionResult,
    duplicate: {
      kind: "link",
      scope: getDuplicateScopeForMetadataReuse({
        currentUserId: input.userId ?? null,
        currentAnonymousId: input.anonymousId ?? null,
        priorUserId: reusable.userId,
        priorAnonymousId: reusable.anonymousId,
      }),
      canonicalUrl,
      submittedLinkId: reusable.submittedLinkId,
      reused: true,
      costSaved: true,
      reusedRunId: reusable.runId,
      reusedAttemptNumber: reusable.attemptNumber,
      priorStatus: reusable.priorStatus,
    },
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

function withMetadataDuplicate<T extends Record<string, unknown>>(payload: T, duplicate?: MetadataDuplicateInfo | null) {
  return duplicate ? { ...payload, duplicate } : payload;
}

function resolveSavedPlaceIdFromRequest(req: express.Request): string {
  const direct = String(req.body?.placeId || req.body?.finalPlaceId || "").trim();
  if (direct) return direct;
  const metadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata as Record<string, unknown> : null;
  const metadataPlaceId = String(metadata?.placeId || metadata?.finalPlaceId || "").trim();
  if (metadataPlaceId) return metadataPlaceId;
  const title = String(req.body?.title || "").trim();
  const locality = String(metadata?.locality || "").trim();
  if (title || locality) {
    return `manual:${createHash("sha1").update(JSON.stringify({ title, locality })).digest("hex").slice(0, 16)}`;
  }
  return "";
}

type HeroCardBase = {
  type: "city_category_insight";
  cardKey: string;
  heroState: "suggestion" | "ready_stroll";
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaAction: string;
  priorityScore: number;
  reasonCodes: string[];
  metadata: Record<string, unknown>;
  readyStrollId?: string;
};

type HeroCardResponse = HeroCardBase & {
  alternatives: HeroCardBase[];
};

type HeroCardSavedPlace = {
  id?: string;
  placeId?: string;
  title?: string;
  category?: string | null;
  metadata?: Record<string, unknown> | null;
};

type HeroCandidateInput = {
  placeId: string;
  title: string | null;
  category: string | null;
  city: string | null;
  locality: string | null;
};

type HeroCardCandidate = HeroCardBase;

function normalizeHeroPlaceIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function readHeroMetadataString(card: HeroCardBase, key: string): string | null {
  return normalizeHeroField(card.metadata?.[key]);
}

function normalizeHeroSemanticToken(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getHeroCategorySemanticTokens(category: string | null | undefined) {
  const normalized = normalizeHeroSemanticToken(category);
  if (normalized === "taste") return new Set(["taste", "food", "foods", "cafe", "cafes", "restaurant", "restaurants", "dining"]);
  if (normalized === "explore") return new Set(["explore", "exploring", "sightseeing", "landmarks", "outdoor"]);
  if (normalized === "activity") return new Set(["activity", "activities", "experience", "experiences", "adventure"]);
  if (normalized === "stay") return new Set(["stay", "stays", "hotel", "hotels", "lodging", "accommodation"]);
  return new Set(normalized ? [normalized] : []);
}

function strollMatchesHeroCategory(candidate: ReadyHeroStrollCandidate, targetCategory: string | null) {
  if (!targetCategory) return true;
  const semanticTokens = getHeroCategorySemanticTokens(targetCategory);
  if (!semanticTokens.size) return true;
  const normalizedStopCategories = candidate.stopCategories.map((value) => normalizeHeroSemanticToken(value));
  const normalizedInterests = candidate.interests.map((value) => normalizeHeroSemanticToken(value));
  return (
    normalizedStopCategories.some((value) => semanticTokens.has(value)) ||
    normalizedInterests.some((value) => semanticTokens.has(value))
  );
}

function strollMatchesHeroAction(candidate: ReadyHeroStrollCandidate, card: HeroCardBase, targetCategory: string | null) {
  if (candidate.source === "onboarding") return false;

  if (card.ctaAction === "build_food_trail") {
    return strollMatchesHeroCategory(candidate, "Taste");
  }
  if (card.ctaAction === "plan_weekend_explore") {
    return strollMatchesHeroCategory(candidate, "Explore");
  }
  if (card.ctaAction === "view_dominant_category" && targetCategory) {
    return strollMatchesHeroCategory(candidate, targetCategory);
  }
  if (card.ctaAction === "view_city_plan" || card.ctaAction === "create_itinerary") {
    return candidate.stopPlaceIds.length >= 2;
  }
  return false;
}

function findMatchingReadyStrollId(
  card: HeroCardBase,
  readyStrollCandidates: ReadyHeroStrollCandidate[],
  userId: string,
) {
  const targetCity = normalizeHeroSemanticToken(readHeroMetadataString(card, "targetCity"));
  const targetCategory = readHeroMetadataString(card, "targetCategory");
  const heroMatchingPlaceIds = normalizeHeroPlaceIdList(card.metadata?.matchingPlaceIds);
  const heroMatchingPlaceIdSet = new Set(heroMatchingPlaceIds);
  const minimumOverlap = heroMatchingPlaceIds.length >= 2 ? 2 : heroMatchingPlaceIds.length;

  const matches = readyStrollCandidates.filter((candidate) => {
    if (candidate.userId !== userId) return false;
    if (!strollMatchesHeroAction(candidate, card, targetCategory)) return false;

    const normalizedCandidateCity = normalizeHeroSemanticToken(candidate.city);
    if (targetCity && normalizedCandidateCity !== targetCity) return false;

    if (heroMatchingPlaceIdSet.size > 0) {
      if (!candidate.stopPlaceIds.length) return false;
      const overlapCount = candidate.stopPlaceIds.filter((placeId) => heroMatchingPlaceIdSet.has(placeId)).length;
      if (overlapCount < minimumOverlap) return false;
      if (candidate.stopPlaceIds.some((placeId) => !heroMatchingPlaceIdSet.has(placeId))) return false;
    }

    if (targetCategory && !strollMatchesHeroCategory(candidate, targetCategory)) return false;

    return true;
  });

  return matches.length === 1 ? matches[0]?.id || null : null;
}

function attachReadyStrollId(
  card: HeroCardCandidate,
  readyStrollCandidates: ReadyHeroStrollCandidate[],
  userId: string,
): HeroCardCandidate {
  const readyStrollId = findMatchingReadyStrollId(card, readyStrollCandidates, userId);
  if (!readyStrollId) return card;
  return {
    ...card,
    readyStrollId,
    heroState: "ready_stroll",
  };
}

function normalizeHeroField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function titleCaseLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  return normalized.slice(0, 1).toUpperCase() + normalized.slice(1);
}

function normalizeHeroComparisonValue(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function isHeroAdminRegionCity(value: string | null | undefined): boolean {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  return /\b(division|district|province|county|region|state|governorate)\s*$/i.test(normalized);
}

function isUsableHeroCity(value: string | null | undefined): value is string {
  return Boolean(normalizeHeroField(value) && !isHeroAdminRegionCity(value));
}

function isVenueLikeHeroLocality(locality: string, title?: string | null): boolean {
  const normalizedLocality = normalizeHeroComparisonValue(locality);
  const normalizedTitle = normalizeHeroComparisonValue(title);
  if (normalizedLocality && normalizedTitle && normalizedLocality === normalizedTitle) {
    return true;
  }
  return /\b(cafe|café|restaurant|kitchen|brew|brewery|bar|lounge|club|bakery|bistro|pub|hotel|resort|villa|mart|house)\b/i.test(locality);
}

function pickHeroTargetLocality(places: HeroCandidateInput[]): string | null {
  const localityCounts = new Map<string, number>();
  const localityLabels = new Map<string, string>();

  for (const place of places) {
    const locality = normalizeHeroField(place.locality);
    if (!locality || isVenueLikeHeroLocality(locality, place.title)) continue;
    const key = locality.toLowerCase();
    localityCounts.set(key, (localityCounts.get(key) || 0) + 1);
    if (!localityLabels.has(key)) {
      localityLabels.set(key, locality);
    }
  }

  const sortedLocalities = [...localityCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const topLocality = sortedLocalities[0];
  if (!topLocality) return null;

  const validLocalityCount = [...localityCounts.values()].reduce((sum, count) => sum + count, 0);
  const topCount = topLocality[1];
  const topShare = validLocalityCount > 0 ? topCount / validLocalityCount : 0;

  if (topCount < 2) return null;
  if (topCount < 3 && topShare < 0.3) return null;

  return localityLabels.get(topLocality[0]) || null;
}

function buildHeroCardKey(input: {
  type: string;
  rule?: string | null;
  ctaAction?: string | null;
  targetCategory?: string | null;
  targetCity?: string | null;
  matchingPlaceIds: string[];
}): string {
  return JSON.stringify({
    type: input.type,
    rule: normalizeHeroField(input.rule) || "",
    ctaAction: normalizeHeroField(input.ctaAction) || "",
    targetCategory: normalizeHeroField(input.targetCategory) || "",
    targetCity: normalizeHeroField(input.targetCity) || "",
    matchingPlaceIds: [...input.matchingPlaceIds].map((item) => String(item || "").trim()).filter(Boolean).sort(),
  });
}

function buildHeroSemanticIdentity(input: {
  targetCategory?: string | null;
  targetCity?: string | null;
  matchingPlaceIds: string[];
}): string {
  return JSON.stringify({
    targetCategory: normalizeHeroField(input.targetCategory) || "",
    targetCity: normalizeHeroField(input.targetCity) || "",
    matchingPlaceIds: [...input.matchingPlaceIds].map((item) => String(item || "").trim()).filter(Boolean).sort(),
  });
}

function buildHeroCardMetadata(input: {
  targetCity?: string | null;
  targetLocality?: string | null;
  targetCategory?: string | null;
  totalSavedPlaces: number;
  matchingPlaceIds: string[];
  queryParams?: Record<string, unknown>;
  reasonCodes: string[];
  priorityScore: number;
  rule: string;
}) {
  return {
    rule: input.rule,
    targetCity: input.targetCity ?? null,
    targetLocality: input.targetLocality ?? null,
    targetCategory: input.targetCategory ?? null,
    totalSavedPlaces: input.totalSavedPlaces,
    matchingPlaceIds: input.matchingPlaceIds,
    queryParams: input.queryParams ?? {},
    reasonCodes: input.reasonCodes,
    priorityScore: input.priorityScore,
  };
}

function buildFallbackHeroCard(totalSaves: number): HeroCardCandidate {
  const priorityScore = totalSaves > 0 ? 10 : 5;
  const reasonCodes = totalSaves > 0 ? ["insufficient_data"] : ["no_saved_places"];
  const metadata = buildHeroCardMetadata({
    totalSavedPlaces: totalSaves,
    matchingPlaceIds: [],
    queryParams: totalSaves > 0 ? { minSavedPlacesNeeded: 3 } : { startSaving: true },
    reasonCodes,
    priorityScore,
    rule: "fallback",
  });
  return {
    type: "city_category_insight",
    heroState: "suggestion",
    cardKey: buildHeroCardKey({
      type: "city_category_insight",
      rule: "fallback",
      ctaAction: totalSaves > 0 ? "grow_saved_places" : "add_first_place",
      targetCategory: null,
      targetCity: null,
      matchingPlaceIds: [],
    }),
    title: totalSaves > 0 ? "Your next Wandreel is taking shape" : "Start building your Wandreel",
    subtitle: totalSaves > 0
      ? "Save a few more places and we will start surfacing smarter city and category insights here."
      : "Save reels, cafes, stays, and spots you love to unlock personalized trip ideas on home.",
    ctaLabel: totalSaves > 0 ? "Save more places" : "Add your first place",
    ctaAction: totalSaves > 0 ? "grow_saved_places" : "add_first_place",
    priorityScore,
    reasonCodes,
    metadata,
  };
}

function buildHeroCardFromSavedPlaces(
  items: HeroCardSavedPlace[],
  readyStrollCandidates: ReadyHeroStrollCandidate[] = [],
  userId: string | null = null,
): HeroCardResponse {
  const totalSaves = items.length;
  if (totalSaves < 3) {
    return {
      ...buildFallbackHeroCard(totalSaves),
      alternatives: [],
    };
  }

  const normalizedPlaces: HeroCandidateInput[] = items.map((item, index) => {
    const metadata = item.metadata && typeof item.metadata === "object"
      ? item.metadata as Record<string, unknown>
      : null;
    const placeId = normalizeHeroField(item.placeId) || normalizeHeroField(item.id) || `saved_place_${index + 1}`;
    return {
      placeId,
      title: normalizeHeroField(item.title),
      category: (() => {
        const rawCategory = normalizeHeroField(item.category);
        return rawCategory ? titleCaseLabel(rawCategory) : null;
      })(),
      city: isUsableHeroCity(normalizeHeroField(metadata?.city)) ? normalizeHeroField(metadata?.city) : null,
      locality: normalizeHeroField(metadata?.locality),
    };
  });

  const categoryToPlaces = new Map<string, HeroCandidateInput[]>();
  const cityToPlaces = new Map<string, HeroCandidateInput[]>();

  for (const place of normalizedPlaces) {
    if (place.category) {
      categoryToPlaces.set(place.category, [...(categoryToPlaces.get(place.category) || []), place]);
    }
    if (place.city) {
      cityToPlaces.set(place.city, [...(cityToPlaces.get(place.city) || []), place]);
    }
  }

  const categoryEntries = [...categoryToPlaces.entries()].sort((a, b) => b[1].length - a[1].length);
  const cityEntries = [...cityToPlaces.entries()].sort((a, b) => b[1].length - a[1].length);
  const topCategoryEntry = categoryEntries[0] || null;
  const topCityEntry = cityEntries[0] || null;
  const topCategory = topCategoryEntry?.[0] || null;
  const topCategoryPlaces = topCategoryEntry?.[1] || [];
  const topCategoryCount = topCategoryPlaces.length;
  const topCity = topCityEntry?.[0] || null;
  const topCityPlaces = topCityEntry?.[1] || [];
  const topCityCount = topCityPlaces.length;
  const topCategoryShare = totalSaves > 0 ? topCategoryCount / totalSaves : 0;
  const topCityShare = totalSaves > 0 ? topCityCount / totalSaves : 0;
  const candidateCards: HeroCardCandidate[] = [];

  const buildCandidate = (input: {
    title: string;
    subtitle: string;
    ctaLabel: string;
    ctaAction: string;
    priorityScore: number;
    reasonCodes: string[];
    targetCity?: string | null;
    targetLocality?: string | null;
    targetCategory?: string | null;
    matchingPlaceIds: string[];
    queryParams: Record<string, unknown>;
    rule: string;
  }): HeroCardCandidate => {
    const metadata = buildHeroCardMetadata({
      targetCity: input.targetCity,
      targetLocality: input.targetLocality,
      targetCategory: input.targetCategory,
      totalSavedPlaces: totalSaves,
      matchingPlaceIds: input.matchingPlaceIds,
      queryParams: input.queryParams,
      reasonCodes: input.reasonCodes,
      priorityScore: input.priorityScore,
      rule: input.rule,
    });
    return {
      type: "city_category_insight",
      heroState: "suggestion",
      cardKey: buildHeroCardKey({
        type: "city_category_insight",
        rule: input.rule,
        ctaAction: input.ctaAction,
        targetCategory: input.targetCategory,
        targetCity: input.targetCity,
        matchingPlaceIds: input.matchingPlaceIds,
      }),
      title: input.title,
      subtitle: input.subtitle,
      ctaLabel: input.ctaLabel,
      ctaAction: input.ctaAction,
      priorityScore: input.priorityScore,
      reasonCodes: input.reasonCodes,
      metadata,
    };
  };

  if (topCategory === "Taste" && topCategoryCount >= 5) {
    const priorityScore = 96 + Math.min(8, Math.floor(topCategoryShare * 10));
    const reasonCodes = ["taste_heavy", "category_specific", "high_confidence"];
    candidateCards.push(buildCandidate({
      title: "Build a food Stroll",
      subtitle: `You have ${topCategoryCount} Taste saves. Bundle them into a calm cafe and food route for your next outing.`,
      ctaLabel: "Build Stroll",
      ctaAction: "build_food_trail",
      priorityScore,
      reasonCodes,
      targetCategory: "Taste",
      targetLocality: pickHeroTargetLocality(topCategoryPlaces),
      matchingPlaceIds: topCategoryPlaces.map((place) => place.placeId),
      queryParams: { category: "Taste", placeIds: topCategoryPlaces.map((place) => place.placeId) },
      rule: "taste_trail",
    }));
  }

  if (topCategory === "Explore" && topCategoryCount >= 5) {
    const priorityScore = 95 + Math.min(8, Math.floor(topCategoryShare * 10));
    const reasonCodes = ["explore_heavy", "category_specific", "high_confidence"];
    candidateCards.push(buildCandidate({
      title: "Plan a weekend Stroll",
      subtitle: `You already saved ${topCategoryCount} Explore spots. That is enough for a packed weekend circuit.`,
      ctaLabel: "Create Stroll",
      ctaAction: "plan_weekend_explore",
      priorityScore,
      reasonCodes,
      targetCategory: "Explore",
      targetLocality: pickHeroTargetLocality(topCategoryPlaces),
      matchingPlaceIds: topCategoryPlaces.map((place) => place.placeId),
      queryParams: { category: "Explore", placeIds: topCategoryPlaces.map((place) => place.placeId) },
      rule: "explore_weekend",
    }));
  }

  if (topCategory && topCategoryCount >= 4 && topCategoryShare >= 0.4) {
    const priorityScore = 80 + Math.min(10, Math.round(topCategoryShare * 20));
    const reasonCodes = ["dominant_category", "category_pattern"];
    candidateCards.push(buildCandidate({
      title: `Create a ${topCategory} Stroll`,
      subtitle: `${topCategoryCount} of your ${totalSaves} saves are in ${topCategory}. You are building a clear travel pattern.`,
      ctaLabel: `Create Stroll`,
      ctaAction: "view_dominant_category",
      priorityScore,
      reasonCodes,
      targetCategory: topCategory,
      targetLocality: pickHeroTargetLocality(topCategoryPlaces),
      matchingPlaceIds: topCategoryPlaces.map((place) => place.placeId),
      queryParams: { category: topCategory, placeIds: topCategoryPlaces.map((place) => place.placeId) },
      rule: "dominant_category",
    }));
  }

  const secondaryCategoryEntry = categoryEntries
    .slice(1)
    .find(([, places]) => places.length >= 5 && (places.length >= 20 || (totalSaves > 0 ? places.length / totalSaves : 0) >= 0.2));
  if (secondaryCategoryEntry) {
    const [secondaryCategory, secondaryCategoryPlaces] = secondaryCategoryEntry;
    const secondaryCategoryCount = secondaryCategoryPlaces.length;
    const secondaryCategoryShare = totalSaves > 0 ? secondaryCategoryCount / totalSaves : 0;
    const matchingPlaceIds = secondaryCategoryPlaces.map((place) => place.placeId);

    if (secondaryCategory === "Taste") {
      const priorityScore = 88 + Math.min(8, Math.round(secondaryCategoryShare * 20));
      const reasonCodes = ["secondary_category", "taste_secondary", "category_specific"];
      candidateCards.push(buildCandidate({
        title: "Build another food Stroll",
        subtitle: `You have ${secondaryCategoryCount} Taste saves lined up for a focused cafe or food run.`,
        ctaLabel: "Build Stroll",
        ctaAction: "build_food_trail",
        priorityScore,
        reasonCodes,
        targetCategory: "Taste",
        targetLocality: pickHeroTargetLocality(secondaryCategoryPlaces),
        matchingPlaceIds,
        queryParams: { category: "Taste", placeIds: matchingPlaceIds },
        rule: "secondary_taste",
      }));
    } else if (secondaryCategory === "Explore") {
      const priorityScore = 87 + Math.min(8, Math.round(secondaryCategoryShare * 20));
      const reasonCodes = ["secondary_category", "explore_secondary", "category_specific"];
      candidateCards.push(buildCandidate({
        title: "Plan another weekend Stroll",
        subtitle: `You already have ${secondaryCategoryCount} Explore saves that could turn into a strong route of their own.`,
        ctaLabel: "Create Stroll",
        ctaAction: "plan_weekend_explore",
        priorityScore,
        reasonCodes,
        targetCategory: "Explore",
        targetLocality: pickHeroTargetLocality(secondaryCategoryPlaces),
        matchingPlaceIds,
        queryParams: { category: "Explore", placeIds: matchingPlaceIds },
        rule: "secondary_explore",
      }));
    } else {
      const priorityScore = 84 + Math.min(8, Math.round(secondaryCategoryShare * 20));
      const reasonCodes = ["secondary_category", "category_pattern"];
      candidateCards.push(buildCandidate({
        title: `Create a ${secondaryCategory} Stroll`,
        subtitle: `${secondaryCategoryCount} of your saves are in ${secondaryCategory}. That is enough to justify its own next step.`,
        ctaLabel: "Create Stroll",
        ctaAction: "view_dominant_category",
        priorityScore,
        reasonCodes,
        targetCategory: secondaryCategory,
        targetLocality: pickHeroTargetLocality(secondaryCategoryPlaces),
        matchingPlaceIds,
        queryParams: { category: secondaryCategory, placeIds: matchingPlaceIds },
        rule: "secondary_category",
      }));
    }
  }

  if (totalSaves >= 12) {
    const priorityScore = 74 + Math.min(16, Math.floor(totalSaves / 4));
    const reasonCodes = ["itinerary_ready", "high_save_volume"];
    candidateCards.push(buildCandidate({
      title: "Create a full itinerary from your saved places",
      subtitle: `With ${totalSaves} saved places across Wandreel, your next trip can move from scattered ideas to a proper plan.`,
      ctaLabel: "Create Stroll",
      ctaAction: "create_itinerary",
      priorityScore,
      reasonCodes,
      matchingPlaceIds: normalizedPlaces.map((place) => place.placeId),
      queryParams: { placeIds: normalizedPlaces.map((place) => place.placeId), totalSavedPlaces: totalSaves },
      rule: "itinerary_ready",
    }));
  }

  if (topCity && topCityCount >= 3 && topCityShare >= 0.45) {
    const priorityScore = 62 + Math.min(18, Math.round(topCityShare * 20));
    const reasonCodes = ["dominant_city", "strong_city_signal"];
    candidateCards.push(buildCandidate({
      title: `${topCity} is clearly your next obsession`,
      subtitle: `${topCityCount} of your saved places are in ${topCity}. Want to turn them into one tight plan?`,
      ctaLabel: "See city plan",
      ctaAction: "view_city_plan",
      priorityScore,
      reasonCodes,
      targetCity: topCity,
      targetLocality: pickHeroTargetLocality(topCityPlaces),
      matchingPlaceIds: topCityPlaces.map((place) => place.placeId),
      queryParams: { city: topCity, placeIds: topCityPlaces.map((place) => place.placeId) },
      rule: "dominant_city",
    }));
  }

  const sortedCandidates = candidateCards
    .sort((a, b) => b.priorityScore - a.priorityScore);
  const baseSelectedCard = sortedCandidates[0] || buildFallbackHeroCard(totalSaves);
  const selectedCard = userId
    ? attachReadyStrollId(baseSelectedCard, readyStrollCandidates, userId)
    : baseSelectedCard;
  const seenCardKeys = new Set<string>([selectedCard.cardKey]);
  const seenSemanticIdentities = new Set<string>([
    buildHeroSemanticIdentity({
      targetCategory: selectedCard.metadata?.targetCategory as string | null | undefined,
      targetCity: selectedCard.metadata?.targetCity as string | null | undefined,
      matchingPlaceIds: Array.isArray(selectedCard.metadata?.matchingPlaceIds) ? selectedCard.metadata.matchingPlaceIds as string[] : [],
    }),
  ]);
  const alternatives: HeroCardCandidate[] = [];

  for (const candidate of sortedCandidates.slice(1)) {
    const semanticIdentity = buildHeroSemanticIdentity({
      targetCategory: candidate.metadata?.targetCategory as string | null | undefined,
      targetCity: candidate.metadata?.targetCity as string | null | undefined,
      matchingPlaceIds: Array.isArray(candidate.metadata?.matchingPlaceIds) ? candidate.metadata.matchingPlaceIds as string[] : [],
    });
    if (seenCardKeys.has(candidate.cardKey) || seenSemanticIdentities.has(semanticIdentity)) {
      continue;
    }
    seenCardKeys.add(candidate.cardKey);
    seenSemanticIdentities.add(semanticIdentity);
    alternatives.push(candidate);
    if (alternatives.length >= 3) break;
  }

  return {
    ...selectedCard,
    alternatives,
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

export async function persistMetadataExtractionArtifacts(
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
    try {
      await updateAttemptPromotedFields({
        attemptId: attemptRecord.attemptId,
        canonicalUrl: getCanonicalUrlFromSource(result),
        stageStatus: result.stageStatus ?? null,
        stageTimingsMs: result.stageTimingsMs ?? null,
        transcriptAttempted: Boolean(result.transcript?.attempted),
        transcriptSucceeded: Boolean(result.transcript?.used),
        ocrAttempted: Boolean(result.ocr?.attempted),
        ocrSucceeded: Boolean(result.ocr?.used),
        visualAttempted: Boolean(result.visualFallback?.attempted),
        visualSucceeded: Boolean(result.visualFallback?.selectedCandidate),
        commentsFetchedCount: result.metadata?.commentEvidence?.commentsFetchedCount ?? null,
        commentRepliesFetchedCount: result.metadata?.commentEvidence?.commentRepliesFetchedCount ?? null,
        creatorReplyCount: result.metadata?.commentEvidence?.creatorReplyCount ?? null,
      });
    } catch (promotedError) {
      console.error("persist extraction promoted fields failed", promotedError);
    }
    try {
      const stageRows = buildAttemptStageRowsFromExtraction(result);
      if (stageRows.length > 0) {
        await upsertAttemptStageRuns({
          runId: attemptRecord.runId,
          attemptId: attemptRecord.attemptId,
          attemptNumber: getAttemptNumberFromSource(result),
          stages: stageRows,
        });
      }
    } catch (stageError) {
      console.error("persist extraction stage runs failed", stageError);
    }
    try {
      const evidenceRows = buildAttemptEvidenceRowsFromExtraction(result);
      if (evidenceRows.length > 0) {
        await upsertAttemptEvidence({
          runId: attemptRecord.runId,
          attemptId: attemptRecord.attemptId,
          attemptNumber: getAttemptNumberFromSource(result),
          evidence: evidenceRows,
        });
      }
    } catch (evidenceError) {
      console.error("persist extraction evidence failed", evidenceError);
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

function getAdminEmails() {
  return new Set(
    String(process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const user = await resolveSessionUser(req);
    if (!user) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    const email = String(user.email || "").trim().toLowerCase();
    if (!email || !getAdminEmails().has(email)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    (req as express.Request & { authUser?: NonNullable<typeof user> }).authUser = user;
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    return res.status(403).json({ ok: false, error: message });
  }
}

if (isPostgresConfigured() && process.env.NODE_ENV !== "test") {
  runDatabaseMigrations()
    .then(async () => {
      await strollCurationJobStore.recoverStaleJobs();
      await placeEnrichmentJobStore.recoverStaleJobs();
      if (process.env.PLACE_ENRICHMENT_WORKER_DISABLED !== "1") {
        placeEnrichmentJobStore.start();
      }
    })
    .catch((error) => {
      console.error("postgres migration bootstrap failed", error);
    });
}

function getRequestObservability(req: express.Request) {
  return (req as express.Request & { observability?: { requestId: string; correlationId: string; startedAt: number } }).observability;
}

function getAuthSessionId(req: express.Request) {
  const user = (req as express.Request & { authUser?: { sessionId?: string | null } }).authUser;
  return user?.sessionId ?? null;
}

function getAuthUserId(req: express.Request) {
  const user = (req as express.Request & { authUser?: { userId?: string | null } }).authUser;
  return user?.userId ?? null;
}

function getClientSessionHints(req: express.Request) {
  return {
    clientPlatform: String(req.headers["x-client-platform"] || "").trim() || null,
    appVersion: String(req.headers["x-app-version"] || "").trim() || null,
    deviceMetadata: {
      userAgentFamily: String(req.headers["user-agent"] || "").slice(0, 80),
    },
  };
}

function elapsedFromRequest(req: express.Request) {
  const startedAt = getRequestObservability(req)?.startedAt ?? Date.now();
  return getElapsedMs(startedAt);
}

async function recordRequestFailure(req: express.Request, input: {
  scope: "customer" | "system" | "provider" | "background_job" | "financial";
  severity?: "info" | "warning" | "error" | "critical";
  errorCode: string;
  errorCategory?: string | null;
  publicMessage?: string | null;
  internalMessage?: string | null;
  httpStatus?: number | null;
  operationRunId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  retryable?: boolean | null;
  attemptNumber?: number | null;
  metadata?: Record<string, unknown> | null;
}) {
  if (!isPostgresConfigured()) return;
  const obs = getRequestObservability(req);
  await recordFailureEvent(getPostgresDatabase(), {
    scope: input.scope,
    severity: input.severity ?? "error",
    errorCode: input.errorCode,
    errorCategory: input.errorCategory,
    userId: getAuthUserId(req),
    sessionId: getAuthSessionId(req),
    requestId: obs?.requestId ?? null,
    correlationId: obs?.correlationId ?? null,
    operationRunId: input.operationRunId,
    entityType: input.entityType,
    entityId: input.entityId,
    httpStatus: input.httpStatus,
    publicMessage: input.publicMessage,
    internalMessage: input.internalMessage,
    retryable: input.retryable,
    attemptNumber: input.attemptNumber,
    metadata: input.metadata,
  });
}

registerStrollRoutes(app, { requireAuth });

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

app.post("/api/metadata/extract", optionalAuth, async (req, res) => {
  const { url, mode, debug, attemptNumber, triggerType, clientRunId } = parseExtractionRequest(req);
  const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
  const requestObs = getRequestObservability(req);
  let operationRunId: string | null = null;
  try {
    if (!url) {
      return res.status(400).json({ ok: false, error: "url is required" });
    }
    const canonicalUrl = canonicalizeUrl(url);
    operationRunId = await createOperationRun(getPostgresDatabase(), {
      operationType: "add_extraction",
      userId: authUser?.userId ?? null,
      sessionId: getAuthSessionId(req),
      requestId: requestObs?.requestId ?? null,
      correlationId: clientRunId ?? requestObs?.correlationId ?? null,
      entityType: "submitted_link",
      entityId: buildMetadataUrlHash(canonicalUrl),
      attemptCount: attemptNumber,
      inputSummary: {
        route: "non_stream",
        mode,
        triggerType,
        urlHash: buildMetadataUrlHash(canonicalUrl),
      },
    }).catch(() => null);
    await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
      eventType: "extraction_started",
      userId: authUser?.userId ?? null,
      sessionId: getAuthSessionId(req),
      anonymousId: req.body?.analytics?.anonymousId ? String(req.body.analytics.anonymousId).trim() : null,
      requestId: requestObs?.requestId ?? null,
      operationRunId,
      entityType: "submitted_link",
      entityId: buildMetadataUrlHash(canonicalUrl),
      sourceSurface: "add",
      outcome: "started",
      metadata: { route: "non_stream", mode, attemptNumber, triggerType },
    }));
    const duplicateReuse = await resolveMetadataDuplicateReuse({
      canonicalUrl,
      userId: authUser?.userId ?? null,
      anonymousId: req.body?.analytics?.anonymousId ? String(req.body.analytics.anonymousId).trim() : null,
    });
    if (duplicateReuse) {
      console.info("[metadata-extraction]", {
        event: "reuse_duplicate_link",
        clientRunId,
        canonicalUrl,
        duplicate: duplicateReuse.duplicate,
      });
      await persistMetadataExtractionArtifacts(req, duplicateReuse.result);
      const completedOperationRunId = operationRunId;
      if (completedOperationRunId) {
        await bestEffortObservability(() => completeOperationRun(getPostgresDatabase(), {
          operationRunId: completedOperationRunId,
          status: "succeeded",
          outputSummary: { reused: true, duplicateKind: duplicateReuse.duplicate.kind },
        }));
      }
      await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
        eventType: "extraction_succeeded",
        userId: authUser?.userId ?? null,
        sessionId: getAuthSessionId(req),
        anonymousId: req.body?.analytics?.anonymousId ? String(req.body.analytics.anonymousId).trim() : null,
        requestId: requestObs?.requestId ?? null,
        operationRunId,
        entityType: "submitted_link",
        entityId: buildMetadataUrlHash(canonicalUrl),
        sourceSurface: "add",
        outcome: "succeeded",
        durationMs: elapsedFromRequest(req),
        metadata: { reused: true },
      }));
      if (featureFlags.extractionV2) {
        return res.json(withMetadataDuplicate({ ok: true, ...duplicateReuse.result }, duplicateReuse.duplicate));
      }
      const { source, platform, canonicalUrl: reusedCanonicalUrl, stageStatus, stages, stageTimingsMs, stageFailures, sla, ...legacy } = duplicateReuse.result;
      return res.json(withMetadataDuplicate({ ok: true, ...legacy }, duplicateReuse.duplicate));
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
    const completedOperationRunId = operationRunId;
    if (completedOperationRunId) {
      await bestEffortObservability(() => completeOperationRun(getPostgresDatabase(), {
        operationRunId: completedOperationRunId,
        status: "succeeded",
        outputSummary: {
          reused: false,
          totalMs: result.perf?.totalMs ?? result.sla?.totalMs ?? null,
        },
      }));
    }
    await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
      eventType: "extraction_succeeded",
      userId: authUser?.userId ?? null,
      sessionId: getAuthSessionId(req),
      anonymousId: req.body?.analytics?.anonymousId ? String(req.body.analytics.anonymousId).trim() : null,
      requestId: requestObs?.requestId ?? null,
      operationRunId,
      entityType: "submitted_link",
      entityId: buildMetadataUrlHash(canonicalUrl),
      sourceSurface: "add",
      outcome: "succeeded",
      durationMs: elapsedFromRequest(req),
      metadata: { reused: false, attemptNumber, triggerType },
    }));
    if (featureFlags.extractionV2) {
      return res.json({ ok: true, ...result });
    }
    const { source, platform, canonicalUrl: resultCanonicalUrl, stageStatus, stages, stageTimingsMs, stageFailures, sla, ...legacy } = result;
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
    const failedOperationRunId = operationRunId;
    if (failedOperationRunId) {
      await bestEffortObservability(() => completeOperationRun(getPostgresDatabase(), {
        operationRunId: failedOperationRunId,
        status: "failed",
        outputSummary: { errorName, errorCode: "extraction_failed" },
      }));
    }
    await bestEffortObservability(() => recordRequestFailure(req, {
      scope: "customer",
      errorCode: "extraction_failed",
      errorCategory: "add_extraction",
      publicMessage: "extraction failed",
      internalMessage: message,
      httpStatus: 500,
      operationRunId,
      retryable: true,
      attemptNumber,
      metadata: { route: "non_stream", mode, triggerType, urlHash: url ? buildMetadataUrlHash(url) : null },
    }));
    await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
      eventType: "extraction_failed",
      userId: authUser?.userId ?? null,
      sessionId: getAuthSessionId(req),
      anonymousId: req.body?.analytics?.anonymousId ? String(req.body.analytics.anonymousId).trim() : null,
      requestId: requestObs?.requestId ?? null,
      operationRunId,
      sourceSurface: "add",
      outcome: "failed",
      durationMs: elapsedFromRequest(req),
      metadata: { errorCode: "extraction_failed", attemptNumber, triggerType },
    }));
    return res.status(500).json({
      ok: false,
      ...diagnostics,
    });
  }
});

app.post("/api/metadata/extract/stream-test", optionalAuth, async (req, res) => {
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
    const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
    const canonicalUrl = canonicalizeUrl(url);
    const duplicateReuse = await resolveMetadataDuplicateReuse({
      canonicalUrl,
      userId: authUser?.userId ?? null,
      anonymousId: req.body?.analytics?.anonymousId ? String(req.body.analytics.anonymousId).trim() : null,
    });
    if (duplicateReuse) {
      await persistMetadataExtractionArtifacts(req, duplicateReuse.result);
      sse.writeEvent("completed", {
        stage: "completed",
        message: "Extraction reused from cached analysis.",
        elapsedMs: getElapsedMs(startedAt),
        attemptNumber,
        result: withMetadataDuplicate({ ok: true, ...duplicateReuse.result }, duplicateReuse.duplicate),
      });
      sse.end();
      return;
    }
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

app.post("/api/metadata/extract/stream", optionalAuth, async (req, res) => {
  const { url, mode, debug, attemptNumber, triggerType, clientRunId } = parseExtractionRequest(req);
  if (!url) {
    return res.status(400).json({ ok: false, error: "url is required" });
  }

  const startedAt = Date.now();
  const requestObs = getRequestObservability(req);
  const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
  const canonicalUrl = canonicalizeUrl(url);
  const urlHash = buildMetadataUrlHash(canonicalUrl);
  let operationRunId: string | null = await createOperationRun(getPostgresDatabase(), {
    operationType: "add_extraction",
    userId: authUser?.userId ?? null,
    sessionId: getAuthSessionId(req),
    requestId: requestObs?.requestId ?? null,
    correlationId: clientRunId ?? requestObs?.correlationId ?? null,
    entityType: "submitted_link",
    entityId: urlHash,
    attemptCount: attemptNumber,
    inputSummary: { route: "stream", mode, triggerType, urlHash },
  }).catch(() => null);
  await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
    eventType: "extraction_started",
    userId: authUser?.userId ?? null,
    sessionId: getAuthSessionId(req),
    anonymousId: req.body?.analytics?.anonymousId ? String(req.body.analytics.anonymousId).trim() : null,
    requestId: requestObs?.requestId ?? null,
    operationRunId,
    entityType: "submitted_link",
    entityId: urlHash,
    sourceSurface: "add",
    outcome: "started",
    metadata: { route: "stream", mode, attemptNumber, triggerType },
  }));
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
    const duplicateReuse = await resolveMetadataDuplicateReuse({
      canonicalUrl,
      userId: authUser?.userId ?? null,
      anonymousId: req.body?.analytics?.anonymousId ? String(req.body.analytics.anonymousId).trim() : null,
    });
    if (duplicateReuse) {
      if (operationRunId) {
        await bestEffortObservability(() => completeOperationRun(getPostgresDatabase(), {
          operationRunId,
          status: "succeeded",
          outputSummary: { reused: true, duplicateKind: duplicateReuse.duplicate.kind },
        }));
      }
      await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
        eventType: "extraction_succeeded",
        userId: authUser?.userId ?? null,
        sessionId: getAuthSessionId(req),
        anonymousId: req.body?.analytics?.anonymousId ? String(req.body.analytics.anonymousId).trim() : null,
        requestId: requestObs?.requestId ?? null,
        operationRunId,
        entityType: "submitted_link",
        entityId: urlHash,
        sourceSurface: "add",
        outcome: "succeeded",
        durationMs: getElapsedMs(startedAt),
        metadata: { reused: true, route: "stream" },
      }));
      writeProgressEvent("completed", {
        stage: "completed",
        message: "Extraction reused from cached analysis.",
        elapsedMs: getElapsedMs(startedAt),
        attemptNumber,
        result: withMetadataDuplicate({ ok: true, ...duplicateReuse.result }, duplicateReuse.duplicate),
      });
      clearHeartbeat();
      sse.end();
      void persistMetadataExtractionArtifacts(req, duplicateReuse.result);
      return;
    }
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
    const completedStreamOperationRunId = operationRunId;
    if (completedStreamOperationRunId) {
      await bestEffortObservability(() => completeOperationRun(getPostgresDatabase(), {
        operationRunId: completedStreamOperationRunId,
        status: "succeeded",
        outputSummary: {
          reused: false,
          totalMs: result.perf?.totalMs ?? result.sla?.totalMs ?? null,
        },
      }));
    }
    await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
      eventType: "extraction_succeeded",
      userId: authUser?.userId ?? null,
      sessionId: getAuthSessionId(req),
      anonymousId: req.body?.analytics?.anonymousId ? String(req.body.analytics.anonymousId).trim() : null,
      requestId: requestObs?.requestId ?? null,
      operationRunId,
      entityType: "submitted_link",
      entityId: urlHash,
      sourceSurface: "add",
      outcome: "succeeded",
      durationMs: getElapsedMs(startedAt),
      metadata: { reused: false, route: "stream", attemptNumber, triggerType },
    }));
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
    const failedStreamOperationRunId = operationRunId;
    if (failedStreamOperationRunId) {
      await bestEffortObservability(() => completeOperationRun(getPostgresDatabase(), {
        operationRunId: failedStreamOperationRunId,
        status: "failed",
        outputSummary: { errorName, errorCode: "extraction_failed" },
      }));
    }
    await bestEffortObservability(() => recordRequestFailure(req, {
      scope: "customer",
      errorCode: "extraction_failed",
      errorCategory: "add_extraction",
      publicMessage: "extraction failed",
      internalMessage: message,
      httpStatus: 500,
      operationRunId,
      retryable: true,
      attemptNumber,
      metadata: { route: "stream", mode, triggerType, urlHash },
    }));
    await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
      eventType: "extraction_failed",
      userId: authUser?.userId ?? null,
      sessionId: getAuthSessionId(req),
      anonymousId: req.body?.analytics?.anonymousId ? String(req.body.analytics.anonymousId).trim() : null,
      requestId: requestObs?.requestId ?? null,
      operationRunId,
      entityType: "submitted_link",
      entityId: urlHash,
      sourceSurface: "add",
      outcome: "failed",
      durationMs: getElapsedMs(startedAt),
      metadata: { errorCode: "extraction_failed", route: "stream", attemptNumber, triggerType },
    }));
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

export async function createAnalyticsAttemptFromRequest(
  req: express.Request,
  source: any,
) {
  if (!isPostgresConfigured()) return null;
  const analyticsPayload = req.body?.analytics && typeof req.body.analytics === "object" ? req.body.analytics : null;
  if (!analyticsPayload?.clientRunId) return null;
  const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
  const canonicalUrl = getCanonicalUrlFromSource(source);
  const sourcePlatform = getSourcePlatformFromSource(source);
  try {
    const attemptRecord = await createReelAnalyticsAttempt({
      clientRunId: String(analyticsPayload.clientRunId),
      userId: authUser?.userId ?? null,
      anonymousId: analyticsPayload?.anonymousId ? String(analyticsPayload.anonymousId) : null,
      sourceUrl: canonicalUrl || String(source?.metadata?.sourceUrl || source?.source || ""),
      sourcePlatform,
      attemptNumber: Number(analyticsPayload?.attemptNumber) || 1,
      triggerType: analyticsPayload?.triggerType === "retry" ? "retry" : "initial",
    });
    if (!attemptRecord) return null;
    if (canonicalUrl) {
      try {
        const submittedLink = await upsertSubmittedLink({
          canonicalUrl,
          canonicalUrlHash: buildMetadataUrlHash(canonicalUrl),
          sourcePlatform,
          latestTitle: typeof source?.metadata?.title === "string" ? source.metadata.title : null,
          latestDescription: typeof source?.metadata?.description === "string" ? source.metadata.description : null,
          latestImageUrl: typeof source?.metadata?.imageUrl === "string" ? source.metadata.imageUrl : null,
        });
        if (submittedLink?.id) {
          await linkRunToSubmittedLink({
            runId: attemptRecord.runId,
            submittedLinkId: submittedLink.id,
            canonicalUrl,
          });
        }
        await updateAttemptPromotedFields({
          attemptId: attemptRecord.attemptId,
          canonicalUrl,
        });
      } catch (observabilityError) {
        console.error("create analytics attempt observability setup failed", observabilityError);
      }
    }
    return attemptRecord;
  } catch (attemptError) {
    console.error("create analytics attempt failed", attemptError);
    return null;
  }
}

export function getCanonicalUrlFromSource(source: any): string | null {
  const raw = source?.canonicalUrl || source?.metadata?.canonicalUrl || source?.metadata?.sourceUrl || source?.source || "";
  const normalized = String(raw || "").trim();
  return normalized || null;
}

export function getSourcePlatformFromSource(source: any): string | null {
  const platform = source?.platform || source?.metadata?.platform || null;
  return typeof platform === "string" && platform.trim() ? platform.trim() : null;
}

export function getAttemptNumberFromSource(source: any): number {
  return Number(source?.attemptInfo?.attemptNumber ?? source?.debug?.orchestration?.attemptNumber ?? 1) || 1;
}

export function buildAttemptStageRowsFromExtraction(result: ExtractionResult): Array<{
  stageKey: string;
  status?: string | null;
  provider?: string | null;
  reason?: string | null;
  latencyMs?: number | null;
  chars?: number | null;
  metadataJson?: Record<string, unknown> | null;
}> {
  const stages: Partial<Record<string, { status?: string | null; provider?: string | null; reason?: string | null; chars?: number | null }>> = result.stages || {};
  const stageTimings = result.stageTimingsMs || {};
  return Object.entries(stages).map(([stageKey, stage]) => ({
    stageKey,
    status: stage?.status ?? null,
    provider: stage?.provider ?? null,
    reason: stage?.reason ?? null,
    latencyMs: typeof stageTimings[stageKey as keyof typeof stageTimings] === "number"
      ? Number(stageTimings[stageKey as keyof typeof stageTimings])
      : null,
    chars: typeof stage?.chars === "number" ? stage.chars : null,
    metadataJson: {
      source: "extraction_result",
    },
  }));
}

export function buildAttemptEvidenceRowsFromExtraction(result: ExtractionResult): Array<{
  evidenceType: string;
  position?: number | null;
  summaryText?: string | null;
  sourceRef?: string | null;
  metricsJson?: Record<string, unknown> | null;
  rawJson?: Record<string, unknown> | null;
}> {
  const evidence: Array<{
    evidenceType: string;
    position?: number | null;
    summaryText?: string | null;
    sourceRef?: string | null;
    metricsJson?: Record<string, unknown> | null;
    rawJson?: Record<string, unknown> | null;
  }> = [];
  const commentEvidence = result.metadata?.commentEvidence;
  if (commentEvidence?.attempted) {
    evidence.push({
      evidenceType: "comments",
      position: 0,
      summaryText: commentEvidence.pinnedComment || commentEvidence.creatorReplies?.[0] || commentEvidence.topComments?.[0] || null,
      sourceRef: commentEvidence.provider || null,
      metricsJson: {
        commentsFetchedCount: commentEvidence.commentsFetchedCount ?? 0,
        commentRepliesFetchedCount: commentEvidence.commentRepliesFetchedCount ?? 0,
        creatorReplyCount: commentEvidence.creatorReplyCount ?? 0,
        timedOut: Boolean(commentEvidence.timedOut),
      },
      rawJson: {
        reason: commentEvidence.reason ?? null,
        pinnedComment: commentEvidence.pinnedComment ?? null,
        topCommentCount: Array.isArray(commentEvidence.topComments) ? commentEvidence.topComments.length : 0,
      },
    });
  }
  if (result.transcript?.attempted) {
    evidence.push({
      evidenceType: "transcript",
      position: 0,
      summaryText: String(result.transcript.text || "").trim().slice(0, 240) || null,
      sourceRef: result.transcript.source || null,
      metricsJson: {
        attempted: Boolean(result.transcript.attempted),
        succeeded: Boolean(result.transcript.used),
        chars: String(result.transcript.text || "").trim().length,
      },
      rawJson: {
        reason: result.transcript.reason ?? null,
      },
    });
  }
  if (result.ocr?.attempted) {
    evidence.push({
      evidenceType: "ocr",
      position: 0,
      summaryText: String(result.ocr.text || "").trim().slice(0, 240) || null,
      sourceRef: "frame_ocr",
      metricsJson: {
        attempted: Boolean(result.ocr.attempted),
        succeeded: Boolean(result.ocr.used),
        chars: String(result.ocr.text || "").trim().length,
      },
      rawJson: {
        reason: result.ocr.reason ?? null,
      },
    });
  }
  if (result.visualFallback?.attempted) {
    evidence.push({
      evidenceType: "visual",
      position: 0,
      summaryText: result.visualFallback.summaryText || result.visualFallback.selectedCandidate?.candidateName || null,
      sourceRef: result.visualFallback.provider || null,
      metricsJson: {
        attempted: Boolean(result.visualFallback.attempted),
        selectedCandidate: Boolean(result.visualFallback.selectedCandidate),
        candidateCount: Array.isArray(result.visualFallback.candidates) ? result.visualFallback.candidates.length : 0,
      },
      rawJson: {
        reason: result.visualFallback.reason ?? null,
        selectedCandidateName: result.visualFallback.selectedCandidate?.candidateName ?? null,
        selectedCandidatePlaceId: result.visualFallback.selectedCandidate?.placeId ?? null,
      },
    });
  }
  return evidence;
}

export function getAcceptedAfterFromSource(source: any): string | null {
  const acceptedAfter = source?.debug?.orchestration?.acceptedAfter;
  return typeof acceptedAfter === "string" && acceptedAfter.trim() ? acceptedAfter.trim() : null;
}

export function getRouteFromSource(source: any): string | null {
  const route = source?.debug?.orchestration?.route;
  return typeof route === "string" && route.trim() ? route.trim() : null;
}

export function getFinalSelectedPlaceIdFromIntelligenceResult(result: IntelligencePipelineResult): string | null {
  const entities = Array.isArray(result.output?.structuredEntities) ? result.output.structuredEntities : [];
  if (entities.length !== 1) return null;
  const entity = entities[0] as StructuredEntity | undefined;
  return entity?.placeId && String(entity.placeId).trim() ? String(entity.placeId).trim() : null;
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
  const result = fastPath.result as IntelligencePipelineResult;
  const sanitized = sanitizeIntelligenceOutputEntityNames(result.output);
  for (const event of sanitized.events) {
    console.info("[draft-async]", event);
  }
  return sanitized.events.length > 0
    ? {
        ...result,
        output: sanitized.output,
      }
    : result;
}

function normalizeEntityEditScalarValue(field: TrustedEntityEditField, value: unknown): string | number | null {
  if (field === "lat" || field === "lng") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function parseTrustedEntityEditDiffs(payload: unknown): Array<{ fieldName: TrustedEntityEditField; beforeValue: string | number | null; afterValue: string | number | null }> {
  if (!payload || typeof payload !== "object") return [];
  const rawDiffs: unknown[] = Array.isArray((payload as Record<string, unknown>).editDiffs)
    ? (payload as Record<string, unknown>).editDiffs as unknown[]
    : [];
  const allowedFields = new Set<TrustedEntityEditField>(["title", "category", "subtitle", "placeId", "finalPlaceId", "lat", "lng"]);
  const diffs: Array<{ fieldName: TrustedEntityEditField; beforeValue: string | number | null; afterValue: string | number | null }> = [];

  for (const item of rawDiffs) {
    if (!item || typeof item !== "object") continue;
    const fieldName = String((item as Record<string, unknown>).field || "").trim() as TrustedEntityEditField;
    if (!allowedFields.has(fieldName)) continue;
    const beforeValue = normalizeEntityEditScalarValue(fieldName, (item as Record<string, unknown>).before);
    const afterValue = normalizeEntityEditScalarValue(fieldName, (item as Record<string, unknown>).after);
    if (beforeValue === afterValue) continue;
    diffs.push({ fieldName, beforeValue, afterValue });
  }

  return diffs;
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
      const draftOutput = sanitizeIntelligenceOutputEntityNames(buildDraftIntelligenceOutput(source));
      for (const event of draftOutput.events) {
        console.info("[draft-async]", event);
      }
      console.info("[draft-async]", {
        event: "draft_output",
        clientRunId: analyticsPayload?.clientRunId ? String(analyticsPayload.clientRunId) : null,
        attemptNumber: Number(analyticsPayload?.attemptNumber) || 1,
        acceptedAfter: String(source?.debug?.orchestration?.acceptedAfter || ""),
        ocrChars: String(source?.ocr?.text || "").trim().length,
        entityCount: Array.isArray(draftOutput.output.structuredEntities) ? draftOutput.output.structuredEntities.length : 0,
        entities: (draftOutput.output.structuredEntities || []).map((entity) => ({
          name: entity.name,
          category: entity.category,
          locality: entity.locality,
          confidence: entity.confidence,
        })),
        status: draftOutput.output.status,
      });
      return res.status(202).json({
        ok: true,
        mode,
        draft: true,
        output: draftOutput.output,
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
      const draftOutput = sanitizeIntelligenceOutputEntityNames(buildDraftIntelligenceOutput(source));
      for (const event of draftOutput.events) {
        console.info("[draft-output]", event);
      }
      return res.json({
        ok: true,
        mode,
        output: draftOutput.output,
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
        await updateAttemptPromotedFields({
          attemptId: attemptRecord.attemptId,
          canonicalUrl: getCanonicalUrlFromSource(source),
          acceptedAfter: getAcceptedAfterFromSource(source),
          route: getRouteFromSource(source),
        });
      } catch (attemptPromotedError) {
        console.error("persist intelligence promoted fields failed", attemptPromotedError);
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
      try {
        const finalSelectedPlaceId = getFinalSelectedPlaceIdFromIntelligenceResult(result);
        if (finalSelectedPlaceId) {
          await updateRunFinalOutcome({
            runId: attemptRecord.runId,
            finalSelectedPlaceId,
          });
        }
      } catch (runOutcomeError) {
        console.error("persist intelligence run final selected place failed", runOutcomeError);
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
        try {
          await updateRunFinalOutcome({
            runId,
            finalUserAction: eventName as "saved" | "edited" | "discarded",
            finalSelectedPlaceId: req.body?.finalPlaceId ? String(req.body.finalPlaceId).trim() : null,
          });
        } catch (runOutcomeError) {
          console.error("update analytics run final outcome failed", runOutcomeError);
        }
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
        if (eventName === "edited") {
          try {
            const trustedDiffs = parseTrustedEntityEditDiffs(req.body?.payload);
            if (trustedDiffs.length > 0) {
              await insertEntityFieldEdits({
                edits: trustedDiffs.map((diff) => ({
                  runId,
                  attemptNumber: Number(req.body?.attemptNumber) || 1,
                  entityId: req.body?.entityId ? String(req.body.entityId).trim() : null,
                  entityIndex: Number.isFinite(Number(req.body?.entityIndex)) ? Number(req.body.entityIndex) : payloadEntityIndex,
                  fieldName: diff.fieldName,
                  beforeValue: diff.beforeValue,
                  afterValue: diff.afterValue,
                  editedByUserId: authUser?.userId ?? null,
                })),
              });
            }
          } catch (fieldEditError) {
            console.error("insert entity field edits failed", fieldEditError);
          }
        }
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

app.post("/api/analytics/app-event", optionalAuth, async (req, res) => {
  try {
    if (!isPostgresConfigured()) {
      return res.status(204).end();
    }
    const eventType = String(req.body?.eventType || "").trim();
    if (!isAllowedProductEventType(eventType)) {
      return res.status(400).json({ ok: false, error: "Invalid event_type" });
    }
    const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
    const anonymousId = req.body?.anonymousId ? String(req.body.anonymousId).trim() : null;
    const outcomeRaw = String(req.body?.outcome || "").trim();
    const outcome: ProductEventOutcome | null =
      outcomeRaw === "started" ||
      outcomeRaw === "succeeded" ||
      outcomeRaw === "failed" ||
      outcomeRaw === "cancelled" ||
      outcomeRaw === "viewed"
        ? outcomeRaw
        : null;
    const obs = getRequestObservability(req);
    try {
      await recordProductEvent(getPostgresDatabase(), {
        eventType,
        userId: authUser?.userId ?? null,
        sessionId: getAuthSessionId(req),
        anonymousId,
        requestId: typeof req.body?.requestId === "string" ? req.body.requestId : obs?.requestId ?? null,
        operationRunId: typeof req.body?.operationRunId === "string" ? req.body.operationRunId : null,
        entityType: typeof req.body?.entityType === "string" ? req.body.entityType : null,
        entityId: typeof req.body?.entityId === "string" ? req.body.entityId : null,
        routeName: typeof req.body?.routeName === "string" ? req.body.routeName : null,
        sourceSurface: typeof req.body?.sourceSurface === "string" ? req.body.sourceSurface : null,
        outcome,
        durationMs: Number.isSafeInteger(Number(req.body?.durationMs)) ? Number(req.body.durationMs) : null,
        locationContextId: typeof req.body?.locationContextId === "string" ? req.body.locationContextId : null,
        metadata: req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : null,
      });
      return res.status(200).json({ ok: true, recorded: true });
    } catch (recordError) {
      console.error("record app usage event failed", recordError);
      return res.status(200).json({ ok: true, recorded: false });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record app usage event";
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
  const requestObs = getRequestObservability(req);
  await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
    eventType: "login_started",
    anonymousId: req.body?.anonymousId ? String(req.body.anonymousId) : null,
    requestId: requestObs?.requestId ?? null,
    sourceSurface: "google",
    outcome: "started",
  }));
  try {
    if (!isPostgresConfigured()) {
      return res.status(503).json({ ok: false, error: "Auth database is not configured." });
    }

    const idToken = String(req.body?.idToken || "").trim();
    const accessToken = String(req.body?.accessToken || "").trim();
    if (!idToken && !accessToken) {
      return res.status(400).json({ ok: false, error: "idToken or accessToken is required" });
    }

    const googleProfile = idToken
      ? await verifyGoogleIdToken(idToken)
      : await verifyGoogleAccessToken(accessToken);

    const user = await upsertGoogleVerifiedUser({
      email: googleProfile.email,
      emailVerified: googleProfile.emailVerified,
      displayName: googleProfile.displayName,
      avatarUrl: googleProfile.avatarUrl,
      providerId: googleProfile.providerId,
    });
    const session = await createSession(user.userId, getClientSessionHints(req));
    res.setHeader("Set-Cookie", buildSessionCookie(session.rawToken));
    await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
      eventType: "login_succeeded",
      userId: user.userId,
      sessionId: session.sessionId,
      requestId: requestObs?.requestId ?? null,
      sourceSurface: "google",
      outcome: "succeeded",
      durationMs: elapsedFromRequest(req),
    }));

    return res.json({
      ok: true,
      user,
    });
  } catch (error) {
    await bestEffortObservability(() => recordRequestFailure(req, {
      scope: "customer",
      errorCode: "login_failed",
      errorCategory: "auth",
      publicMessage: error instanceof PublicAuthError ? error.message : "Google authentication failed.",
      internalMessage: error instanceof Error ? error.message : String(error),
      httpStatus: error instanceof PublicAuthError ? error.status : 500,
    }));
    await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
      eventType: "login_failed",
      anonymousId: req.body?.anonymousId ? String(req.body.anonymousId) : null,
      requestId: requestObs?.requestId ?? null,
      sourceSurface: "google",
      outcome: "failed",
      durationMs: elapsedFromRequest(req),
    }));
    if (error instanceof PublicAuthError) {
      return res.status(error.status).json({ ok: false, error: error.message });
    }
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
  const requestObs = getRequestObservability(req);
  await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
    eventType: "login_started",
    anonymousId: req.body?.anonymousId ? String(req.body.anonymousId) : null,
    requestId: requestObs?.requestId ?? null,
    sourceSurface: "email",
    outcome: "started",
  }));
  try {
    if (!isPostgresConfigured()) {
      return res.status(503).json({ ok: false, error: "Auth database is not configured." });
    }
    const email = String(req.body?.email || "").trim();
    const otp = String(req.body?.otp || "").trim();
    const displayName = req.body?.displayName ? String(req.body.displayName).trim() : null;
    await verifyEmailOtp(email, otp);
    const user = await createOrReuseEmailVerifiedUser({ email, displayName });
    const session = await createSession(user.userId, getClientSessionHints(req));
    res.setHeader("Set-Cookie", buildSessionCookie(session.rawToken));
    await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
      eventType: "login_succeeded",
      userId: user.userId,
      sessionId: session.sessionId,
      requestId: requestObs?.requestId ?? null,
      sourceSurface: "email",
      outcome: "succeeded",
      durationMs: elapsedFromRequest(req),
    }));
    return res.json({ ok: true, user, requiresDisplayName: !user.displayName });
  } catch (error) {
    await bestEffortObservability(() => recordRequestFailure(req, {
      scope: "customer",
      errorCode: "login_failed",
      errorCategory: "auth",
      publicMessage: "Could not verify email OTP",
      internalMessage: error instanceof Error ? error.message : String(error),
      httpStatus: 400,
    }));
    await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
      eventType: "login_failed",
      anonymousId: req.body?.anonymousId ? String(req.body.anonymousId) : null,
      requestId: requestObs?.requestId ?? null,
      sourceSurface: "email",
      outcome: "failed",
      durationMs: elapsedFromRequest(req),
    }));
    const message = error instanceof Error ? error.message : "Could not verify email OTP";
    return res.status(400).json({ ok: false, error: message });
  }
});

app.get("/api/auth/session/me", requireAuth, async (_req, res) => {
  const user = (_req as express.Request & { authUser?: { userId: string } }).authUser;
  const ledger = await getCoinLedger(getPostgresDatabase(), user!.userId, { limit: 5 });
  return res.json({ ok: true, user: { ...user, coinBalance: ledger.wallet.balanceCoins } });
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
    const user = token ? await findSessionUser(token).catch(() => null) : null;
    if (token) {
      await revokeSession(token);
    }
    await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
      eventType: "logout",
      userId: user?.userId ?? null,
      sessionId: user?.sessionId ?? null,
      requestId: getRequestObservability(req)?.requestId ?? null,
      outcome: "succeeded",
      durationMs: elapsedFromRequest(req),
    }));
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

app.get("/api/economy/ledger", requireAuth, async (req, res) => {
  try {
    const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
    await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
      eventType: "wallet_opened",
      userId: authUser!.userId,
      sessionId: getAuthSessionId(req),
      requestId: getRequestObservability(req)?.requestId ?? null,
      routeName: "wallet",
      sourceSurface: "profile",
      outcome: "viewed",
    }));
    const readQueryParam = (name: string) => {
      const value = req.query?.[name];
      return typeof value === "string" ? value : undefined;
    };
    const parseEnum = <T extends string>(name: string, fallback: T, allowed: readonly T[]) => {
      const value = readQueryParam(name);
      if (!value) return fallback;
      if ((allowed as readonly string[]).includes(value)) return value as T;
      throw new Error(`Invalid ${name}.`);
    };
    const pageRaw = readQueryParam("page");
    const page = pageRaw === undefined ? 1 : Number(pageRaw);
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new Error("Invalid page.");
    }
    const timezoneOffsetRaw = readQueryParam("timezoneOffsetMinutes");
    const timezoneOffsetMinutes = timezoneOffsetRaw === undefined ? 0 : Number(timezoneOffsetRaw);
    if (!Number.isFinite(timezoneOffsetMinutes)) {
      throw new Error("Invalid timezoneOffsetMinutes.");
    }
    const ledger = await getCoinLedger(getPostgresDatabase(), authUser!.userId, {
      type: parseEnum("type", "all", ["all", "credit", "debit"] as const),
      datePreset: parseEnum("datePreset", "6m", ["7d", "6m", "custom"] as const),
      from: readQueryParam("from") ?? null,
      to: readQueryParam("to") ?? null,
      sort: parseEnum("sort", "newest", ["newest", "oldest", "amount_desc", "amount_asc"] as const),
      page,
      pageSize: 25,
      timezoneOffsetMinutes,
    });
    return res.json({
      ok: true,
      balanceMillis: ledger.wallet.balanceMillis,
      balanceCoins: ledger.wallet.balanceCoins,
      ...ledger,
      pagination: {
        ...ledger.pagination,
        totalItems: ledger.pagination.totalCount,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fetch coin ledger";
    return res.status(400).json({ ok: false, error: message });
  }
});

app.post("/api/observability/location-context", requireAuth, async (req, res) => {
  try {
    if (!isPostgresConfigured()) {
      return res.status(204).end();
    }
    const source = String(req.body?.source || "").trim() as LocationContextSource;
    const supportedSources = new Set<LocationContextSource>(["device", "manual_city", "map_selection", "stroll_start", "ip_approximate"]);
    if (!supportedSources.has(source)) {
      return res.status(400).json({ ok: false, error: "Invalid location source" });
    }
    const permissionRaw = String(req.body?.permissionStatus || "unknown").trim() as LocationPermissionStatus;
    const permissionStatus: LocationPermissionStatus =
      permissionRaw === "granted" ||
      permissionRaw === "denied" ||
      permissionRaw === "prompt" ||
      permissionRaw === "unavailable"
        ? permissionRaw
        : "unknown";
    const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
    const locationContextId = await recordLocationContext(getPostgresDatabase(), {
      userId: authUser?.userId ?? null,
      sessionId: getAuthSessionId(req),
      source,
      latitude: hasCoordinates ? latitude : null,
      longitude: hasCoordinates ? longitude : null,
      accuracyMeters: Number.isSafeInteger(Number(req.body?.accuracyMeters)) ? Number(req.body.accuracyMeters) : null,
      city: typeof req.body?.city === "string" ? req.body.city : null,
      locality: typeof req.body?.locality === "string" ? req.body.locality : null,
      permissionStatus,
      consentSource: typeof req.body?.consentSource === "string" ? req.body.consentSource : "explicit_feature_action",
    });
    return res.status(201).json({ ok: true, locationContextId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record location context";
    await bestEffortObservability(() => recordRequestFailure(req, {
      scope: "customer",
      errorCode: "location_context_record_failed",
      errorCategory: "observability",
      publicMessage: "Could not record location context",
      internalMessage: message,
      httpStatus: 400,
    }));
    return res.status(400).json({ ok: false, error: message });
  }
});

app.get("/api/economy/impact", requireAuth, async (req, res) => {
  try {
    const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
    const impact = await getCoinImpact(getPostgresDatabase(), authUser!.userId);
    res.setHeader("Cache-Control", `private, max-age=${impact.cache.maxAgeSeconds}`);
    return res.json({ ok: true, ...impact });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fetch your impact";
    return res.status(400).json({ ok: false, error: message });
  }
});

app.get("/api/economy/pricing", async (_req, res) => {
  return res.json({ ok: true, pricing: getCoinPricing() });
});

app.get("/api/economy/onboarding", requireAuth, async (req, res) => {
  try {
    const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
    const state = await getCoinOnboardingState(getPostgresDatabase(), authUser!.userId);
    return res.json({ ok: true, ...state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fetch coin onboarding";
    return res.status(400).json({ ok: false, error: message });
  }
});

app.post("/api/economy/onboarding/complete", requireAuth, async (req, res) => {
  try {
    const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
    const state = await completeCoinOnboarding(getPostgresDatabase(), authUser!.userId);
    return res.json({ ok: true, ...state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not complete coin onboarding";
    return res.status(400).json({ ok: false, error: message });
  }
});

app.get("/api/hero-card", requireAuth, async (req, res) => {
  try {
    const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
    const items = await listSavedPlaces(authUser!.userId);
    const readyStrollCandidates = await listReadyHeroStrollCandidates(authUser!.userId);
    const card = buildHeroCardFromSavedPlaces(items as HeroCardSavedPlace[], readyStrollCandidates, authUser!.userId);
    return res.json(card);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build hero card";
    return res.status(400).json({ ok: false, error: message });
  }
});

app.post("/api/saved-places", requireAuth, async (req, res) => {
  const requestObs = getRequestObservability(req);
  let saveOperationRunId: string | null = null;
  try {
    const authUser = (req as express.Request & { authUser?: { userId: string } }).authUser;
    const placeId = resolveSavedPlaceIdFromRequest(req);
    const title = String(req.body?.title || "").trim();
    const category = req.body?.category ? String(req.body.category).trim() : null;
    const metadata = req.body?.metadata ?? {};
    const coinSourceRaw = String(req.body?.coinSource || req.body?.saveSource || "").trim();
    const coinSource: CoinSaveSource | null =
      coinSourceRaw === "external_import" || coinSourceRaw === "discover" ? coinSourceRaw : null;
    const idempotencyKey = String(req.body?.idempotencyKey || "").trim();
    if (isPostgresConfigured()) {
      saveOperationRunId = await createOperationRun(getPostgresDatabase(), {
        operationType: "place_save",
        userId: authUser!.userId,
        sessionId: getAuthSessionId(req),
        requestId: requestObs?.requestId ?? null,
        correlationId: requestObs?.correlationId ?? null,
        entityType: "place",
        entityId: placeId,
        idempotencyKey: idempotencyKey || `save:${authUser!.userId}:${placeId}`,
        inputSummary: {
          source: coinSource ?? "direct",
          category,
          hasMetadata: Boolean(metadata && typeof metadata === "object" && Object.keys(metadata).length),
        },
      }).catch(() => null);
      await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
        eventType: "place_save_started",
        userId: authUser!.userId,
        sessionId: getAuthSessionId(req),
        requestId: requestObs?.requestId ?? null,
        operationRunId: saveOperationRunId,
        entityType: "place",
        entityId: placeId,
        sourceSurface: coinSource ?? "direct",
        outcome: "started",
      }));
    }
    const existing = await findSavedPlaceByUserAndPlaceId(authUser!.userId, placeId);
    if (existing) {
      const duplicate: SavedPlaceDuplicateInfo = {
        kind: "place",
        scope: "same_user",
        placeId,
        existingSavedPlaceId: existing.id,
      };
      const ledger = await getCoinLedger(getPostgresDatabase(), authUser!.userId, { limit: 5 });
      const completedSaveOperationRunId = saveOperationRunId;
      if (completedSaveOperationRunId) {
        await bestEffortObservability(() => completeOperationRun(getPostgresDatabase(), {
          operationRunId: completedSaveOperationRunId,
          status: "succeeded",
          outputSummary: { alreadySaved: true },
        }));
      }
      return res.json({ ok: true, alreadySaved: true, duplicate, item: existing, coin: { wallet: ledger.wallet } });
    }

    if (!coinSource) {
      const saveResult = await upsertSavedPlace(authUser!.userId, {
        placeId,
        title,
        category,
        metadata,
      });
      const enrichmentJob = !saveResult.alreadySaved
        ? await placeEnrichmentJobStore.triggerFromSavedPlace({
            userId: authUser!.userId,
            savedPlace: {
              id: saveResult.item.id,
              placeId: saveResult.item.placeId,
              title: saveResult.item.title,
              category: saveResult.item.category ?? null,
              metadata: saveResult.item.metadata ?? {},
              createdAt: saveResult.item.createdAt ?? null,
              updatedAt: saveResult.item.updatedAt ?? null,
            },
          })
        : null;
      invalidateCoinImpactCache(authUser!.userId);
      const ledger = await getCoinLedger(getPostgresDatabase(), authUser!.userId, { limit: 5 });
      const completedSaveOperationRunId = saveOperationRunId;
      if (completedSaveOperationRunId) {
        await bestEffortObservability(() => completeOperationRun(getPostgresDatabase(), {
          operationRunId: completedSaveOperationRunId,
          status: "succeeded",
          outputSummary: { alreadySaved: saveResult.alreadySaved, charged: false },
        }));
        await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
          eventType: "place_save_succeeded",
          userId: authUser!.userId,
          sessionId: getAuthSessionId(req),
          requestId: requestObs?.requestId ?? null,
          operationRunId: completedSaveOperationRunId,
          entityType: "place",
          entityId: placeId,
          sourceSurface: "direct",
          outcome: "succeeded",
          durationMs: elapsedFromRequest(req),
        }));
      }
      return res.status(201).json({
        ok: true,
        alreadySaved: saveResult.alreadySaved,
        item: saveResult.item,
        enrichmentJob: enrichmentJob?.job ?? null,
        enrichmentReuse: enrichmentJob
          ? {
              reusedExisting: Boolean(enrichmentJob.reusedExisting),
              reason: enrichmentJob.reuseReason ?? null,
            }
          : null,
        coin: { wallet: ledger.wallet },
      });
    }

    const chargeResult = await chargeSavedPlaceCoins({
      database: getPostgresDatabase(),
      userId: authUser!.userId,
      placeId,
      source: coinSource,
      idempotencyKey: idempotencyKey || `save:${authUser!.userId}:${placeId}`,
      metadata: {
        title,
        category,
        source: coinSource,
      },
      commitWithCharge: async (client) => {
        const inserted = await client.query<{ id: string }>(
          `
            insert into user_saved_places (id, user_id, place_id, title, category, metadata_json, created_at, updated_at)
            values (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, now(), now())
            returning id
          `,
          [authUser!.userId, placeId, title, category, JSON.stringify(metadata)],
        );
        await recordUserPlaceInteraction(client, {
          userId: authUser!.userId,
          canonicalPlaceId: null,
          savedPlaceId: inserted.rows[0]?.id ?? null,
          legacyPlaceId: placeId,
          interactionType: "saved",
          interactionSource: coinSource,
          metadata: { title, category },
        });
      },
    });
    const saved = await findSavedPlaceByUserAndPlaceId(authUser!.userId, placeId);
    const enrichmentJob = saved
      ? await placeEnrichmentJobStore.triggerFromSavedPlace({
          userId: authUser!.userId,
          savedPlace: {
            id: saved.id,
            placeId: saved.placeId,
            title: saved.title,
            category: saved.category ?? null,
            metadata: saved.metadata ?? {},
            createdAt: saved.createdAt ?? null,
            updatedAt: saved.updatedAt ?? null,
          },
        })
      : null;
    const completedSaveOperationRunId = saveOperationRunId;
    if (completedSaveOperationRunId) {
      await bestEffortObservability(() => completeOperationRun(getPostgresDatabase(), {
        operationRunId: completedSaveOperationRunId,
        status: "succeeded",
        outputSummary: {
          charged: true,
          source: coinSource,
          saveEventId: chargeResult.saveEvent.id,
          walletBalanceMillis: chargeResult.wallet.balanceMillis,
        },
      }));
      await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
        eventType: "place_save_succeeded",
        userId: authUser!.userId,
        sessionId: getAuthSessionId(req),
        requestId: requestObs?.requestId ?? null,
        operationRunId: completedSaveOperationRunId,
        entityType: "place",
        entityId: placeId,
        sourceSurface: coinSource,
        outcome: "succeeded",
        durationMs: elapsedFromRequest(req),
        metadata: { saveEventId: chargeResult.saveEvent.id },
      }));
    }
    return res.status(201).json({
      ok: true,
      alreadySaved: false,
      item: saved,
      enrichmentJob: enrichmentJob?.job ?? null,
      enrichmentReuse: enrichmentJob
        ? {
            reusedExisting: Boolean(enrichmentJob.reusedExisting),
            reason: enrichmentJob.reuseReason ?? null,
          }
        : null,
      coin: {
        wallet: chargeResult.wallet,
        saveEvent: chargeResult.saveEvent,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_COINS") {
      const failedSaveOperationRunId = saveOperationRunId;
      if (failedSaveOperationRunId) {
        await bestEffortObservability(() => completeOperationRun(getPostgresDatabase(), {
          operationRunId: failedSaveOperationRunId,
          status: "failed",
          outputSummary: { errorCode: "insufficient_coins" },
        }));
      }
      await bestEffortObservability(() => recordRequestFailure(req, {
        scope: "financial",
        errorCode: "insufficient_coins",
        errorCategory: "wallet",
        publicMessage: "Not enough coins. Recommend useful places to earn community rewards.",
        internalMessage: "INSUFFICIENT_COINS",
        httpStatus: 402,
        operationRunId: failedSaveOperationRunId,
        retryable: false,
      }));
      await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
        eventType: "place_save_failed",
        userId: getAuthUserId(req),
        sessionId: getAuthSessionId(req),
        requestId: requestObs?.requestId ?? null,
        operationRunId: failedSaveOperationRunId,
        outcome: "failed",
        durationMs: elapsedFromRequest(req),
        metadata: { errorCode: "insufficient_coins" },
      }));
      return res.status(402).json({
        ok: false,
        error: "Not enough coins. Recommend useful places to earn community rewards.",
      });
    }
    const message = error instanceof Error ? error.message : "Could not save place";
    const failedSaveOperationRunId = saveOperationRunId;
    if (failedSaveOperationRunId) {
      await bestEffortObservability(() => completeOperationRun(getPostgresDatabase(), {
        operationRunId: failedSaveOperationRunId,
        status: "failed",
        outputSummary: { errorCode: "place_save_failed" },
      }));
    }
    await bestEffortObservability(() => recordRequestFailure(req, {
      scope: "customer",
      errorCode: "place_save_failed",
      errorCategory: "saved_place",
      publicMessage: "Could not save place",
      internalMessage: message,
      httpStatus: 400,
      operationRunId: failedSaveOperationRunId,
    }));
    await bestEffortObservability(() => recordProductEvent(getPostgresDatabase(), {
      eventType: "place_save_failed",
      userId: getAuthUserId(req),
      sessionId: getAuthSessionId(req),
      requestId: requestObs?.requestId ?? null,
      operationRunId: failedSaveOperationRunId,
      outcome: "failed",
      durationMs: elapsedFromRequest(req),
      metadata: { errorCode: "place_save_failed" },
    }));
    return res.status(400).json({ ok: false, error: message });
  }
});

app.get("/api/debug/place-enrichment/jobs/:jobId", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ ok: false, error: "not found" });
  }
  const jobId = String(req.params.jobId || "").trim();
  if (!jobId) {
    return res.status(400).json({ ok: false, error: "jobId is required" });
  }
  const job = await placeEnrichmentJobStore.get(jobId);
  if (!job) {
    return res.status(404).json({ ok: false, error: "job not found" });
  }
  return res.json({ ok: true, job });
});

app.get("/api/debug/places/:placeId/knowledge", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ ok: false, error: "not found" });
  }
  if (!isPostgresConfigured()) {
    return res.status(503).json({ ok: false, error: "database not configured" });
  }
  const placeId = String(req.params.placeId || "").trim();
  if (!placeId) {
    return res.status(400).json({ ok: false, error: "placeId is required" });
  }
  const placeRows = await getPostgresDatabase().query<{ id: string; canonical_name: string; city: string | null; locality: string | null }>(
    "select id, canonical_name, city, locality from places where id = $1 limit 1",
    [placeId],
  );
  const evidenceRows = await getPostgresDatabase().query<{
    fact_type: string;
    fact_value_json: unknown;
    source_type: string;
    source_url: string | null;
    confidence: number | null;
    observed_at: string;
  }>(
    `select fact_type, fact_value_json, source_type, source_url, confidence, observed_at
     from place_source_evidence
     where place_id = $1
     order by observed_at desc, fact_type asc`,
    [placeId],
  );
  const grouped = evidenceRows.rows.reduce<Record<string, unknown[]>>((acc, row) => {
    acc[row.fact_type] = acc[row.fact_type] || [];
    acc[row.fact_type].push({
      value: row.fact_value_json,
      sourceType: row.source_type,
      sourceUrl: row.source_url,
      confidence: row.confidence,
      observedAt: row.observed_at,
    });
    return acc;
  }, {});
  return res.json({
    ok: true,
    place: placeRows.rows[0] ?? null,
    evidence: grouped,
    evidenceCount: evidenceRows.rows.length,
  });
});

app.get("/api/admin/observability/overview", requireAdmin, async (req, res) => {
  try {
    const overview = await getAdminObservabilityOverview({
      from: req.query?.from ? String(req.query.from).trim() : null,
      to: req.query?.to ? String(req.query.to).trim() : null,
      platform: req.query?.platform ? String(req.query.platform).trim() : null,
    });
    return res.json({
      ok: true,
      totals: {
        submittedLinks: overview.totalSubmittedLinks,
        runs: overview.totalRuns,
        attempts: overview.totalAttempts,
        savedRuns: overview.savedRuns,
        editedRuns: overview.editedRuns,
        discardedRuns: overview.discardedRuns,
      },
      rates: {
        saveRate: overview.saveRate,
        editRate: overview.editRate,
        discardRate: overview.discardRate,
      },
      averages: {
        attemptCount: overview.averageAttemptCount,
        extractionTimeMs: overview.averageExtractionTimeMs,
      },
      estimates: {
        cacheReuseCount: overview.estimatedCacheReuseCount,
        duplicateSavedPlaceCount: overview.estimatedDuplicateSavedPlaceCount,
        cacheReuseIsEstimated: true,
        duplicateSavedPlaceIsEstimated: true,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fetch admin overview";
    return res.status(400).json({ ok: false, error: message });
  }
});

app.get("/api/admin/observability/links", requireAdmin, async (req, res) => {
  try {
    const result = await getAdminObservabilityLinks({
      from: req.query?.from ? String(req.query.from).trim() : null,
      to: req.query?.to ? String(req.query.to).trim() : null,
      platform: req.query?.platform ? String(req.query.platform).trim() : null,
      status: req.query?.status ? String(req.query.status).trim() : null,
      reused: req.query?.reused
        ? String(req.query.reused).toLowerCase() === "true"
        : req.query?.reused === "false"
          ? false
          : null,
      acceptedAfter: req.query?.acceptedAfter ? String(req.query.acceptedAfter).trim() : null,
      q: req.query?.q ? String(req.query.q).trim() : null,
      page: req.query?.page ? Number(req.query.page) : undefined,
      pageSize: req.query?.pageSize ? Number(req.query.pageSize) : undefined,
    });
    return res.json({
      ok: true,
      rows: result.rows,
      pagination: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fetch admin links";
    return res.status(400).json({ ok: false, error: message });
  }
});

app.get("/api/admin/observability/links/:submittedLinkId", requireAdmin, async (req, res) => {
  try {
    const submittedLinkId = String(req.params?.submittedLinkId || "").trim();
    const includeRaw = req.query?.includeRaw ? String(req.query.includeRaw).toLowerCase() === "true" : false;
    const result = await getAdminObservabilityLinkDetail({ submittedLinkId, includeRaw });
    return res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fetch link detail";
    return res.status(400).json({ ok: false, error: message });
  }
});

app.get("/api/admin/usage/overview", requireAdmin, async (req, res) => {
  try {
    const normalizeDate = (value: unknown) => {
      const normalized = String(value || "").trim();
      return normalized && Number.isFinite(new Date(normalized).getTime()) ? normalized : null;
    };
    const userTypeRaw = req.query?.userType ? String(req.query.userType).trim() : "";
    const userType = userTypeRaw === "logged_in" || userTypeRaw === "anonymous" ? userTypeRaw : null;
    const platform = req.query?.platform ? String(req.query.platform).trim() : "";
    const from = normalizeDate(req.query?.from);
    const to = normalizeDate(req.query?.to);
    const excludeTestUsersRaw = req.query?.excludeTestUsers ? String(req.query.excludeTestUsers).trim().toLowerCase() : "";
    const excludeTestUsers = excludeTestUsersRaw === "false" ? false : true;
    const result = await getAdminUsageOverview({
      from,
      to,
      platform: platform || null,
      userType,
      excludeTestUsers,
    });
    return res.json({
      ok: true,
      summary: {
        loggedInUsers: result.loggedInUsers,
        anonymousUsers: result.anonymousUsers,
        uniqueUsers: result.uniqueUsers,
        appOpenedUsers: result.appOpenedUsers,
        loginSeenUsers: result.loginSeenUsers,
        loggedInButNoRunUsers: result.loggedInButNoRunUsers,
        newUsers: result.newUsers,
        returningUsers: result.returningUsers,
        repeatUsers: result.repeatUsers,
        usersSubmittedAtLeastOneLink: result.usersSubmittedAtLeastOneLink,
        usersSavedAtLeastOnePlace: result.usersSavedAtLeastOnePlace,
        usersWithTwoPlusSavedPlaces: result.usersWithTwoPlusSavedPlaces,
        usersSubmittedButDidNotSave: result.usersSubmittedButDidNotSave,
        totalSavedPlaces: result.totalSavedPlaces,
      },
      rates: {
        savesPerUser: result.savesPerUser,
        linksPerUser: result.linksPerUser,
        saveRatePerUser: result.saveRatePerUser,
      },
      activity: {
        lastActiveAt: result.lastActiveAt,
      },
      definitions: {
        newUser: "first_seen_at within selected range",
        returningUser: "active in selected range and first_seen_at before selected range",
        repeatUser: "runs_count >= 2",
        droppedAfterExtraction: "unique_links_submitted > 0 and saved_places_count = 0",
        saveRatePerUser: "users_who_saved / users_who_submitted",
        rowSaveRate: "saved_places_count / unique_links_submitted",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fetch admin usage overview";
    return res.status(400).json({ ok: false, error: message });
  }
});

app.get("/api/internal/database-health", requireAdmin, async (_req, res) => {
  try {
    if (!isPostgresConfigured()) {
      return res.status(503).json({ ok: false, error: "Postgres is not configured" });
    }
    const report = await getDatabaseHealthReport(getPostgresDatabase());
    return res.json({ ok: true, ...report });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fetch database health";
    return res.status(400).json({ ok: false, error: message });
  }
});

app.get("/api/admin/usage/users", requireAdmin, async (req, res) => {
  try {
    const normalizeDate = (value: unknown) => {
      const normalized = String(value || "").trim();
      return normalized && Number.isFinite(new Date(normalized).getTime()) ? normalized : null;
    };
    const userTypeRaw = req.query?.userType ? String(req.query.userType).trim() : "";
    const statusRaw = req.query?.status ? String(req.query.status).trim() : "";
    const userType = userTypeRaw === "logged_in" || userTypeRaw === "anonymous" ? userTypeRaw : null;
    const status = (
      ["new", "active", "saved_place", "repeat_user", "dropped_after_extraction", "opened_app", "logged_in", "no_link_submitted"] as const
    ).includes(statusRaw as "new")
      ? statusRaw as "new" | "active" | "saved_place" | "repeat_user" | "dropped_after_extraction" | "opened_app" | "logged_in" | "no_link_submitted"
      : null;
    const platform = req.query?.platform ? String(req.query.platform).trim() : "";
    const from = normalizeDate(req.query?.from);
    const to = normalizeDate(req.query?.to);
    const q = req.query?.q ? String(req.query.q).trim() : "";
    const excludeTestUsersRaw = req.query?.excludeTestUsers ? String(req.query.excludeTestUsers).trim().toLowerCase() : "";
    const excludeTestUsers = excludeTestUsersRaw === "false" ? false : true;
    const result = await getAdminUsageUsers({
      from,
      to,
      platform: platform || null,
      userType,
      status,
      q: q || null,
      excludeTestUsers,
      page: req.query?.page ? Number(req.query.page) : undefined,
      pageSize: req.query?.pageSize ? Number(req.query.pageSize) : undefined,
    });
    return res.json({
      ok: true,
      rows: result.rows,
      pagination: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fetch admin usage users";
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
if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    console.log(`wandreel api running on http://localhost:${port}`);
  });
}

export { app };
