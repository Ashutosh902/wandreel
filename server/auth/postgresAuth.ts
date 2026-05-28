import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";

export type AuthProvider = "EMAIL" | "GOOGLE" | "PHONE" | "FACEBOOK" | "APPLE";

type UserRecord = {
  id: string;
  email: string | null;
  email_verified: boolean;
  phone_number: string | null;
  phone_verified: boolean;
  display_name: string | null;
  avatar_url: string | null;
  auth_provider: AuthProvider | null;
  provider_id: string | null;
  created_at: string;
  updated_at: string;
};

type SessionRecord = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

type SavedPlaceRecord = {
  id: string;
  user_id: string;
  place_id: string;
  title: string;
  category: string | null;
  metadata_json: unknown;
  created_at: string;
  updated_at: string;
};

const DATABASE_URL = process.env.DATABASE_URL || "";
const SESSION_COOKIE_NAME = "wr_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const EMAIL_OTP_TTL_MS = 1000 * 60 * 10;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
});

let schemaReady = false;

export function isPostgresConfigured() {
  return Boolean(DATABASE_URL.trim());
}

export async function ensureAuthSchema() {
  if (schemaReady) return;
  if (!isPostgresConfigured()) {
    throw new Error("DATABASE_URL is not configured");
  }

  await pool.query(`
    create table if not exists users (
      id uuid primary key default gen_random_uuid(),
      email text unique,
      email_verified boolean not null default false,
      phone_number text unique,
      phone_verified boolean not null default false,
      display_name text,
      avatar_url text,
      auth_provider text,
      provider_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint users_provider_unique unique (auth_provider, provider_id)
    );
  `);

  await pool.query(`
    create table if not exists auth_sessions (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      token_hash text not null unique,
      expires_at timestamptz not null,
      revoked_at timestamptz,
      created_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create table if not exists auth_email_otps (
      id uuid primary key default gen_random_uuid(),
      email text not null,
      otp_hash text not null,
      expires_at timestamptz not null,
      consumed_at timestamptz,
      attempt_count integer not null default 0,
      created_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create index if not exists idx_auth_email_otps_email_created on auth_email_otps(email, created_at desc);
  `);

  await pool.query(`
    create table if not exists user_saved_places (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      place_id text not null,
      title text not null,
      category text,
      metadata_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (user_id, place_id)
    );
  `);

  await pool.query(`
    create index if not exists idx_user_saved_places_user_created on user_saved_places(user_id, created_at desc);
  `);

  schemaReady = true;
}

function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizeDisplayName(name: string | null | undefined) {
  const normalized = String(name || "").trim();
  return normalized || null;
}

function toUserDTO(row: UserRecord) {
  return {
    userId: row.id,
    customerId: row.id,
    email: row.email,
    emailVerified: row.email_verified,
    phoneNumber: row.phone_number,
    phoneVerified: row.phone_verified,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    authProvider: row.auth_provider,
    providerId: row.provider_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findUserById(userId: string) {
  const result = await pool.query<UserRecord>("select * from users where id = $1 limit 1", [userId]);
  return result.rows[0] || null;
}

export async function findUserByEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const result = await pool.query<UserRecord>("select * from users where email = $1 limit 1", [normalized]);
  return result.rows[0] || null;
}

export async function upsertGoogleVerifiedUser(input: {
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  providerId: string;
}) {
  const email = normalizeEmail(input.email);
  const displayName = sanitizeDisplayName(input.displayName) || email.split("@")[0] || "Wandreel User";
  const avatarUrl = input.avatarUrl ? String(input.avatarUrl).trim() : null;

  const client = await pool.connect();
  try {
    await client.query("begin");
    const existingByEmail = await client.query<UserRecord>("select * from users where email = $1 limit 1 for update", [email]);
    const existing = existingByEmail.rows[0];

    if (existing) {
      const updated = await client.query<UserRecord>(
        `
          update users
          set
            email_verified = true,
            display_name = coalesce($2, display_name),
            avatar_url = coalesce($3, avatar_url),
            auth_provider = 'GOOGLE',
            provider_id = $4,
            updated_at = now()
          where id = $1
          returning *
        `,
        [existing.id, displayName, avatarUrl, input.providerId],
      );
      await client.query("commit");
      return toUserDTO(updated.rows[0]);
    }

    const inserted = await client.query<UserRecord>(
      `
        insert into users (
          id, email, email_verified, phone_number, phone_verified, display_name, avatar_url, auth_provider, provider_id, created_at, updated_at
        )
        values ($1, $2, $3, null, false, $4, $5, 'GOOGLE', $6, now(), now())
        returning *
      `,
      [randomUUID(), email, input.emailVerified, displayName, avatarUrl, input.providerId],
    );
    await client.query("commit");
    return toUserDTO(inserted.rows[0]);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function createOrReuseEmailVerifiedUser(input: { email: string; displayName?: string | null }) {
  const email = normalizeEmail(input.email);
  const displayName = sanitizeDisplayName(input.displayName);
  const existing = await findUserByEmail(email);
  if (existing) {
    const updated = await pool.query<UserRecord>(
      `
        update users
        set
          email_verified = true,
          display_name = coalesce(display_name, $2),
          auth_provider = coalesce(auth_provider, 'EMAIL'),
          updated_at = now()
        where id = $1
        returning *
      `,
      [existing.id, displayName],
    );
    return toUserDTO(updated.rows[0]);
  }

  const inserted = await pool.query<UserRecord>(
    `
      insert into users (
        id, email, email_verified, phone_number, phone_verified, display_name, avatar_url, auth_provider, provider_id, created_at, updated_at
      )
      values ($1, $2, true, null, false, $3, null, 'EMAIL', null, now(), now())
      returning *
    `,
    [randomUUID(), email, displayName],
  );
  return toUserDTO(inserted.rows[0]);
}

export async function updateDisplayName(userId: string, displayName: string) {
  const cleaned = sanitizeDisplayName(displayName);
  if (!cleaned) {
    throw new Error("displayName is required");
  }
  const updated = await pool.query<UserRecord>(
    "update users set display_name = $2, updated_at = now() where id = $1 returning *",
    [userId, cleaned],
  );
  if (!updated.rows[0]) {
    throw new Error("User not found");
  }
  return toUserDTO(updated.rows[0]);
}

export async function createSession(userId: string) {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashValue(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const sessionId = randomUUID();

  await pool.query<SessionRecord>(
    `
      insert into auth_sessions (id, user_id, token_hash, expires_at, revoked_at, created_at)
      values ($1, $2, $3, $4, null, now())
    `,
    [sessionId, userId, tokenHash, expiresAt],
  );

  return { rawToken, expiresAt };
}

export async function findSessionUser(rawToken: string) {
  const tokenHash = hashValue(rawToken);
  const result = await pool.query<UserRecord>(
    `
      select u.*
      from auth_sessions s
      join users u on u.id = s.user_id
      where s.token_hash = $1
        and s.revoked_at is null
        and s.expires_at > now()
      limit 1
    `,
    [tokenHash],
  );
  const user = result.rows[0];
  return user ? toUserDTO(user) : null;
}

export async function revokeSession(rawToken: string) {
  const tokenHash = hashValue(rawToken);
  await pool.query("update auth_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null", [tokenHash]);
}

export async function issueEmailOtp(emailInput: string) {
  const email = normalizeEmail(emailInput);
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("Enter a valid email");
  }
  const otp = String(randomInt(100000, 999999));
  const otpHash = hashValue(otp);
  const expiresAt = new Date(Date.now() + EMAIL_OTP_TTL_MS).toISOString();

  await pool.query(
    `
      insert into auth_email_otps (id, email, otp_hash, expires_at, consumed_at, attempt_count, created_at)
      values ($1, $2, $3, $4, null, 0, now())
    `,
    [randomUUID(), email, otpHash, expiresAt],
  );

  return {
    email,
    expiresAt,
    otpPreview: process.env.EMAIL_OTP_DEV_MODE === "true" ? otp : undefined,
  };
}

export async function verifyEmailOtp(emailInput: string, otp: string) {
  const email = normalizeEmail(emailInput);
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("Enter a valid email");
  }
  if (!/^\d{6}$/.test(String(otp || "").trim())) {
    throw new Error("OTP must be 6 digits");
  }

  const latestResult = await pool.query<{
    id: string;
    otp_hash: string;
    expires_at: string;
    consumed_at: string | null;
    attempt_count: number;
  }>(
    `
      select id, otp_hash, expires_at, consumed_at, attempt_count
      from auth_email_otps
      where email = $1
      order by created_at desc
      limit 1
    `,
    [email],
  );
  const latest = latestResult.rows[0];
  if (!latest) {
    throw new Error("No OTP request found for this email");
  }
  if (latest.consumed_at) {
    throw new Error("OTP already used. Please request a new OTP");
  }
  if (new Date(latest.expires_at).getTime() < Date.now()) {
    throw new Error("OTP expired. Please request a new OTP");
  }

  const receivedHash = hashValue(otp.trim());
  if (receivedHash !== latest.otp_hash) {
    await pool.query("update auth_email_otps set attempt_count = attempt_count + 1 where id = $1", [latest.id]);
    throw new Error("Invalid OTP");
  }

  await pool.query("update auth_email_otps set consumed_at = now(), attempt_count = attempt_count + 1 where id = $1", [latest.id]);
  return { email };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function getSessionCookieName() {
  return SESSION_COOKIE_NAME;
}

export function buildSessionCookie(token: string) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const secure = process.env.NODE_ENV === "production";
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function buildClearSessionCookie() {
  const secure = process.env.NODE_ENV === "production";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

function toSavedPlaceDTO(row: SavedPlaceRecord) {
  return {
    id: row.id,
    placeId: row.place_id,
    title: row.title,
    category: row.category,
    metadata: row.metadata_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSavedPlaces(userId: string) {
  const result = await pool.query<SavedPlaceRecord>(
    "select * from user_saved_places where user_id = $1 order by created_at desc",
    [userId],
  );
  return result.rows.map(toSavedPlaceDTO);
}

export async function upsertSavedPlace(userId: string, input: { placeId: string; title: string; category?: string | null; metadata?: unknown }) {
  const placeId = String(input.placeId || "").trim();
  const title = String(input.title || "").trim();
  const category = input.category ? String(input.category).trim() : null;
  const metadata = input.metadata ?? {};

  if (!placeId) throw new Error("placeId is required");
  if (!title) throw new Error("title is required");

  const result = await pool.query<SavedPlaceRecord>(
    `
      insert into user_saved_places (id, user_id, place_id, title, category, metadata_json, created_at, updated_at)
      values ($1, $2, $3, $4, $5, $6::jsonb, now(), now())
      on conflict (user_id, place_id)
      do update set
        title = excluded.title,
        category = excluded.category,
        metadata_json = excluded.metadata_json,
        updated_at = now()
      returning *
    `,
    [randomUUID(), userId, placeId, title, category, JSON.stringify(metadata)],
  );
  return toSavedPlaceDTO(result.rows[0]);
}

export async function deleteSavedPlace(userId: string, placeIdRaw: string) {
  const placeId = String(placeIdRaw || "").trim();
  if (!placeId) throw new Error("placeId is required");
  const result = await pool.query(
    "delete from user_saved_places where user_id = $1 and place_id = $2 returning id",
    [userId, placeId],
  );
  return { deleted: Number(result.rowCount || 0) > 0 };
}
