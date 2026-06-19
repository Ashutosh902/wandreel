import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  clearAuthSessionSnapshot,
  normalizeSessionUser,
  readAuthSessionSnapshot,
  type SessionUser,
  writeAuthSessionSnapshot,
} from "./authStorage";
import { shouldIgnoreAuthRefreshResult } from "./authProviderState";
import { clearSavedPlacesByCategory, setSavedPlacesCacheUser } from "../home/savedPlaces";

export type AuthStatus = "initializing" | "authenticated" | "unauthenticated" | "refreshing";

type AuthContextValue = {
  authStatus: AuthStatus;
  sessionUser: SessionUser | null;
  isAuthenticated: boolean;
  hasSessionHint: boolean;
  refreshSession: (options?: { reason?: string; force?: boolean; timeoutMs?: number }) => Promise<SessionUser | null>;
  setAuthenticatedUser: (user: SessionUser, options?: { reason?: string }) => void;
  logout: () => Promise<void>;
};

type InitialAuthBootstrap = {
  snapshotUser: SessionUser | null;
  hasSessionHint: boolean;
  storageReadMs: number;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
const AUTH_SESSION_UPDATED_EVENT = "wr:auth-session-updated";
const AUTH_PROFILE_FETCH_TIMEOUT_MS = 3000;

const AuthContext = createContext<AuthContextValue | null>(null);

function readInitialAuthBootstrap(): InitialAuthBootstrap {
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const snapshot = typeof window !== "undefined" ? readAuthSessionSnapshot(window.localStorage) : null;
  const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    snapshotUser: snapshot?.user ?? null,
    hasSessionHint: Boolean(snapshot?.user),
    storageReadMs: Math.max(0, endedAt - startedAt),
  };
}

function logAuthTiming(event: string, details: Record<string, unknown>) {
  console.info("[auth-startup]", {
    event,
    ...details,
  });
}

function dispatchAuthSessionUpdated(status: AuthStatus) {
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_UPDATED_EVENT, { detail: { status } }));
}

async function fetchSessionUser(
  signal: AbortSignal,
  timeoutMs = AUTH_PROFILE_FETCH_TIMEOUT_MS,
): Promise<{ user: SessionUser | null; elapsedMs: number; timedOut: boolean; aborted: boolean }> {
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort("auth_profile_timeout"), timeoutMs);
  const abortSignal = AbortSignal.any([signal, timeoutController.signal]);

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/session/me`, {
      credentials: "include",
      signal: abortSignal,
    });
    const payload = await response.json().catch(() => ({}));
    const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsedMs = Math.max(0, endedAt - startedAt);
    if (!response.ok || !payload?.ok) {
      return { user: null, elapsedMs, timedOut: false, aborted: false };
    }
    return {
      user: normalizeSessionUser(payload.user),
      elapsedMs,
      timedOut: false,
      aborted: false,
    };
  } catch (error) {
    const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsedMs = Math.max(0, endedAt - startedAt);
    const timedOut =
      error instanceof DOMException
        ? error.name === "AbortError"
        : String(error).includes("auth_profile_timeout");
    return {
      user: null,
      elapsedMs,
      timedOut: signal.aborted ? false : timedOut,
      aborted: signal.aborted,
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [initialBootstrap] = useState(readInitialAuthBootstrap);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(
    initialBootstrap.hasSessionHint ? "refreshing" : "initializing",
  );
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(initialBootstrap.snapshotUser);
  const [hasSessionHint, setHasSessionHint] = useState(initialBootstrap.hasSessionHint);
  const refreshPromiseRef = useRef<Promise<SessionUser | null> | null>(null);
  const didBootstrapRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const retryRefreshRef = useRef<(reason: string) => void>(() => undefined);
  const authVersionRef = useRef(0);
  const requestIdRef = useRef(0);
  const inFlightRequestRef = useRef<{
    requestId: number;
    authVersion: number;
    controller: AbortController;
  } | null>(null);

  const isAuthenticated = authStatus === "authenticated" || authStatus === "refreshing";

  const persistAuthenticatedUser = useCallback((user: SessionUser, status: AuthStatus, reason: string) => {
    authVersionRef.current += 1;
    if (typeof window !== "undefined") {
      setSavedPlacesCacheUser(user.userId);
      writeAuthSessionSnapshot(window.localStorage, user);
      dispatchAuthSessionUpdated(status);
    }
    setSessionUser(user);
    setHasSessionHint(true);
    setAuthStatus(status);
    logAuthTiming("final_auth_state", {
      reason,
      finalAuthState: status,
      hasSessionHint: true,
      userId: user.userId,
    });
  }, []);

  const clearAuthenticatedUser = useCallback((reason: string) => {
    authVersionRef.current += 1;
    inFlightRequestRef.current?.controller.abort("auth_state_cleared");
    inFlightRequestRef.current = null;
    refreshPromiseRef.current = null;
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (typeof window !== "undefined") {
      setSavedPlacesCacheUser(null);
      clearAuthSessionSnapshot(window.localStorage);
      dispatchAuthSessionUpdated("unauthenticated");
    }
    clearSavedPlacesByCategory();
    setSessionUser(null);
    setHasSessionHint(false);
    setAuthStatus("unauthenticated");
    logAuthTiming("final_auth_state", {
      reason,
      finalAuthState: "unauthenticated",
      hasSessionHint: false,
      userId: null,
    });
  }, []);

  const refreshSession = useCallback(async (options?: { reason?: string; force?: boolean; timeoutMs?: number }) => {
    const reason = options?.reason || "manual";
    const authVersion = authVersionRef.current;
    if (refreshPromiseRef.current && inFlightRequestRef.current?.authVersion === authVersion) {
      return refreshPromiseRef.current;
    }

    setAuthStatus((current) => (current === "authenticated" || sessionUser ? "refreshing" : "initializing"));
    inFlightRequestRef.current?.controller.abort("superseded_auth_request");
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();

    const request = (async () => {
      inFlightRequestRef.current = {
        requestId,
        authVersion,
        controller,
      };
      const result = await fetchSessionUser(controller.signal, options?.timeoutMs ?? AUTH_PROFILE_FETCH_TIMEOUT_MS);
      logAuthTiming("profile_fetch", {
        requestId,
        reason,
        profileFetchMs: result.elapsedMs,
        timedOut: result.timedOut,
        aborted: result.aborted,
        hadSessionHint: hasSessionHint,
      });

      const shouldIgnore = shouldIgnoreAuthRefreshResult({
        resultAborted: result.aborted,
        currentRequestId: inFlightRequestRef.current?.requestId ?? null,
        requestId,
        currentAuthVersion: authVersionRef.current,
        requestAuthVersion: authVersion,
      });
      if (shouldIgnore) {
        logAuthTiming("profile_fetch_ignored", {
          requestId,
          reason,
          aborted: result.aborted,
          stale: true,
          currentAuthVersion: authVersionRef.current,
          requestAuthVersion: authVersion,
        });
        return sessionUser;
      }

      if (result.user) {
        persistAuthenticatedUser(result.user, "authenticated", reason);
        return result.user;
      }

      if (result.timedOut && (sessionUser || hasSessionHint)) {
        setAuthStatus("refreshing");
        logAuthTiming("profile_fetch_timeout", {
          requestId,
          reason,
          profileFetchMs: result.elapsedMs,
          finalAuthState: "refreshing",
        });
        if (retryTimerRef.current !== null) {
          window.clearTimeout(retryTimerRef.current);
        }
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          retryRefreshRef.current(`${reason}_retry`);
        }, 6000);
        if (typeof window !== "undefined") {
          dispatchAuthSessionUpdated("refreshing");
        }
        return sessionUser;
      }

      clearAuthenticatedUser(reason);
      return null;
    })();

    refreshPromiseRef.current = request.finally(() => {
      if (refreshPromiseRef.current === request) {
        refreshPromiseRef.current = null;
      }
      if (inFlightRequestRef.current?.requestId === requestId) {
        inFlightRequestRef.current = null;
      }
    });

    return refreshPromiseRef.current;
  }, [clearAuthenticatedUser, hasSessionHint, persistAuthenticatedUser, sessionUser]);

  useEffect(() => {
    if (initialBootstrap.snapshotUser?.userId) {
      setSavedPlacesCacheUser(initialBootstrap.snapshotUser.userId);
    } else {
      setSavedPlacesCacheUser(null);
    }
    retryRefreshRef.current = (reason: string) => {
      void refreshSession({ reason, force: true, timeoutMs: 5000 });
    };
  }, [initialBootstrap.snapshotUser?.userId, refreshSession]);

  const setAuthenticatedUser = useCallback((user: SessionUser, options?: { reason?: string }) => {
    persistAuthenticatedUser(user, "authenticated", options?.reason || "local_update");
  }, [persistAuthenticatedUser]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } finally {
      clearAuthenticatedUser("logout");
    }
  }, [clearAuthenticatedUser]);

  useEffect(() => {
    logAuthTiming("storage_read", {
      storageReadMs: initialBootstrap.storageReadMs,
      hasSessionHint: initialBootstrap.hasSessionHint,
    });
  }, [initialBootstrap.hasSessionHint, initialBootstrap.storageReadMs]);

  useEffect(() => {
    if (didBootstrapRef.current) return;
    didBootstrapRef.current = true;
    void refreshSession({ reason: "app_bootstrap", force: true });
  }, [refreshSession]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refreshSession({ reason: "visibility_resume", force: true, timeoutMs: 4000 });
    };
    const handleOnline = () => {
      void refreshSession({ reason: "network_resume", force: true, timeoutMs: 4000 });
    };
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisible);
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
    };
  }, [refreshSession]);

  const value = useMemo<AuthContextValue>(() => ({
    authStatus,
    sessionUser,
    isAuthenticated,
    hasSessionHint,
    refreshSession,
    setAuthenticatedUser,
    logout,
  }), [authStatus, hasSessionHint, isAuthenticated, logout, refreshSession, sessionUser, setAuthenticatedUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
