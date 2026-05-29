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
};

const UxContext = createContext<UxContextValue | null>(null);

export function UxProvider({ children }: { children: React.ReactNode }) {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [toast, setToast] = useState<ToastState | null>(null);
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

  const value = useMemo<UxContextValue>(() => ({ isOffline, showToast }), [isOffline, showToast]);

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

