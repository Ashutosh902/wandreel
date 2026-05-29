import { useEffect, useState } from "react";
import { ChevronRight, LogIn, Mail, ShieldCheck, UserRound, X } from "lucide-react";
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
type SessionUser = {
  userId: string;
  customerId: string;
  email: string | null;
  emailVerified: boolean;
  phoneNumber: string | null;
  phoneVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  authProvider: string | null;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GOOGLE_OAUTH_SCOPE = "openid email profile";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";

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

function SettingSection({ title, rows }: { title: string; rows: ProfileSettingRow[] }) {
  return (
    <section className="wr-profile-section" aria-label={title}>
      <h3 className="wr-profile-section-title">{title}</h3>
      {rows.map((row) => (
        <button type="button" key={`${title}-${row.label}`} className="wr-profile-row">
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
  if (normalized.includes("failed to fetch") || normalized.includes("network")) return "Couldn't connect to Google. Please try again.";
  return "Couldn't connect to Google. Please try again.";
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
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [showBottomSheet, setShowBottomSheet] = useState(false);
  const [isSessionResolved, setIsSessionResolved] = useState(false);
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

  const greetingName = isLoggedIn ? sessionUser?.displayName || "Stroller" : "Stroller";

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
    resetToJoinStep();
  };

  const openSheet = () => {
    if (isLoggedIn) return;
    setShowBottomSheet(true);
    resetToJoinStep();
  };

  const syncSession = async ({ applyLoggedOutDefault = false }: { applyLoggedOutDefault?: boolean } = {}) => {
    try {
      const payload = await apiFetch("/api/auth/session/me");
      setSessionUser(payload.user as SessionUser);
      setIsLoggedIn(true);
      setDraftName(String(payload?.user?.displayName || "Stroller"));
      setShowBottomSheet(false);
    } catch {
      setSessionUser(null);
      setIsLoggedIn(false);
      setDraftName("Stroller");
      if (applyLoggedOutDefault) {
        setShowBottomSheet(openSheetOnMount);
      }
    } finally {
      setIsSessionResolved(true);
    }
  };

  useEffect(() => {
    void syncSession({ applyLoggedOutDefault: true });
  }, []);

  const continueWithGoogle = async () => {
    const googleClientId = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
    if (!googleClientId) {
      setEmailAuthMessage("Google login is not configured yet.");
      return;
    }

    const googleScriptSrc = "https://accounts.google.com/gsi/client";
    setIsSocialLoading(true);
    setEmailAuthMessage("");

    try {
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

      const google = (window as Window & { google?: any }).google;
      if (!google?.accounts?.oauth2?.initTokenClient) {
        throw new Error("Google login is not configured yet.");
      }

      const accessToken = await new Promise<string>((resolve, reject) => {
        const tokenClient = google.accounts.oauth2.initTokenClient({
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

      const payload = await apiFetch("/api/auth/google/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken }),
      });

      const user = payload.user as SessionUser;
      if (!user.displayName) {
        setPendingProvider("GOOGLE");
        setSheetMode("collectName");
        return;
      }

      await syncSession();
      closeSheet();
    } catch (error) {
      setEmailAuthMessage(toFriendlyGoogleError(error));
    } finally {
      setIsSocialLoading(false);
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
      setEmailAuthMessage(toFriendlyAuthError(error, "Could not send email OTP"));
    } finally {
      setIsEmailLoading(false);
    }
  };

  const verifyEmailOtpAndLogin = async () => {
    setIsEmailLoading(true);
    try {
      const payload = await apiFetch("/api/auth/email/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), otp: emailOtp.trim() }),
      });
      if (payload?.requiresDisplayName) {
        setPendingProvider("EMAIL");
        setDisplayNameInput("");
        setSheetMode("collectName");
        return;
      }
      await syncSession();
      closeSheet();
    } catch (error) {
      setEmailAuthMessage(toFriendlyAuthError(error, "Could not verify email OTP"));
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
      await apiFetch("/api/auth/profile/display-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name }),
      });
      await syncSession();
      closeSheet();
    } catch (error) {
      setEmailAuthMessage(toFriendlyAuthError(error, "Could not complete profile"));
    }
  };

  const logout = async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      setSessionUser(null);
      setIsLoggedIn(false);
      setDraftName("Stroller");
      setIsEditingName(false);
      setShowBottomSheet(openSheetOnMount);
      resetToJoinStep();
    }
  };

  return (
    <section className="wr-profile-screen" aria-label="Profile page">
      <header className="wr-profile-header">
        <h2>Profile</h2>
        <button type="button" className="wr-profile-user-btn" aria-label="Profile user options">
          <UserRound size={20} />
        </button>
      </header>

      <section className="wr-profile-greeting-block">
        {isEditingName ? (
          <div className="wr-profile-inline-edit">
            <input value={draftName} onChange={(event) => setDraftName(event.target.value)} className="wr-profile-name-input" aria-label="Edit profile name" />
            <button type="button" className="wr-profile-mini-btn" onClick={() => setIsEditingName(false)}>
              Save
            </button>
          </div>
        ) : (
          <h3>
            Hi, <strong>{greetingName}</strong>
          </h3>
        )}
        <p>Turn Reels, Shorts, TikToks and videos into your personal bucketlist.</p>

        {!isLoggedIn && !showBottomSheet ? (
          <button type="button" className="wr-profile-login-signup" onClick={openSheet}>
            <LogIn size={15} />
            Log in or sign up
          </button>
        ) : null}

        {isLoggedIn && !isEditingName ? (
          <button type="button" className="wr-profile-edit-name-btn" onClick={() => setIsEditingName(true)}>
            Edit name
          </button>
        ) : null}
      </section>

      <SettingSection title="Settings" rows={settingsRows} />
      <SettingSection title="Support" rows={supportRows} />
      <SettingSection title="Feedback" rows={feedbackRows} />
      <SettingSection title="Legal" rows={legalRows} />

      {isLoggedIn ? (
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

      {isSessionResolved && showBottomSheet ? (
        <>
          <button type="button" className="wr-login-sheet-backdrop" aria-label="Close login sheet backdrop" onClick={closeSheet} />
          <div className="wr-login-sheet" role="dialog" aria-modal="false" aria-label="Join Wandreel login sheet">
            <div className="wr-login-sheet-handle" />
            <button type="button" aria-label="Close login sheet" className="wr-login-sheet-close" onClick={closeSheet}>
              <X size={18} />
            </button>

            <p className="wr-login-sheet-kicker">JOIN WANDREEL</p>

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
              By continuing, you agree to our <button type="button">Terms</button> and <button type="button">Privacy Policy</button>.
            </p>

            <div className="wr-login-sheet-note">
              <ShieldCheck size={14} />
              <span>We'll only use login to keep your saved places private and synced.</span>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
