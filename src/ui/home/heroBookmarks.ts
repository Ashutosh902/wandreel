type Fetcher = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type HeroBookmarkCardInput = {
  cardKey: string;
  heroType: string;
  ctaAction: string;
  title: string;
  subtitle: string;
  metadata: Record<string, unknown>;
};

export type HeroBookmarkTogglePlan = {
  nextKeys: string[];
  endpoint: "add" | "remove";
};

function ensureApiBaseUrl(apiBaseUrl: string) {
  return apiBaseUrl.replace(/\/$/, "");
}

function uniqueKeys(keys: string[]) {
  return Array.from(new Set(keys.map((key) => key.trim()).filter(Boolean)));
}

async function parseApiPayload(response: Awaited<ReturnType<Fetcher>>) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !(payload as { ok?: boolean })?.ok) {
    throw new Error(String((payload as { error?: string })?.error || `Request failed (${response.status})`));
  }
  return payload as Record<string, unknown>;
}

export function getHeroBookmarkKeysFromPayload(payload: unknown): string[] {
  const bookmarks = (payload as { bookmarks?: unknown[] })?.bookmarks;
  if (!Array.isArray(bookmarks)) return [];
  return uniqueKeys(
    bookmarks
      .map((bookmark) => (bookmark as { cardKey?: unknown })?.cardKey)
      .filter((cardKey): cardKey is string => typeof cardKey === "string"),
  );
}

export function getHeroBookmarkTogglePlan(currentKeys: string[], cardKey: string): HeroBookmarkTogglePlan {
  const key = cardKey.trim();
  const keys = uniqueKeys(currentKeys);
  if (!key) {
    return { nextKeys: keys, endpoint: "add" };
  }
  if (keys.includes(key)) {
    return {
      nextKeys: keys.filter((item) => item !== key),
      endpoint: "remove",
    };
  }
  return {
    nextKeys: [key, ...keys],
    endpoint: "add",
  };
}

export function shouldIgnoreHeroBookmarkClick(pendingCardKey: string | null, cardKey: string) {
  return pendingCardKey === cardKey;
}

export async function fetchHeroBookmarkKeys(apiBaseUrl: string, fetcher: Fetcher = fetch) {
  const response = await fetcher(`${ensureApiBaseUrl(apiBaseUrl)}/api/hero-bookmarks`, {
    credentials: "include",
  });
  const payload = await parseApiPayload(response);
  return getHeroBookmarkKeysFromPayload(payload);
}

export async function saveHeroBookmark(
  apiBaseUrl: string,
  card: HeroBookmarkCardInput,
  fetcher: Fetcher = fetch,
) {
  const matchingPlaceIds = Array.isArray(card.metadata.matchingPlaceIds)
    ? card.metadata.matchingPlaceIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const response = await fetcher(`${ensureApiBaseUrl(apiBaseUrl)}/api/hero-bookmarks`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cardKey: card.cardKey,
      heroType: card.heroType,
      ctaAction: card.ctaAction,
      title: card.title,
      subtitle: card.subtitle,
      metadata: card.metadata,
      matchingPlaceIds,
    }),
  });
  await parseApiPayload(response);
}

export async function removeHeroBookmark(apiBaseUrl: string, cardKey: string, fetcher: Fetcher = fetch) {
  const response = await fetcher(`${ensureApiBaseUrl(apiBaseUrl)}/api/hero-bookmarks/remove`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cardKey }),
  });
  await parseApiPayload(response);
}
