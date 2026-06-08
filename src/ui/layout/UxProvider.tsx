import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type ToastVariant = "success" | "error" | "info";

type ToastPayload = {
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
};

type ToastState = ToastPayload & { id: number };
type CurrentLocationRequestResult = {
  ok: boolean;
  reason?: "permission_denied" | "unavailable" | "failed";
  coords?: { lat: number; lng: number };
  label?: string | null;
};

type UxContextValue = {
  isOffline: boolean;
  showToast: (payload: ToastPayload) => void;
  currentLocationLabel: string;
  currentCoords: { lat: number; lng: number } | null;
  deviceLocationLabel: string | null;
  deviceCoords: { lat: number; lng: number } | null;
  isLocating: boolean;
  requestCurrentLocation: () => Promise<CurrentLocationRequestResult>;
  searchLocations: (query: string) => Promise<Array<{ placeId: string; label: string; secondaryText: string | null; description: string | null }>>;
  setLocationFromPlaceId: (placeId: string) => Promise<boolean>;
  useDeviceLocationAsCurrent: (options?: { forceRefresh?: boolean }) => Promise<CurrentLocationRequestResult>;
};

const UxContext = createContext<UxContextValue | null>(null);
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
const LOCATION_CACHE_KEY = "wr_current_location_v1";
const DEVICE_LOCATION_CACHE_KEY = "wr_device_location_v1";
const LOCATION_MODE_CACHE_KEY = "wr_location_mode_v1";

export function UxProvider({ children }: { children: React.ReactNode }) {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [currentLocationLabel, setCurrentLocationLabel] = useState("Patna, Bihar");
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [deviceLocationLabel, setDeviceLocationLabel] = useState<string | null>(null);
  const [deviceCoords, setDeviceCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationMode, setLocationMode] = useState<"device" | "manual">("device");
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

  const requestCurrentLocation = useCallback(async (): Promise<CurrentLocationRequestResult> => {
    if (!navigator.geolocation) {
      return { ok: false, reason: "unavailable" };
    }
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
      setDeviceCoords(nextCoords);
      let resolvedLabel: string | null = null;
      const response = await fetch(
        `${API_BASE_URL}/api/location/reverse-geocode?lat=${encodeURIComponent(String(nextCoords.lat))}&lng=${encodeURIComponent(String(nextCoords.lng))}`,
      );
      if (response.ok) {
        const payload = (await response.json()) as { ok?: boolean; label?: string };
        if (payload?.ok && payload.label) {
          resolvedLabel = payload.label;
          setDeviceLocationLabel(payload.label);
          window.localStorage.setItem(DEVICE_LOCATION_CACHE_KEY, JSON.stringify({ ...nextCoords, label: payload.label }));
          if (locationMode === "device") {
            setCurrentCoords(nextCoords);
            setCurrentLocationLabel(payload.label);
            window.localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({ ...nextCoords, label: payload.label }));
          }
          return { ok: true, coords: nextCoords, label: payload.label };
        }
      }
      window.localStorage.setItem(DEVICE_LOCATION_CACHE_KEY, JSON.stringify({ ...nextCoords, label: currentLocationLabel }));
      if (locationMode === "device") {
        setCurrentCoords(nextCoords);
        window.localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({ ...nextCoords, label: currentLocationLabel }));
      }
      return { ok: true, coords: nextCoords, label: resolvedLabel || currentLocationLabel };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && Number((error as GeolocationPositionError).code) === 1) {
        return { ok: false, reason: "permission_denied" };
      }
      return { ok: false, reason: "failed" };
    } finally {
      setIsLocating(false);
    }
  }, [currentLocationLabel, locationMode]);

  const searchLocations = useCallback(async (query: string) => {
    const q = query.trim();
    if (q.length < 2) return [];
    const response = await fetch(`${API_BASE_URL}/api/location/suggest?q=${encodeURIComponent(q)}`);
    if (!response.ok) {
      throw new Error("location_suggest_unavailable");
    }
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
      suggestions?: Array<{ placeId?: string; label?: string; secondaryText?: string | null; description?: string | null }>;
    };
    if (!payload?.ok) {
      throw new Error(payload?.error || "location_suggest_unavailable");
    }
    if (!Array.isArray(payload.suggestions)) return [];
    return payload.suggestions
      .map((item) => ({
        placeId: String(item.placeId || ""),
        label: String(item.label || "").trim(),
        secondaryText: item.secondaryText ?? null,
        description: item.description ?? null,
      }))
      .filter((item) => item.placeId && item.label);
  }, []);

  const setLocationFromPlaceId = useCallback(async (placeId: string) => {
    const id = placeId.trim();
    if (!id) return false;
    try {
      const response = await fetch(`${API_BASE_URL}/api/location/resolve-place?placeId=${encodeURIComponent(id)}`);
      if (!response.ok) return false;
      const payload = (await response.json()) as { ok?: boolean; label?: string; location?: { lat?: number; lng?: number } };
      const lat = payload.location?.lat;
      const lng = payload.location?.lng;
      if (!payload?.ok || !payload.label || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      const nextCoords = { lat: Number(lat), lng: Number(lng) };
      setLocationMode("manual");
      window.localStorage.setItem(LOCATION_MODE_CACHE_KEY, "manual");
      setCurrentCoords(nextCoords);
      setCurrentLocationLabel(payload.label);
      window.localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({ ...nextCoords, label: payload.label }));
      return true;
    } catch {
      return false;
    }
  }, []);

  const useDeviceLocationAsCurrent = useCallback(async (options?: { forceRefresh?: boolean }): Promise<CurrentLocationRequestResult> => {
    setLocationMode("device");
    window.localStorage.setItem(LOCATION_MODE_CACHE_KEY, "device");
    if (!options?.forceRefresh && deviceCoords && deviceLocationLabel) {
      setCurrentCoords(deviceCoords);
      setCurrentLocationLabel(deviceLocationLabel);
      window.localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({ ...deviceCoords, label: deviceLocationLabel }));
      return { ok: true, coords: deviceCoords, label: deviceLocationLabel };
    }
    const result = await requestCurrentLocation();
    if (result.ok && result.coords) {
      setCurrentCoords(result.coords);
      if (result.label) {
        setCurrentLocationLabel(result.label);
      }
      window.localStorage.setItem(
        LOCATION_CACHE_KEY,
        JSON.stringify({ ...result.coords, label: result.label || currentLocationLabel }),
      );
    }
    return result;
  }, [currentLocationLabel, deviceCoords, deviceLocationLabel, requestCurrentLocation]);

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
    let loadedMode: "device" | "manual" = "device";
    try {
      const raw = window.localStorage.getItem(LOCATION_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { lat?: number; lng?: number; label?: string };
        if (typeof parsed?.lat === "number" && typeof parsed?.lng === "number") {
          setCurrentCoords({ lat: parsed.lat, lng: parsed.lng });
        }
        if (typeof parsed?.label === "string" && parsed.label.trim()) {
          setCurrentLocationLabel(parsed.label.trim());
        }
      }
      const mode = window.localStorage.getItem(LOCATION_MODE_CACHE_KEY);
      if (mode === "manual" || mode === "device") {
        loadedMode = mode;
        setLocationMode(mode);
      }
      const rawDevice = window.localStorage.getItem(DEVICE_LOCATION_CACHE_KEY);
      if (rawDevice) {
        const parsedDevice = JSON.parse(rawDevice) as { lat?: number; lng?: number; label?: string };
        if (typeof parsedDevice?.lat === "number" && typeof parsedDevice?.lng === "number") {
          setDeviceCoords({ lat: parsedDevice.lat, lng: parsedDevice.lng });
        }
        if (typeof parsedDevice?.label === "string" && parsedDevice.label.trim()) {
          setDeviceLocationLabel(parsedDevice.label.trim());
        }
      }
    } catch {
      // Ignore bad cache.
    }
    if (loadedMode === "device") {
      void requestCurrentLocation();
    }
  }, [requestCurrentLocation]);

  const value = useMemo<UxContextValue>(
    () => ({
      isOffline,
      showToast,
      currentLocationLabel,
      currentCoords,
      deviceLocationLabel,
      deviceCoords,
      isLocating,
      requestCurrentLocation,
      searchLocations,
      setLocationFromPlaceId,
      useDeviceLocationAsCurrent,
    }),
    [
      isOffline,
      showToast,
      currentLocationLabel,
      currentCoords,
      deviceLocationLabel,
      deviceCoords,
      isLocating,
      requestCurrentLocation,
      searchLocations,
      setLocationFromPlaceId,
      useDeviceLocationAsCurrent,
    ],
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
