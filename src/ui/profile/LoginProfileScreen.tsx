import { useMemo, useState } from "react";
import { ChevronRight, LogIn, Mail, Phone, ShieldCheck, UserRound, X } from "lucide-react";
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

type SheetMode = "join" | "phone" | "emailOptions" | "emailOtp";

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

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function deriveFirstNameFromEmail(value: string): string {
  const prefix = value.includes("@") ? value.split("@")[0] : value;
  const firstToken = prefix.split(/[._-]/).filter(Boolean)[0] ?? "Stroller";
  return firstToken.charAt(0).toUpperCase() + firstToken.slice(1).toLowerCase();
}

export function LoginProfileScreen({ openSheetOnMount = true }: LoginProfileScreenProps) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showBottomSheet, setShowBottomSheet] = useState(openSheetOnMount);
  const [sheetMode, setSheetMode] = useState<SheetMode>("join");

  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneOtp, setPhoneOtp] = useState("");

  const [email, setEmail] = useState("");
  const [emailOtp, setEmailOtp] = useState("");

  const [userName, setUserName] = useState("Stroller");
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState("Stroller");

  const greetingName = isLoggedIn ? userName : "Stroller";

  const emailOtpHint = useMemo(() => {
    if (!email) {
      return "Enter your email and OTP to continue.";
    }
    return `Enter the OTP sent to ${email}.`;
  }, [email]);

  const resetToJoinStep = () => {
    setSheetMode("join");
    setPhoneOtp("");
    setEmailOtp("");
  };

  const closeSheet = () => {
    setShowBottomSheet(false);
    resetToJoinStep();
  };

  const openSheet = () => {
    setShowBottomSheet(true);
    resetToJoinStep();
  };

  const completeLogin = (nextName: string) => {
    const resolved = nextName.trim() || "Stroller";
    setIsLoggedIn(true);
    setUserName(resolved);
    setDraftName(resolved);
    setIsEditingName(false);
    closeSheet();
  };

  const submitPhoneOtp = () => {
    if (phoneNumber.length !== 10) {
      return;
    }
    completeLogin(phoneNumber);
  };

  const submitEmailOtp = () => {
    if (!email.trim()) {
      return;
    }
    completeLogin(deriveFirstNameFromEmail(email));
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
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              className="wr-profile-name-input"
              aria-label="Edit profile name"
            />
            <button
              type="button"
              className="wr-profile-mini-btn"
              onClick={() => {
                const nextName = draftName.trim() || userName;
                setUserName(nextName);
                setDraftName(nextName);
                setIsEditingName(false);
              }}
            >
              Save
            </button>
          </div>
        ) : (
          <h3>{`Hi, ${greetingName} 👋`}</h3>
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
          <button
            type="button"
            className="wr-profile-row wr-profile-logout"
            onClick={() => {
              setIsLoggedIn(false);
              setUserName("Stroller");
              setDraftName("Stroller");
              setIsEditingName(false);
            }}
          >
            <span>Log out</span>
            <span className="wr-profile-row-right">
              <ChevronRight size={16} />
            </span>
          </button>
        </section>
      ) : null}

      <footer className="wr-profile-version">Version 0.1.0</footer>

      {showBottomSheet ? (
        <>
          <div className="wr-login-sheet-backdrop" aria-hidden="true" />
          <div className="wr-login-sheet" role="dialog" aria-modal="false" aria-label="Join Wandreel login sheet">
            <div className="wr-login-sheet-handle" />
            <button type="button" aria-label="Close login sheet" className="wr-login-sheet-close" onClick={closeSheet}>
              <X size={18} />
            </button>

            <p className="wr-login-sheet-kicker">JOIN WANDREEL</p>

            {sheetMode === "join" ? (
              <>
                <h4>Save your scrolls. Start your strolls.</h4>
                <p className="wr-login-sheet-desc">
                  Log in to sync your saved reels, city bucketlists, and places across devices.
                </p>
                <div className="wr-login-sheet-actions">
                  <button type="button" className="wr-login-sheet-primary" onClick={() => setSheetMode("phone")}>
                    <Phone size={15} />
                    Continue with phone
                  </button>
                  <button type="button" className="wr-login-sheet-secondary" onClick={() => setSheetMode("emailOptions")}>
                    <Mail size={15} />
                    Continue with email
                  </button>
                </div>
              </>
            ) : null}

            {sheetMode === "phone" ? (
              <>
                <h4>Continue with phone</h4>
                <div className="wr-login-sheet-phone-grid">
                  <div className="wr-login-sheet-prefix">+91</div>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={10}
                    className="wr-login-sheet-input"
                    value={phoneNumber}
                    onChange={(event) => setPhoneNumber(digitsOnly(event.target.value).slice(0, 10))}
                    placeholder="10 digit phone number"
                    aria-label="Phone number"
                  />
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  className="wr-login-sheet-input"
                  value={phoneOtp}
                  onChange={(event) => setPhoneOtp(digitsOnly(event.target.value).slice(0, 6))}
                  placeholder="OTP"
                  aria-label="Phone OTP"
                />
                <div className="wr-login-sheet-actions">
                  <button type="button" className="wr-login-sheet-primary" onClick={submitPhoneOtp}>
                    Send OTP
                  </button>
                  <button type="button" className="wr-login-sheet-secondary" onClick={() => setSheetMode("join")}>
                    Back
                  </button>
                </div>
              </>
            ) : null}

            {sheetMode === "emailOptions" ? (
              <>
                <h4>Continue with email</h4>
                <div className="wr-login-sheet-actions">
                  <button type="button" className="wr-login-sheet-secondary">Continue with Google</button>
                  <button type="button" className="wr-login-sheet-secondary">Continue with Facebook</button>
                  <button type="button" className="wr-login-sheet-primary" onClick={() => setSheetMode("emailOtp")}>
                    Use email OTP
                  </button>
                  <button type="button" className="wr-login-sheet-secondary" onClick={() => setSheetMode("join")}>
                    Back
                  </button>
                </div>
              </>
            ) : null}

            {sheetMode === "emailOtp" ? (
              <>
                <h4>Use email OTP</h4>
                <p className="wr-login-sheet-desc">{emailOtpHint}</p>
                <input
                  type="email"
                  className="wr-login-sheet-input"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  aria-label="Email address"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  className="wr-login-sheet-input"
                  value={emailOtp}
                  onChange={(event) => setEmailOtp(digitsOnly(event.target.value).slice(0, 6))}
                  placeholder="OTP"
                  aria-label="Email OTP"
                />
                <div className="wr-login-sheet-actions">
                  <button type="button" className="wr-login-sheet-primary" onClick={submitEmailOtp}>
                    Send OTP
                  </button>
                  <button type="button" className="wr-login-sheet-secondary" onClick={() => setSheetMode("emailOptions")}>
                    Back
                  </button>
                </div>
              </>
            ) : null}

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
