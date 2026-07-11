import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchHeroBookmarkKeys,
  getHeroBookmarkTogglePlan,
  removeHeroBookmark,
  saveHeroBookmark,
  shouldIgnoreHeroBookmarkClick,
} from "./heroBookmarks";

export function useHeroBookmarks<TCard>(options: {
  apiBaseUrl: string;
  isAuthenticated: boolean;
  userId: string | null;
  showToast: (toast: { message: string; variant: "success" | "error" | "info"; durationMs?: number }) => void;
  deriveCardKey: (card: TCard) => string;
  buildBookmarkPayload: (card: TCard, cardKey: string) => {
    cardKey: string;
    heroType: string;
    ctaAction: string;
    title: string;
    subtitle: string;
    metadata: Record<string, unknown>;
  };
}) {
  const {
    apiBaseUrl,
    isAuthenticated,
    userId,
    showToast,
    deriveCardKey,
    buildBookmarkPayload,
  } = options;
  const [heroBookmarkKeys, setHeroBookmarkKeys] = useState<string[]>([]);
  const [pendingHeroBookmarkCardKey, setPendingHeroBookmarkCardKey] = useState<string | null>(null);
  const pendingHeroBookmarkCardKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setHeroBookmarkKeys([]);
      return;
    }

    let cancelled = false;
    fetchHeroBookmarkKeys(apiBaseUrl)
      .then((keys) => {
        if (!cancelled) {
          setHeroBookmarkKeys(keys);
        }
      })
      .catch(() => {
        if (!cancelled) {
          showToast({ message: "Could not load hero bookmarks.", variant: "info", durationMs: 2200 });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, isAuthenticated, showToast, userId]);

  const handleHeroBookmarkToggle = useCallback(async (card: TCard) => {
    if (!isAuthenticated) {
      showToast({ message: "Sign in to save hero ideas.", variant: "info", durationMs: 2200 });
      return;
    }

    const cardKey = deriveCardKey(card);
    if (shouldIgnoreHeroBookmarkClick(pendingHeroBookmarkCardKeyRef.current, cardKey)) return;

    const previousKeys = heroBookmarkKeys;
    const plan = getHeroBookmarkTogglePlan(previousKeys, cardKey);
    pendingHeroBookmarkCardKeyRef.current = cardKey;
    setPendingHeroBookmarkCardKey(cardKey);
    setHeroBookmarkKeys(plan.nextKeys);

    try {
      if (plan.endpoint === "add") {
        await saveHeroBookmark(apiBaseUrl, buildBookmarkPayload(card, cardKey));
        showToast({ message: "Hero idea bookmarked.", variant: "success", durationMs: 1800 });
      } else {
        await removeHeroBookmark(apiBaseUrl, cardKey);
        showToast({ message: "Hero bookmark removed.", variant: "info", durationMs: 1800 });
      }
    } catch {
      setHeroBookmarkKeys(previousKeys);
      showToast({ message: "Could not update bookmark. Try again.", variant: "error", durationMs: 2400 });
    } finally {
      pendingHeroBookmarkCardKeyRef.current = null;
      setPendingHeroBookmarkCardKey(null);
    }
  }, [apiBaseUrl, buildBookmarkPayload, deriveCardKey, heroBookmarkKeys, isAuthenticated, showToast]);

  return {
    heroBookmarkKeys,
    pendingHeroBookmarkCardKey,
    handleHeroBookmarkToggle,
  };
}
