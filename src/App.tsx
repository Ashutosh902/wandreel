import { useEffect, useRef } from "react";
import "./App.css";
import { AppShell } from "./ui/layout/AppShell";
import { UxProvider } from "./ui/layout/UxProvider";
import { HomeScreen } from "./ui/home/HomeScreen";
import AdminPage from "./ui/admin/AdminPage";
import { AuthProvider, useAuth } from "./ui/auth/AuthProvider";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
const ADD_ANALYTICS_ANONYMOUS_ID_KEY = "wr_add_analytics_anonymous_id_v1";
const APP_OPENED_SESSION_KEY = "wr_app_opened_sent_v1";
const LOGIN_SEEN_SESSION_KEY = "wr_login_seen_sent_v1";

function getAnalyticsAnonymousId() {
  let existing = window.localStorage.getItem(ADD_ANALYTICS_ANONYMOUS_ID_KEY);
  if (existing) return existing;
  existing = `anon-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(ADD_ANALYTICS_ANONYMOUS_ID_KEY, existing);
  return existing;
}

async function postAppUsageEvent(eventType: "app_opened" | "login_seen") {
  try {
    const response = await fetch(`${API_BASE_URL}/api/analytics/app-event`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType,
        anonymousId: typeof window !== "undefined" ? getAnalyticsAnonymousId() : null,
      }),
    });
    const body = await response.json().catch(() => ({}));
    return response.ok && body?.ok && body?.recorded !== false;
  } catch {
    // Best-effort analytics should never interrupt app usage.
    return false;
  }
}

function AppUsageTracker() {
  const { sessionUser } = useAuth();
  const appOpenedInFlightRef = useRef(false);
  const loginSeenInFlightRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(APP_OPENED_SESSION_KEY)) return;
    if (appOpenedInFlightRef.current) return;
    appOpenedInFlightRef.current = true;
    void postAppUsageEvent("app_opened").then((recorded) => {
      if (recorded) {
        window.sessionStorage.setItem(APP_OPENED_SESSION_KEY, "1");
      }
      appOpenedInFlightRef.current = false;
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!sessionUser?.userId) return;
    if (window.sessionStorage.getItem(LOGIN_SEEN_SESSION_KEY)) return;
    if (loginSeenInFlightRef.current) return;
    loginSeenInFlightRef.current = true;
    void postAppUsageEvent("login_seen").then((recorded) => {
      if (recorded) {
        window.sessionStorage.setItem(LOGIN_SEEN_SESSION_KEY, "1");
      }
      loginSeenInFlightRef.current = false;
    });
  }, [sessionUser?.userId]);

  return null;
}

function App() {
  return (
    <UxProvider>
      <AuthProvider>
        <AppUsageTracker />
        <AppShell>
          {typeof window !== "undefined" && window.location.pathname.startsWith("/admin") ? (
            <AdminPage />
          ) : (
            <HomeScreen />
          )}
        </AppShell>
      </AuthProvider>
    </UxProvider>
  );
}

export default App;
