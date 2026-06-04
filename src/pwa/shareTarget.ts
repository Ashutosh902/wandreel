export const SHARED_INTENT_CACHE_NAME = "wandreel-share-target-v1";
export const SHARED_INTENT_CACHE_PATH = "/__wandreel_shared_intent__";
export const SHARED_INTENT_RECEIVED_EVENT = "wr:shared-intent-received";
export const SHARED_INTENT_CLIENT_MESSAGE = "wr:share-target-received";
export const SHARED_INTENT_MAX_AGE_MS = 30 * 60 * 1000;
export const SHARED_INTENT_QUERY_KEY = "shared";
export const SHARED_INTENT_TAB_KEY = "tab";
export const SHARED_INTENT_ADD_TAB_VALUE = "add";

export type SharedIntentPayload = {
  intentId: string;
  title?: string;
  text?: string;
  url?: string;
  extractedUrl?: string | null;
  createdAt: number;
};

type ShareTargetInput = {
  title?: string | null;
  text?: string | null;
  url?: string | null;
};

function getCacheRequest() {
  return new Request(new URL(SHARED_INTENT_CACHE_PATH, globalThis.location.origin).toString(), {
    method: "GET",
  });
}

function normalizeText(value?: string | null) {
  const text = String(value || "").trim();
  return text.length ? text : "";
}

function stripTrailingPunctuation(value: string) {
  return value.replace(/[)\]}>,.!?;:'"]+$/g, "");
}

function normalizeUrlCandidate(candidate: string): string | null {
  const stripped = stripTrailingPunctuation(candidate.trim());
  if (!stripped) return null;
  try {
    const parsed = new URL(stripped);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function extractFirstUrl(input: string): string | null {
  const direct = normalizeUrlCandidate(input);
  if (direct) return direct;

  const matches = input.match(/https?:\/\/[^\s<>"']+/gi) || [];
  for (const match of matches) {
    const normalized = normalizeUrlCandidate(match);
    if (normalized) return normalized;
  }

  return null;
}

export function buildSharedIntentPayload(input: ShareTargetInput): SharedIntentPayload | null {
  const title = normalizeText(input.title);
  const text = normalizeText(input.text);
  const url = normalizeText(input.url);
  const combined = [title, text, url].filter(Boolean).join(" ");
  const extractedUrl =
    normalizeUrlCandidate(url) ||
    extractFirstUrl(text) ||
    extractFirstUrl(combined);

  if (!title && !text && !url && !extractedUrl) return null;

  return {
    intentId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    title: title || undefined,
    text: text || undefined,
    url: url || undefined,
    extractedUrl,
    createdAt: Date.now(),
  };
}

export function buildShareTargetAppUrl() {
  const url = new URL(globalThis.location.origin);
  url.searchParams.set(SHARED_INTENT_TAB_KEY, SHARED_INTENT_ADD_TAB_VALUE);
  url.searchParams.set(SHARED_INTENT_QUERY_KEY, "1");
  return url.toString();
}

export async function writePendingSharedIntent(payload: SharedIntentPayload) {
  const cache = await caches.open(SHARED_INTENT_CACHE_NAME);
  await cache.put(
    getCacheRequest(),
    new Response(JSON.stringify(payload), {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    }),
  );
}

export async function clearPendingSharedIntent() {
  const cache = await caches.open(SHARED_INTENT_CACHE_NAME);
  await cache.delete(getCacheRequest());
}

export async function readPendingSharedIntent() {
  const cache = await caches.open(SHARED_INTENT_CACHE_NAME);
  const response = await cache.match(getCacheRequest());
  if (!response) return null;

  try {
    const payload = (await response.json()) as SharedIntentPayload;
    if (!payload?.intentId || typeof payload.createdAt !== "number") {
      await clearPendingSharedIntent();
      return null;
    }
    if (Date.now() - payload.createdAt > SHARED_INTENT_MAX_AGE_MS) {
      await clearPendingSharedIntent();
      return null;
    }
    return payload;
  } catch {
    await clearPendingSharedIntent();
    return null;
  }
}

export async function consumePendingSharedIntent() {
  const payload = await readPendingSharedIntent();
  if (!payload) return null;
  await clearPendingSharedIntent();
  return payload;
}

export function getSharedIntentPrefill(payload: SharedIntentPayload) {
  return (
    payload.extractedUrl ||
    normalizeText(payload.url) ||
    normalizeText(payload.text) ||
    normalizeText(payload.title) ||
    ""
  );
}

export function isShareIntentMessage(data: unknown): data is { type: string } {
  return typeof data === "object" && data !== null && "type" in data;
}
