export type SessionUser = {
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

export type AuthSessionSnapshot = {
  user: SessionUser;
  savedAtMs: number;
};

export const AUTH_SESSION_SNAPSHOT_KEY = "wr_auth_session_snapshot_v1";

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function normalizeSessionUser(value: unknown): SessionUser | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const userId = String(candidate.userId || "").trim();
  const customerId = String(candidate.customerId || "").trim();
  if (!userId || !customerId) return null;

  return {
    userId,
    customerId,
    email: normalizeNullableString(candidate.email),
    emailVerified: candidate.emailVerified === true,
    phoneNumber: normalizeNullableString(candidate.phoneNumber),
    phoneVerified: candidate.phoneVerified === true,
    displayName: normalizeNullableString(candidate.displayName),
    avatarUrl: normalizeNullableString(candidate.avatarUrl),
    authProvider: normalizeNullableString(candidate.authProvider),
  };
}

export function parseAuthSessionSnapshot(raw: string | null | undefined): AuthSessionSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { user?: unknown; savedAtMs?: unknown };
    const user = normalizeSessionUser(parsed?.user);
    const savedAtMs = typeof parsed?.savedAtMs === "number" && Number.isFinite(parsed.savedAtMs)
      ? parsed.savedAtMs
      : Date.now();
    if (!user) return null;
    return { user, savedAtMs };
  } catch {
    return null;
  }
}

export function readAuthSessionSnapshot(storage: Pick<Storage, "getItem"> | null | undefined): AuthSessionSnapshot | null {
  if (!storage) return null;
  return parseAuthSessionSnapshot(storage.getItem(AUTH_SESSION_SNAPSHOT_KEY));
}

export function writeAuthSessionSnapshot(storage: Pick<Storage, "setItem"> | null | undefined, user: SessionUser) {
  if (!storage) return;
  storage.setItem(
    AUTH_SESSION_SNAPSHOT_KEY,
    JSON.stringify({
      user,
      savedAtMs: Date.now(),
    } satisfies AuthSessionSnapshot),
  );
}

export function clearAuthSessionSnapshot(storage: Pick<Storage, "removeItem"> | null | undefined) {
  storage?.removeItem(AUTH_SESSION_SNAPSHOT_KEY);
}
