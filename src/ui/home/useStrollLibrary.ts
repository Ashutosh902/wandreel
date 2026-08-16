import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  archiveStroll,
  fetchStrollLibrary,
  fetchStrollStatus,
  getStrollIdsToPoll,
  mergePolledStroll,
  retryStrollCuration,
  type PersistentStrollSummary,
  type StrollLibraryLoadState,
} from "./strollLibrary";

const STROLL_LIBRARY_CACHE_KEY = "wr_stroll_library_v1";

function buildStrollLibraryCacheKey(userId: string | null) {
  return userId ? `${STROLL_LIBRARY_CACHE_KEY}:${userId}` : STROLL_LIBRARY_CACHE_KEY;
}

function readCachedStrollLibrary(userId: string | null) {
  if (!userId) return null;
  try {
    const raw = window.localStorage.getItem(buildStrollLibraryCacheKey(userId));
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed as PersistentStrollSummary[] : null;
  } catch {
    return null;
  }
}

function writeCachedStrollLibrary(userId: string | null, strolls: PersistentStrollSummary[]) {
  if (!userId) return;
  try {
    window.localStorage.setItem(buildStrollLibraryCacheKey(userId), JSON.stringify(strolls));
  } catch {
    // Ignore cache persistence failures.
  }
}

export function useStrollLibrary(options: {
  apiBaseUrl: string;
  isAuthenticated: boolean;
  userId: string | null;
  showToast: (toast: { message: string; variant: "success" | "error" | "info"; durationMs?: number }) => void;
}) {
  const { apiBaseUrl, isAuthenticated, userId, showToast } = options;
  const [strolls, setStrolls] = useState<PersistentStrollSummary[]>([]);
  const [strollLibraryState, setStrollLibraryState] = useState<StrollLibraryLoadState>("idle");
  const [strollLibraryError, setStrollLibraryError] = useState<string | null>(null);
  const [retryingStrollId, setRetryingStrollId] = useState<string | null>(null);
  const [archivingStrollId, setArchivingStrollId] = useState<string | null>(null);
  const isRefreshingStrollLibraryRef = useRef(false);

  const pendingStrollPollKey = useMemo(
    () => getStrollIdsToPoll(strolls).join("|"),
    [strolls],
  );

  const refreshStrollLibrary = useCallback(async (refreshOptions: { silent?: boolean } = {}) => {
    if (!isAuthenticated) {
      setStrolls([]);
      setStrollLibraryState("idle");
      setStrollLibraryError(null);
      return;
    }
    if (isRefreshingStrollLibraryRef.current) return;

    isRefreshingStrollLibraryRef.current = true;
    if (!refreshOptions.silent) {
      setStrollLibraryState("loading");
      setStrollLibraryError(null);
    }

    try {
      const nextStrolls = await fetchStrollLibrary(apiBaseUrl);
      setStrolls(nextStrolls);
      writeCachedStrollLibrary(userId, nextStrolls);
      setStrollLibraryState("ready");
      setStrollLibraryError(null);
    } catch (error) {
      setStrollLibraryState("error");
      setStrollLibraryError(error instanceof Error ? error.message : "Could not load Strolls.");
    } finally {
      isRefreshingStrollLibraryRef.current = false;
    }
  }, [apiBaseUrl, isAuthenticated, userId]);

  const handleRetryStroll = useCallback(async (strollId: string) => {
    if (retryingStrollId) return;
    setRetryingStrollId(strollId);
    try {
      const queuedStroll = await retryStrollCuration(apiBaseUrl, strollId);
      setStrolls((current) => mergePolledStroll(current, queuedStroll));
      showToast({ message: "Stroll retry queued.", variant: "success", durationMs: 2200 });
    } catch {
      showToast({ message: "Could not retry this Stroll. Try again.", variant: "error", durationMs: 2600 });
    } finally {
      setRetryingStrollId(null);
    }
  }, [apiBaseUrl, retryingStrollId, showToast]);

  const handleArchiveStroll = useCallback(async (strollId: string) => {
    if (archivingStrollId) return;
    const previous = strolls;
    setArchivingStrollId(strollId);
    setStrolls((current) => current.filter((stroll) => stroll.id !== strollId));
    try {
      await archiveStroll(apiBaseUrl, strollId);
      showToast({ message: "Stroll deleted.", variant: "success", durationMs: 2200 });
    } catch {
      setStrolls(previous);
      showToast({ message: "Could not archive this Stroll. Try again.", variant: "error", durationMs: 2600 });
    } finally {
      setArchivingStrollId(null);
    }
  }, [apiBaseUrl, archivingStrollId, showToast, strolls]);

  const mergeLocalStroll = useCallback((stroll: PersistentStrollSummary) => {
    setStrolls((current) => {
      const next = mergePolledStroll(current, stroll);
      writeCachedStrollLibrary(userId, next);
      return next;
    });
    setStrollLibraryState("ready");
    setStrollLibraryError(null);
  }, [userId]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const cachedStrolls = readCachedStrollLibrary(userId);
    if (cachedStrolls?.length) {
      setStrolls(cachedStrolls);
      setStrollLibraryState("ready");
      setStrollLibraryError(null);
    }
  }, [isAuthenticated, userId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void refreshStrollLibrary(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [refreshStrollLibrary, userId]);

  useEffect(() => {
    if (!isAuthenticated || !pendingStrollPollKey) return;

    const controller = new AbortController();
    const pollStrollStatuses = async () => {
      if (controller.signal.aborted || document.visibilityState === "hidden") return;
      const pendingIds = pendingStrollPollKey.split("|").filter(Boolean);
      const updates = await Promise.all(
        pendingIds.map(async (strollId) => {
          try {
            return await fetchStrollStatus(apiBaseUrl, strollId);
          } catch {
            return null;
          }
        }),
      );

      if (controller.signal.aborted) return;
      setStrolls((current) => {
        const next = updates.reduce(
          (nextStrolls, updated) => (updated ? mergePolledStroll(nextStrolls, updated) : nextStrolls),
          current,
        );
        writeCachedStrollLibrary(userId, next);
        return next;
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void pollStrollStatuses();
    };

    void pollStrollStatuses();
    const intervalId = window.setInterval(() => void pollStrollStatuses(), 2500);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      controller.abort();
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [apiBaseUrl, isAuthenticated, pendingStrollPollKey, userId]);

  useEffect(() => {
    if (!isAuthenticated) return;
    writeCachedStrollLibrary(userId, strolls);
  }, [isAuthenticated, strolls, userId]);

  return {
    strolls,
    strollLibraryState,
    strollLibraryError,
    retryingStrollId,
    archivingStrollId,
    refreshStrollLibrary,
    mergeLocalStroll,
    handleRetryStroll,
    handleArchiveStroll,
  };
}
