import { Capacitor } from "@capacitor/core";
import { SocialLogin, type GoogleLoginResponse } from "@capgo/capacitor-social-login";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronRight, LogIn, Mail, ShieldCheck, UserRound, X } from "lucide-react";
import { useUx } from "../layout/UxProvider";
import { useAuth } from "../auth/AuthProvider";
import {
  feedbackRows,
  legalRows,
  runProfileDataChecks,
  settingsRows,
  supportRows,
  type ProfileSettingRow,
} from "./profile.data";
import "./profile.css";

runProfileDataChecks();

type LoginProfileScreenProps = {
  openSheetOnMount?: boolean;
};

type SheetMode = "join" | "phone" | "collectName";
type Provider = "PHONE" | "EMAIL" | "GOOGLE" | "FACEBOOK" | "APPLE";
type LegalDocKey = "terms" | "privacy" | "oss";
type GoogleTokenClient = {
  requestAccessToken: () => void;
};
type GoogleOauthClient = {
  accounts?: {
    oauth2?: {
      initTokenClient?: (config: {
        client_id: string;
        scope: string;
        prompt: string;
        callback: (response: { access_token?: string; error?: string }) => void;
      }) => GoogleTokenClient;
    };
  };
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GOOGLE_OAUTH_SCOPE = "openid email profile";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
const GOOGLE_NATIVE_SCOPES = ["email", "profile"];
const GOOGLE_NATIVE_WEB_CLIENT_ID =
  String(import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();

let nativeGoogleInitPromise: Promise<void> | null = null;

function isNativeAndroidPlatform() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

function logNativeGoogleDevError(message: string, error: unknown, details?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  console.error("[google-native-auth]", {
    message,
    error: error instanceof Error ? error.message : String(error || ""),
    details: details ?? null,
  });
}

function logGoogleDevInfo(message: string, details?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  console.info(message, details ?? {});
}

async function ensureNativeGoogleInitialized() {
  if (!GOOGLE_NATIVE_WEB_CLIENT_ID) {
    throw new Error("Google login is not configured yet.");
  }
  if (!nativeGoogleInitPromise) {
    nativeGoogleInitPromise = SocialLogin.initialize({
      google: {
        webClientId: GOOGLE_NATIVE_WEB_CLIENT_ID,
        mode: "online",
      },
    }).catch((error) => {
      nativeGoogleInitPromise = null;
      throw error;
    });
  }
  return nativeGoogleInitPromise;
}

function GoogleBrandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="wr-login-social-icon">
      <path d="M21.6 12.23c0-.68-.06-1.34-.18-1.97H12v3.73h5.4a4.62 4.62 0 0 1-2 3.03v2.52h3.24c1.9-1.75 2.96-4.33 2.96-7.31Z" fill="#4285F4" />
      <path d="M12 22c2.7 0 4.96-.9 6.62-2.46l-3.24-2.52c-.9.6-2.06.95-3.38.95-2.6 0-4.8-1.75-5.58-4.1H3.08v2.58A10 10 0 0 0 12 22Z" fill="#34A853" />
      <path d="M6.42 13.87A5.99 5.99 0 0 1 6.1 12c0-.65.11-1.28.32-1.87V7.55H3.08A10 10 0 0 0 2 12c0 1.6.39 3.12 1.08 4.45l3.34-2.58Z" fill="#FBBC05" />
      <path d="M12 6.03c1.47 0 2.8.5 3.84 1.47l2.88-2.88C16.95 2.98 14.7 2 12 2a10 10 0 0 0-8.92 5.55l3.34 2.58c.78-2.35 2.98-4.1 5.58-4.1Z" fill="#EA4335" />
    </svg>
  );
}

function AppleBrandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="wr-login-social-icon">
      <path
        fill="currentColor"
        d="M16.36 12.86c.02 2.45 2.15 3.27 2.17 3.28-.02.06-.34 1.17-1.13 2.32-.68.99-1.38 1.98-2.48 2-1.08.02-1.43-.65-2.67-.65-1.24 0-1.63.63-2.63.67-1.06.04-1.87-1.06-2.55-2.05-1.39-2-2.45-5.64-1.03-8.11.7-1.22 1.96-2 3.33-2.02 1.04-.02 2.02.71 2.67.71.65 0 1.86-.87 3.14-.74.54.02 2.06.22 3.03 1.64-.08.05-1.8 1.05-1.78 2.95ZM14.6 6.02c.57-.69.95-1.64.85-2.6-.82.03-1.81.55-2.4 1.24-.52.6-.97 1.56-.85 2.48.91.07 1.83-.46 2.4-1.12Z"
      />
    </svg>
  );
}

function FacebookBrandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="wr-login-social-icon">
      <path fill="currentColor" d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.5-3.89 3.78-3.89 1.1 0 2.25.2 2.25.2v2.47H15.2c-1.25 0-1.64.77-1.64 1.57V12h2.8l-.45 2.89h-2.35v6.99A10 10 0 0 0 22 12Z" />
    </svg>
  );
}

function SettingSection({ title, rows, onRowPress }: { title: string; rows: ProfileSettingRow[]; onRowPress?: (row: ProfileSettingRow) => void }) {
  return (
    <section className="wr-profile-section" aria-label={title}>
      <h3 className="wr-profile-section-title">{title}</h3>
      {rows.map((row) => (
        <button type="button" key={`${title}-${row.label}`} className="wr-profile-row" onClick={() => onRowPress?.(row)}>
          <span>{row.label}</span>
          <span className="wr-profile-row-right">
            {row.value ? <span className="wr-profile-row-value">{row.value}</span> : null}
            <ChevronRight size={16} />
          </span>
        </button>
      ))}
    </section>
  );
}

function toFriendlyAuthError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  if (!message) return fallback;
  const normalized = message.toLowerCase();
  if (normalized.includes("failed to fetch") || normalized.includes("networkerror") || normalized.includes("network request")) {
    return "Couldn't connect. Please try again.";
  }
  return message;
}

function toFriendlyGoogleError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();
  if (normalized.includes("not configured")) return "Google login is not configured yet.";
  if (normalized.includes("popup_closed")) return "Google sign-in was cancelled.";
  if (normalized.includes("email is not verified")) return "Your Google email is not verified.";
  if (normalized.includes("audience mismatch")) return "Google login is configured for a different app build.";
  if (normalized.includes("invalid google id token") || normalized.includes("invalid google access token")) {
    return "Google sign-in could not be verified. Please try again.";
  }
  if (normalized.includes("failed to fetch") || normalized.includes("network")) return "Couldn't connect to Google. Please try again.";
  return "Couldn't connect to Google. Please try again.";
}

function toGoogleDebugErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      code: "code" in error ? String((error as { code?: unknown }).code ?? "") || null : null,
    };
  }
  if (typeof error === "object" && error) {
    return {
      name: "name" in error ? String((error as { name?: unknown }).name ?? "") || "UnknownError" : "UnknownError",
      message: "message" in error ? String((error as { message?: unknown }).message ?? "") : String(error),
      code: "code" in error ? String((error as { code?: unknown }).code ?? "") || null : null,
    };
  }
  return {
    name: "UnknownError",
    message: String(error ?? ""),
    code: null,
  };
}

function toGoogleNativeResultMetadata(result: GoogleLoginResponse | null | undefined) {
  if (!result) {
    return {
      hasResult: false,
      responseType: null,
      hasIdToken: false,
      hasAccessToken: false,
      accessTokenType: null,
      scopesCount: 0,
    };
  }

  const accessToken = "accessToken" in result ? result.accessToken?.token : undefined;
  const idToken = "idToken" in result ? result.idToken : undefined;

  return {
    hasResult: true,
    responseType: "responseType" in result ? String(result.responseType ?? "") || null : null,
    hasIdToken: typeof idToken === "string" && idToken.trim().length > 0,
    hasAccessToken: typeof accessToken === "string" && accessToken.trim().length > 0,
    accessTokenType:
      "accessToken" in result && result.accessToken && typeof result.accessToken.tokenType === "string"
        ? result.accessToken.tokenType
        : null,
    scopesCount:
      "grantedScopes" in result && Array.isArray(result.grantedScopes)
        ? result.grantedScopes.length
        : "scopes" in result && Array.isArray(result.scopes)
          ? result.scopes.length
          : 0,
  };
}

function getNativeGoogleAccessToken(result: GoogleLoginResponse | null | undefined) {
  if (!result || !("accessToken" in result)) {
    return "";
  }

  const rawAccessToken =
    typeof result.accessToken === "string"
      ? result.accessToken
      : result.accessToken && typeof result.accessToken.token === "string"
        ? result.accessToken.token
        : "";

  return rawAccessToken.trim();
}

async function apiFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || "Request failed");
  }
  return payload;
}

export function LoginProfileScreen({ openSheetOnMount = true }: LoginProfileScreenProps) {
  const { isOffline, showToast } = useUx();
  const { authStatus, sessionUser, isAuthenticated, hasSessionHint, refreshSession, setAuthenticatedUser, logout: logoutSession } = useAuth();
  const screenRef = useRef<HTMLElement | null>(null);
  const [showBottomSheet, setShowBottomSheet] = useState(false);
  const [hasDismissedAutoOpen, setHasDismissedAutoOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetMode>("join");

  const [phoneAuthMessage, setPhoneAuthMessage] = useState("");
  const [email, setEmail] = useState("");
  const [emailOtp, setEmailOtp] = useState("");
  const [emailAuthMessage, setEmailAuthMessage] = useState("");
  const [isEmailOtpRequested, setIsEmailOtpRequested] = useState(false);
  const [emailValidationError, setEmailValidationError] = useState("");
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [pendingProvider, setPendingProvider] = useState<Provider | null>(null);
  const [isSocialLoading, setIsSocialLoading] = useState(false);
  const [isEmailLoading, setIsEmailLoading] = useState(false);

  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState("Stroller");
  const [isSavingName, setIsSavingName] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [activeLegalDoc, setActiveLegalDoc] = useState<LegalDocKey | null>(null);
  const sheetTouchStartYRef = useRef<number | null>(null);
  const isLoggedIn = isAuthenticated;
  const isSessionResolved = authStatus !== "initializing";
  const isAuthHydrating = authStatus === "initializing" && !hasSessionHint;
  const isBottomSheetVisible = showBottomSheet || (isSessionResolved && !isLoggedIn && openSheetOnMount && !hasDismissedAutoOpen);
  const logLoginScreenState = useCallback((label: string) => {
    const overlayHost =
      typeof document !== "undefined" ? document.querySelector(".wr-phone-shell") ?? document.body : null;
    const serviceWorkerController =
      typeof navigator !== "undefined" && "serviceWorker" in navigator
        ? navigator.serviceWorker.controller?.scriptURL ?? null
        : null;

    console.log(label, {
      source: "LoginProfileScreen",
      viewport: typeof window !== "undefined" ? window.innerWidth : null,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      isLoggedIn,
      isSessionResolved,
      showBottomSheet,
      openSheetOnMount,
      sheetMode,
      overlayHostClass: overlayHost?.className || null,
      overlayHostTag: overlayHost?.tagName || null,
      googleClientConfigured: Boolean(String(import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim()),
      serviceWorkerController,
      standaloneDisplay:
        typeof window !== "undefined" && "matchMedia" in window
          ? window.matchMedia("(display-mode: standalone)").matches
          : null,
    });
  }, [isLoggedIn, isSessionResolved, openSheetOnMount, sheetMode, showBottomSheet]);

  const greetingName = isLoggedIn ? sessionUser?.displayName || "Stroller" : "Stroller";

  const openLegalDoc = (doc: LegalDocKey) => {
    setActiveLegalDoc(doc);
    setShowBottomSheet(false);
  };

  const resolveLegalDocFromLabel = (label: string): LegalDocKey | null => {
    const normalized = label.toLowerCase();
    if (normalized.includes("terms")) return "terms";
    if (normalized.includes("privacy")) return "privacy";
    if (normalized.includes("open-source")) return "oss";
    return null;
  };

  const activeLegalContent: Record<LegalDocKey, { title: string; effectiveDate: string; sections: Array<{ heading: string; body: string[] }> }> = {
    terms: {
      title: "Terms and Conditions",
      effectiveDate: "Effective date: May 29, 2026",
      sections: [
        {
          heading: "1. Acceptance of Terms",
          body: [
            "By accessing or using Wandreel, you agree to follow these terms and all applicable laws.",
            "If you do not agree, please stop using the service.",
          ],
        },
        {
          heading: "2. Account and Eligibility",
          body: [
            "You are responsible for maintaining accurate account information and safeguarding your login access.",
            "You must use Wandreel lawfully and must not misuse, reverse engineer, or disrupt the service.",
          ],
        },
        {
          heading: "3. User Content",
          body: [
            "You retain ownership of links, notes, and saved place metadata you provide to Wandreel.",
            "You grant Wandreel a limited right to process this data to deliver core product functionality.",
          ],
        },
        {
          heading: "4. Service Availability",
          body: [
            "We continuously improve Wandreel and may update, suspend, or discontinue specific features with reasonable notice when possible.",
            "Wandreel is provided on an 'as available' basis without guaranteed uninterrupted uptime.",
          ],
        },
      ],
    },
    privacy: {
      title: "Privacy Policy",
      effectiveDate: "Effective date: May 29, 2026",
      sections: [
        {
          heading: "1. Information We Collect",
          body: [
            "We collect account details (for example: email, display name, avatar) and app data required to save and organize places.",
            "Authentication and session cookies are used to securely identify you across app sessions.",
          ],
        },
        {
          heading: "2. How We Use Data",
          body: [
            "Your information is used to provide login, synchronization, personalization, and core Wandreel features.",
            "We do not sell your personal data.",
          ],
        },
        {
          heading: "3. Security and Retention",
          body: [
            "We use secure session handling and server-side identity checks for protected user operations.",
            "Data is retained only as needed for product operations, legal obligations, or your account lifecycle.",
          ],
        },
        {
          heading: "4. Contact",
          body: ["For privacy-related requests, contact support via the in-app Help Center."],
        },
      ],
    },
    oss: {
      title: "Open-source Libraries",
      effectiveDate: "Updated: May 29, 2026",
      sections: [
        {
          heading: "Core Frontend",
          body: ["React, React DOM, Vite, TypeScript, Lucide React, Framer Motion."],
        },
        {
          heading: "Backend and Data",
          body: ["Express, PostgreSQL client (pg), Zod, XLSX, Dotenv, OpenAI SDK."],
        },
        {
          heading: "Build and Tooling",
          body: ["ESLint, Wrangler, Vite PWA, TSX and related TypeScript tooling."],
        },
        {
          heading: "Licenses",
          body: ["Each dependency remains under its respective open-source license. Full attribution is available in project dependency manifests."],
        },
      ],
    },
  };

  const resetToJoinStep = () => {
    setSheetMode("join");
    setPhoneAuthMessage("");
    setEmailAuthMessage("");
    setEmailOtp("");
    setIsEmailOtpRequested(false);
    setEmailValidationError("");
    setDisplayNameInput("");
    setPendingProvider(null);
  };

  const closeSheet = () => {
    setShowBottomSheet(false);
    setHasDismissedAutoOpen(true);
    resetToJoinStep();
    logLoginScreenState("LoginProfileScreen close sheet");
  };

  const openSheet = () => {
    if (isLoggedIn) return;
    setHasDismissedAutoOpen(false);
    setShowBottomSheet(true);
    resetToJoinStep();
    logLoginScreenState("LoginProfileScreen open sheet");
  };

  useEffect(() => {
    logLoginScreenState("LoginProfileScreen mounted");
  }, [logLoginScreenState]);

  useEffect(() => {
    if (!isSessionResolved) return;
    logLoginScreenState("LoginProfileScreen state changed");
  }, [isSessionResolved, logLoginScreenState]);

  useEffect(() => {
    if (!activeLegalDoc) return;
    const resetScrollTop = () => {
      screenRef.current?.scrollTo({ top: 0, behavior: "auto" });
      const scrollSurface = screenRef.current?.closest(".wr-home-surface, .wr-page-scroll") as HTMLElement | null;
      scrollSurface?.scrollTo({ top: 0, behavior: "auto" });
      window.scrollTo({ top: 0, behavior: "auto" });
    };
    resetScrollTop();
    requestAnimationFrame(resetScrollTop);
  }, [activeLegalDoc]);

  const continueWithGoogle = async () => {
    const nativeAndroid = isNativeAndroidPlatform();
    let shouldKeepPendingProvider = false;
    logGoogleDevInfo("[google-login] handler start", {
      nativeAndroid,
      capacitorNativePlatform: Capacitor.isNativePlatform(),
      platform: Capacitor.getPlatform(),
      offline: isOffline,
      socialLoading: isSocialLoading,
    });
    if (isOffline) {
      setEmailAuthMessage("Couldn’t connect to Google. Please try again.");
      showToast({ message: "Couldn’t connect. Please try again.", variant: "error" });
      return;
    }

    setIsSocialLoading(true);
    setPendingProvider(null);
    setEmailAuthMessage("");

    try {
      let payload: Awaited<ReturnType<typeof apiFetch>>;

      if (nativeAndroid) {
        logGoogleDevInfo("[google-login] selected native Android / Capacitor path");
        await ensureNativeGoogleInitialized();
        const login = await SocialLogin.login({
          provider: "google",
          options: {
            scopes: GOOGLE_NATIVE_SCOPES,
            style: "standard",
            filterByAuthorizedAccounts: false,
          },
        });
        const loginResult = login.result as GoogleLoginResponse;
        const loginResultObject = login.result as unknown as Record<string, unknown> | null | undefined;
        const accessTokenValue = loginResultObject?.accessToken;
        logGoogleDevInfo("[google-login] native result metadata", toGoogleNativeResultMetadata(loginResult));
        logGoogleDevInfo("[google-login] native result shape", {
          resultKeys: loginResultObject ? Object.keys(loginResultObject) : [],
          accessTokenKeys:
            accessTokenValue && typeof accessTokenValue === "object"
              ? Object.keys(accessTokenValue as Record<string, unknown>)
              : [],
          accessTokenType: typeof accessTokenValue,
          hasAccessTokenToken:
            Boolean(accessTokenValue) &&
            typeof accessTokenValue === "object" &&
            Boolean((accessTokenValue as { token?: unknown }).token),
          hasIdToken: typeof loginResultObject?.idToken === "string" && loginResultObject.idToken.trim().length > 0,
        });
        const idToken =
          loginResult && "idToken" in loginResult && typeof loginResult.idToken === "string"
            ? loginResult.idToken.trim()
            : "";
        const accessToken = getNativeGoogleAccessToken(loginResult);

        if (!accessToken) {
          console.error("[google-login] native result missing usable access token", {
            hasIdToken: idToken.length > 0,
            metadata: toGoogleNativeResultMetadata(loginResult),
          });
          throw new Error("Google sign-in did not return a usable access token.");
        }

        logGoogleDevInfo("[google-login] native verify payload shape", {
          usesIdToken: false,
          usesAccessToken: accessToken.length > 0,
          selectedField: "accessToken",
        });
        payload = await apiFetch("/api/auth/google/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken }),
        });
      } else {
        logGoogleDevInfo("[google-login] selected browser web path");
        const googleClientId = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
        if (!googleClientId) {
          throw new Error("Google login is not configured yet.");
        }

        const googleScriptSrc = "https://accounts.google.com/gsi/client";
        if (!(window as Window & { google?: unknown }).google) {
          await new Promise<void>((resolve, reject) => {
            const existing = document.querySelector<HTMLScriptElement>(`script[src="${googleScriptSrc}"]`);
            if (existing) {
              existing.addEventListener("load", () => resolve(), { once: true });
              existing.addEventListener("error", () => reject(new Error("Could not load Google SDK")), { once: true });
              return;
            }
            const script = document.createElement("script");
            script.src = googleScriptSrc;
            script.async = true;
            script.defer = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("Could not load Google SDK"));
            document.head.appendChild(script);
          });
        }

        const google = (window as Window & { google?: GoogleOauthClient }).google;
        const initTokenClient = google?.accounts?.oauth2?.initTokenClient;
        if (!initTokenClient) {
          throw new Error("Google login is not configured yet.");
        }

        const accessToken = await new Promise<string>((resolve, reject) => {
          const tokenClient = initTokenClient({
            client_id: googleClientId,
            scope: GOOGLE_OAUTH_SCOPE,
            prompt: "select_account",
            callback: (response: { access_token?: string; error?: string }) => {
              if (response?.error) {
                reject(new Error(response.error));
                return;
              }
              if (!response?.access_token) {
                reject(new Error("Missing Google access token"));
                return;
              }
              resolve(response.access_token);
            },
          });
          tokenClient.requestAccessToken();
        });

        payload = await apiFetch("/api/auth/google/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken }),
        });
      }

      const user = payload.user;
      setAuthenticatedUser(user, { reason: "google_verify" });
      if (!user.displayName) {
        shouldKeepPendingProvider = true;
        setPendingProvider("GOOGLE");
        setSheetMode("collectName");
        return;
      }

      void refreshSession({ reason: "google_verify_refresh", force: true });
      closeSheet();
    } catch (error) {
      console.error("[google-login] handler failed", toGoogleDebugErrorDetails(error));
      if (nativeAndroid) {
        logNativeGoogleDevError("native google sign-in failed", error, {
          platform: Capacitor.getPlatform(),
          googleNativeConfigured: Boolean(GOOGLE_NATIVE_WEB_CLIENT_ID),
        });
      }
      const message = toFriendlyGoogleError(error);
      setEmailAuthMessage(message);
      showToast({ message, variant: "error" });
    } finally {
      setIsSocialLoading(false);
      if (!shouldKeepPendingProvider) {
        setPendingProvider(null);
      }
    }
  };

  const continueWithProvider = async (provider: Provider) => {
    if (isSocialLoading) return;
    if (provider === "GOOGLE") {
      await continueWithGoogle();
      return;
    }
    if (provider === "APPLE") {
      setPendingProvider("APPLE");
      setDisplayNameInput("");
      setSheetMode("collectName");
      return;
    }
    if (provider === "FACEBOOK") {
      setEmailAuthMessage("Facebook login is not configured yet.");
      return;
    }
  };

  const sendEmailOtp = async () => {
    const nextEmail = email.trim();
    if (!EMAIL_PATTERN.test(nextEmail)) {
      setEmailValidationError("Please enter a valid email address.");
      setEmailAuthMessage("");
      return;
    }
    if (isOffline) {
      const message = "Couldn’t connect. Please try again.";
      setEmailAuthMessage(message);
      showToast({ message, variant: "error" });
      return;
    }
    setEmailValidationError("");
    setIsEmailLoading(true);
    try {
      const payload = await apiFetch("/api/auth/email/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: nextEmail }),
      });
      setIsEmailOtpRequested(true);
      setEmailAuthMessage(payload?.otpPreview ? `OTP generated for testing: ${payload.otpPreview}` : `OTP sent to ${nextEmail}.`);
    } catch (error) {
      const message = toFriendlyAuthError(error, "Couldn’t connect. Please try again.");
      setEmailAuthMessage(message);
      showToast({ message, variant: "error" });
    } finally {
      setIsEmailLoading(false);
    }
  };

  const verifyEmailOtpAndLogin = async () => {
    if (isOffline) {
      const message = "Couldn’t connect. Please try again.";
      setEmailAuthMessage(message);
      showToast({ message, variant: "error" });
      return;
    }
    setIsEmailLoading(true);
    try {
      const payload = await apiFetch("/api/auth/email/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), otp: emailOtp.trim() }),
      });
      setAuthenticatedUser(payload.user, { reason: "email_verify" });
      if (payload?.requiresDisplayName) {
        setPendingProvider("EMAIL");
        setDisplayNameInput("");
        setSheetMode("collectName");
        return;
      }
      void refreshSession({ reason: "email_verify_refresh", force: true });
      closeSheet();
    } catch (error) {
      const message = toFriendlyAuthError(error, "Invalid or expired code.");
      setEmailAuthMessage(message);
      showToast({ message, variant: "error" });
    } finally {
      setIsEmailLoading(false);
    }
  };

  const submitDisplayName = async () => {
    const name = displayNameInput.trim();
    if (!name || !pendingProvider) {
      setEmailAuthMessage("Please enter your name");
      return;
    }
    try {
      const payload = await apiFetch("/api/auth/profile/display-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name }),
      });
      setAuthenticatedUser(payload.user, { reason: "display_name_submit" });
      closeSheet();
    } catch (error) {
      setEmailAuthMessage(toFriendlyAuthError(error, "Could not complete profile"));
    }
  };

  const saveInlineDisplayName = async () => {
    const name = draftName.trim();
    if (!name || !isLoggedIn) {
      setIsEditingName(false);
      return;
    }
    setIsSavingName(true);
    try {
      const payload = await apiFetch("/api/auth/profile/display-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name }),
      });
      setAuthenticatedUser(payload.user, { reason: "display_name_inline" });
      setIsEditingName(false);
    } finally {
      setIsSavingName(false);
    }
  };

  const logout = async () => {
    try {
      await logoutSession();
    } finally {
      setDraftName("Stroller");
      setIsEditingName(false);
      setIsSavingName(false);
      setShowBottomSheet(false);
      setHasDismissedAutoOpen(false);
      resetToJoinStep();
    }
  };

  useEffect(() => {
    if (!isBottomSheetVisible || isLoggedIn !== false) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const surface = document.querySelector(".wr-home-surface") as HTMLDivElement | null;
    const previousSurfaceOverflow = surface?.style.overflow;
    const previousSurfaceTouchAction = surface?.style.touchAction;
    const previousSurfaceOverscroll = surface?.style.overscrollBehavior;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    if (surface) {
      surface.style.overflow = "hidden";
      surface.style.touchAction = "none";
      surface.style.overscrollBehavior = "none";
    }

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      if (surface) {
        surface.style.overflow = previousSurfaceOverflow || "";
        surface.style.touchAction = previousSurfaceTouchAction || "";
        surface.style.overscrollBehavior = previousSurfaceOverscroll || "";
      }
    };
  }, [isBottomSheetVisible, isLoggedIn]);

  const loginSheetOverlay = isSessionResolved && isLoggedIn === false && isBottomSheetVisible ? (
    <>
      <button type="button" className="wr-login-sheet-backdrop" aria-label="Close login sheet backdrop" onClick={closeSheet} />
      <div className="wr-login-sheet-layer" role="presentation">
        <div className="wr-login-sheet" role="dialog" aria-modal="false" aria-label="Join Wandreel login sheet">
        <div
          className="wr-login-sheet-gesture-zone"
          onTouchStart={(event) => {
            sheetTouchStartYRef.current = event.touches[0].clientY;
          }}
          onTouchEnd={(event) => {
            if (sheetTouchStartYRef.current === null) return;
            const deltaY = event.changedTouches[0].clientY - sheetTouchStartYRef.current;
            sheetTouchStartYRef.current = null;
            if (deltaY > 72) closeSheet();
          }}
        />
          <div className="wr-login-sheet-handle" />
          <button type="button" aria-label="Close login sheet" className="wr-login-sheet-close" onClick={closeSheet}>
            <X size={18} />
          </button>

          <p className="wr-login-sheet-kicker">JOIN WANDREEL</p>
          <div className="wr-login-sheet-body">
            {sheetMode === "join" ? (
              <>
                <h4>Save your scrolls. Start your strolls.</h4>
                <p className="wr-login-sheet-desc">Log in to sync your saved reels, city bucketlists, and places across devices.</p>
                <div className="wr-login-social-row" aria-label="Social login options">
                  <button type="button" disabled={isSocialLoading} className="wr-login-social-btn wr-login-social-google" onClick={() => void continueWithProvider("GOOGLE")} aria-label="Continue with Google">
                    <GoogleBrandIcon />
                  </button>
                  <button type="button" disabled={isSocialLoading} className="wr-login-social-btn wr-login-social-apple" onClick={() => void continueWithProvider("APPLE")} aria-label="Continue with Apple">
                    <AppleBrandIcon />
                  </button>
                  <button type="button" disabled={isSocialLoading} className="wr-login-social-btn wr-login-social-facebook" onClick={() => void continueWithProvider("FACEBOOK")} aria-label="Continue with Facebook">
                    <FacebookBrandIcon />
                  </button>
                </div>
                <input
                  type="email"
                  className="wr-login-sheet-input"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setEmailAuthMessage("");
                    setEmailValidationError("");
                  }}
                  placeholder="Email address"
                  aria-label="Email address"
                />
                {emailValidationError ? <p className="wr-login-sheet-error">{emailValidationError}</p> : null}
                {isEmailOtpRequested ? (
                  <input
                    type="text"
                    inputMode="numeric"
                    className="wr-login-sheet-input"
                    value={emailOtp}
                    onChange={(event) => setEmailOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="Enter 6 digit OTP"
                    aria-label="Email OTP"
                  />
                ) : null}
                <div className="wr-login-sheet-actions">
                  {!isEmailOtpRequested ? (
                    <button type="button" disabled={isEmailLoading} className="wr-login-sheet-secondary" onClick={() => void sendEmailOtp()}>
                      <Mail size={15} />
                      {isEmailLoading ? "Please wait..." : "Continue with email"}
                    </button>
                  ) : (
                    <button type="button" disabled={isEmailLoading} className="wr-login-sheet-primary" onClick={() => void verifyEmailOtpAndLogin()}>
                      {isEmailLoading ? "Please wait..." : "Verify email OTP"}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="wr-login-sheet-phone-link"
                  onClick={() => {
                    setPhoneAuthMessage("Phone login is optional and will be enabled in a later phase.");
                    setSheetMode("phone");
                  }}
                >
                  Use phone instead
                </button>
                {emailAuthMessage ? <p className="wr-login-sheet-desc">{emailAuthMessage}</p> : null}
              </>
            ) : null}

            {sheetMode === "phone" ? (
              <>
                <h4>Continue with phone</h4>
                <p className="wr-login-sheet-desc">{phoneAuthMessage || "Phone OTP will be enabled as optional account linking in a later phase."}</p>
                <div className="wr-login-sheet-actions">
                  <button type="button" className="wr-login-sheet-secondary" onClick={() => setSheetMode("join")}>
                    Back
                  </button>
                </div>
              </>
            ) : null}

            {sheetMode === "collectName" ? (
              <>
                <h4>What should we call you?</h4>
                <p className="wr-login-sheet-desc">This helps us personalize your Wandreel experience.</p>
                <input type="text" className="wr-login-sheet-input" value={displayNameInput} onChange={(event) => setDisplayNameInput(event.target.value)} placeholder="Your name" aria-label="Your name" />
                <div className="wr-login-sheet-actions">
                  <button type="button" className="wr-login-sheet-primary" onClick={() => void submitDisplayName()}>
                    Continue
                  </button>
                  <button type="button" className="wr-login-sheet-secondary" onClick={() => setSheetMode("join")}>
                    Back
                  </button>
                </div>
                {emailAuthMessage ? <p className="wr-login-sheet-desc">{emailAuthMessage}</p> : null}
              </>
            ) : null}

            <p className="wr-login-sheet-legal">
              By continuing, you agree to our{" "}
              <button type="button" onClick={() => openLegalDoc("terms")}>
                Terms
              </button>{" "}
              and{" "}
              <button type="button" onClick={() => openLegalDoc("privacy")}>
                Privacy Policy
              </button>
              .
            </p>

            <div className="wr-login-sheet-note">
              <ShieldCheck size={14} />
              <span>We'll only use login to keep your saved places private and synced.</span>
            </div>
          </div>
        </div>
      </div>
    </>
  ) : null;

  const overlayTarget =
    typeof document !== "undefined" ? document.querySelector(".wr-phone-shell") ?? document.body : null;

  return (
    <section ref={screenRef} className="wr-profile-screen" aria-label="Profile page">
      {activeLegalDoc ? (
        <section className="wr-legal-screen" aria-label={activeLegalContent[activeLegalDoc].title}>
          <header className="wr-legal-header">
            <button type="button" className="wr-legal-back-btn" onClick={() => setActiveLegalDoc(null)} aria-label="Back to profile legal section">
              <ArrowLeft size={18} />
            </button>
            <h2>{activeLegalContent[activeLegalDoc].title}</h2>
          </header>
          <section className="wr-legal-content">
            <p className="wr-legal-effective">{activeLegalContent[activeLegalDoc].effectiveDate}</p>
            {activeLegalContent[activeLegalDoc].sections.map((section) => (
              <article className="wr-legal-section" key={section.heading}>
                <h3>{section.heading}</h3>
                {section.body.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </article>
            ))}
          </section>
        </section>
      ) : null}
      {!activeLegalDoc ? (
        <>
      <header className="wr-profile-header">
        <h2>Profile</h2>
        <button type="button" className="wr-profile-user-btn" aria-label="Profile user options">
          <UserRound size={20} />
        </button>
      </header>

      {isAuthHydrating ? (
        <section className="wr-profile-loading-state" aria-label="Loading profile">
          <div className="wr-profile-loading-card">
            <p className="wr-profile-loading-copy">Getting your profile ready...</p>
            <div className="wr-profile-skeleton-wrap" aria-hidden="true">
              <span className="wr-profile-skeleton title" />
              <span className="wr-profile-skeleton copy" />
              <span className="wr-profile-skeleton copy short" />
            </div>
          </div>
          <div className="wr-profile-loading-section" aria-hidden="true">
            <span className="wr-profile-loading-section-title" />
            <span className="wr-profile-loading-row" />
            <span className="wr-profile-loading-row" />
            <span className="wr-profile-loading-row short" />
          </div>
        </section>
      ) : (
        <>
          <section className="wr-profile-greeting-block">
            {isEditingName ? (
              <div className="wr-profile-inline-edit">
                <input value={draftName} onChange={(event) => setDraftName(event.target.value)} className="wr-profile-name-input" aria-label="Edit profile name" />
                <button type="button" className="wr-profile-mini-btn" onClick={() => void saveInlineDisplayName()} disabled={isSavingName}>
                  {isSavingName ? "Saving..." : "Save"}
                </button>
              </div>
            ) : (
              <h3>
                Hi, <strong>{greetingName}</strong>
              </h3>
            )}
            <p>Turn Reels, Shorts, TikToks and videos into your personal bucketlist.</p>

            {isLoggedIn === false && !isBottomSheetVisible ? (
              <button type="button" className="wr-profile-login-signup" onClick={openSheet}>
                <LogIn size={15} />
                Log in or sign up
              </button>
            ) : null}

            {isLoggedIn === true && !isEditingName ? (
              <button
                type="button"
                className="wr-profile-edit-name-btn"
                onClick={() => {
                  setDraftName(String(sessionUser?.displayName || "Stroller"));
                  setIsEditingName(true);
                }}
              >
                Edit name
              </button>
            ) : null}
          </section>

          <SettingSection title="Settings" rows={settingsRows} />
          <section className="wr-profile-section" aria-label="Settings notifications toggle">
            <button
              type="button"
              className="wr-profile-row wr-profile-row-toggle"
              onClick={() => setNotificationsEnabled((current) => !current)}
              aria-pressed={notificationsEnabled}
              aria-label={`Notifications ${notificationsEnabled ? "on" : "off"}`}
            >
              <span>Notifications</span>
              <span className="wr-profile-row-right">
                <span className={`wr-notification-state ${notificationsEnabled ? "is-on" : "is-off"}`}>
                  {notificationsEnabled ? "ON" : "OFF"}
                </span>
                <span className={`wr-notification-switch ${notificationsEnabled ? "is-on" : "is-off"}`} aria-hidden="true">
                  <span className="wr-notification-switch-thumb" />
                </span>
              </span>
            </button>
          </section>
          <SettingSection title="Support" rows={supportRows} />
          <SettingSection title="Feedback" rows={feedbackRows} />
          <SettingSection
            title="Legal"
            rows={legalRows}
            onRowPress={(row) => {
              const doc = resolveLegalDocFromLabel(row.label);
              if (doc) openLegalDoc(doc);
            }}
          />

          {isLoggedIn === true ? (
            <section className="wr-profile-section" aria-label="Account actions">
              <button type="button" className="wr-profile-row wr-profile-logout" onClick={logout}>
                <span>Log out</span>
                <span className="wr-profile-row-right">
                  <ChevronRight size={16} />
                </span>
              </button>
            </section>
          ) : null}

          <footer className="wr-profile-version">Version 0.1.0</footer>
        </>
      )}

        </>
      ) : null}
      {overlayTarget && loginSheetOverlay ? createPortal(loginSheetOverlay, overlayTarget) : null}
    </section>
  );
}
