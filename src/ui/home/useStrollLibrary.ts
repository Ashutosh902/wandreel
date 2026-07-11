import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchStrollLibrary,
  fetchStrollStatus,
  getStrollIdsToPoll,
  mergePolledStroll,
  retryStrollCuration,
  type PersistentStrollSummary,
  type StrollLibraryLoadState,
} from "./strollLibrary";

export function useStrollLibrary(options: {
  apiBaseUrl: string;
  isAuthenticated: boolean;
  userId: string | null;
  showToast: (toast: { message: string; variant: "success" | "error" | "info"; durationMs?: number }) => void;
}) {
  const [strolls, setStrolls] = useState<PersistentStrollSummary[]>([]);
  const [strollLibraryState, setStrollLibraryState] = useState<StrollLibraryLoadState>("idle");
  const [strollLibraryError, setStrollLibraryError] = useState<string | null>(null);
  const [retryingStrollId, setRetryingStrollId] = useState<string | null>(null);
  const isRefreshingStrollLibraryRef = useRef(false);

  const pendingStrollPollKey = useMemo(
    () => getStrollIdsToPoll(strolls).join("|"),
    [strolls],
  );

  const refreshStrollLibrary = useCallback(async (refreshOptions: { silent?: boolean } = {}) => {
    if (!options.isAuthenticated) {
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
      const nextStrolls = await fetchStrollLibrary(options.apiBaseUrl);
      setStrolls(nextStrolls);
      setStrollLibraryState("ready");
      setStrollLibraryError(null);
    } catch (error) {
      setStrollLibraryState("error");
      setStrollLibraryError(error instanceof Error ? error.message : "Could not load Strolls.");
    } finally {
      isRefreshingStrollLibraryRef.current = false;
    }
  }, [options.apiBaseUrl, options.isAuthenticated]);

  const handleRetryStroll = useCallback(async (strollId: string) => {
    if (retryingStrollId) return;
    setRetryingStrollId(strollId);
    try {
      const queuedStroll = await retryStrollCuration(options.apiBaseUrl, strollId);
      setStrolls((current) => mergePolledStroll(current, queuedStroll));
      options.showToast({ message: "Stroll retry queued.", variant: "success", durationMs: 2200 });
    } catch {
      options.showToast({ message: "Could not retry this Stroll. Try again.", variant: "error", durationMs: 2600 });
    } finally {
      setRetryingStrollId(null);
    }
  }, [options, retryingStrollId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void refreshStrollLibrary(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [refreshStrollLibrary, options.userId]);

  useEffect(() => {
    if (!options.isAuthenticated || !pendingStrollPollKey) return;

    const controller = new AbortController();
    const pollStrollStatuses = async () => {
      if (controller.signal.aborted || document.visibilityState === "hidden") return;
      const pendingIds = pendingStrollPollKey.split("|").filter(Boolean);
      const updates = await Promise.all(
        pendingIds.map(async (strollId) => {
          try {
            return await fetchStrollStatus(options.apiBaseUrl, strollId);
          } catch {
            return null;
          }
        }),
      );

      if (controller.signal.aborted) return;
      setStrolls((current) => updates.reduce(
        (nextStrolls, updated) => (updated ? mergePolledStroll(nextStrolls, updated) : nextStrolls),
        current,
      ));
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
  }, [options.apiBaseUrl, options.isAuthenticated, pendingStrollPollKey]);

  return {
    strolls,
    strollLibraryState,
    strollLibraryError,
    retryingStrollId,
    refreshStrollLibrary,
    handleRetryStroll,
  };
}
