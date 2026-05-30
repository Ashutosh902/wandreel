import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type ToastVariant = "success" | "error" | "info";

type ToastPayload = {
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
};

type ToastState = ToastPayload & { id: number };

type UxContextValue = {
  isOffline: boolean;
  showToast: (payload: ToastPayload) => void;
  currentLocationLabel: string;
  currentCoords: { lat: number; lng: number } | null;
  isLocating: boolean;
  requestCurrentLocation: () => Promise<void>;
};

const UxContext = createContext<UxContextValue | null>(null);
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
const LOCATION_CACHE_KEY = "wr_current_location_v1";

export function UxProvider({ children }: { children: React.ReactNode }) {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [currentLocationLabel, setCurrentLocationLabel] = useState("Patna, Bihar");
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const idRef = useRef(1);

  const clearToast = useCallback(() => setToast(null), []);

  const showToast = useCallback((payload: ToastPayload) => {
    setToast({
      id: idRef.current++,
      variant: "info",
      durationMs: 2600,
      ...payload,
    });
  }, []);

  const requestCurrentLocation = useCallback(async () => {
    if (!navigator.geolocation) return;
    setIsLocating(true);
    try {
      const coords = await new Promise<GeolocationCoordinates>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (position) => resolve(position.coords),
          (error) => reject(error),
          { enableHighAccuracy: true, timeout: 12000, maximumAge: 120000 },
        );
      });
      const nextCoords = { lat: coords.latitude, lng: coords.longitude };
      setCurrentCoords(nextCoords);
      const response = await fetch(
        `${API_BASE_URL}/api/location/reverse-geocode?lat=${encodeURIComponent(String(nextCoords.lat))}&lng=${encodeURIComponent(String(nextCoords.lng))}`,
      );
      if (response.ok) {
        const payload = (await response.json()) as { ok?: boolean; label?: string };
        if (payload?.ok && payload.label) {
          setCurrentLocationLabel(payload.label);
          window.localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({ ...nextCoords, label: payload.label }));
          return;
        }
      }
      window.localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({ ...nextCoords, label: currentLocationLabel }));
    } catch {
      // Keep fallback location silently.
    } finally {
      setIsLocating(false);
    }
  }, [currentLocationLabel]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(clearToast, toast.durationMs ?? 2600);
    return () => window.clearTimeout(timer);
  }, [clearToast, toast]);

  useEffect(() => {
    const onOffline = () => {
      setIsOffline(true);
      showToast({ message: "You’re offline. Saved places will sync later.", variant: "info", durationMs: 3200 });
    };
    const onOnline = () => {
      setIsOffline(false);
      showToast({ message: "Back online", variant: "success", durationMs: 2200 });
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [showToast]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LOCATION_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { lat?: number; lng?: number; label?: string };
      if (typeof parsed?.lat === "number" && typeof parsed?.lng === "number") {
        setCurrentCoords({ lat: parsed.lat, lng: parsed.lng });
      }
      if (typeof parsed?.label === "string" && parsed.label.trim()) {
        setCurrentLocationLabel(parsed.label.trim());
      }
    } catch {
      // Ignore bad cache.
    }
    void requestCurrentLocation();
  }, [requestCurrentLocation]);

  const value = useMemo<UxContextValue>(
    () => ({ isOffline, showToast, currentLocationLabel, currentCoords, isLocating, requestCurrentLocation }),
    [isOffline, showToast, currentLocationLabel, currentCoords, isLocating, requestCurrentLocation],
  );

  return (
    <UxContext.Provider value={value}>
      {children}
      {isOffline ? <div className="wr-offline-banner" role="status">You’re offline. Saved places will sync later.</div> : null}
      {toast ? (
        <div className={`wr-global-toast is-${toast.variant ?? "info"}`} role="status" aria-live="polite">
          <span>{toast.message}</span>
          {(toast.variant ?? "info") === "error" ? (
            <button type="button" className="wr-global-toast-close" onClick={clearToast} aria-label="Dismiss message">
              ×
            </button>
          ) : null}
        </div>
      ) : null}
    </UxContext.Provider>
  );
}

export function useUx() {
  const ctx = useContext(UxContext);
  if (!ctx) throw new Error("useUx must be used inside UxProvider");
  return ctx;
}
