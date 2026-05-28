import fs from "node:fs";
import path from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import * as XLSX from "xlsx";

type AuthProvider = "PHONE" | "EMAIL" | "GOOGLE" | "FACEBOOK" | "APPLE";

type AuthOtpRow = {
  otp_id: number;
  identifier: string;
  otp_code: string;
  channel: string;
  status: string;
  expires_at: string;
  resend_count: number;
  verify_attempt_count: number;
  cooldown_until: string | null;
  lockout_until: string | null;
  consumed_at: string | null;
  is_verified: boolean;
  created_at: string;
};

type UserRow = {
  user_id: string;
  provider_id: string | null;
  email: string | null;
  phone: string | null;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  auth_provider: AuthProvider | string | null;
  password_hash: string | null;
  created_at: string;
  updated_at: string;
  status: string;
};

type UpsertProfileInput = {
  displayName: string;
  providerId?: string | null;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  authProvider: AuthProvider;
};

const OTP_FILE = path.resolve(process.cwd(), "database/tables/auth_otp.xlsx");
const USERS_FILE = path.resolve(process.cwd(), "database/tables/users.xlsx");

const OTP_HEADERS: Array<keyof AuthOtpRow> = [
  "otp_id",
  "identifier",
  "otp_code",
  "channel",
  "status",
  "expires_at",
  "resend_count",
  "verify_attempt_count",
  "cooldown_until",
  "lockout_until",
  "consumed_at",
  "is_verified",
  "created_at",
];

const USER_HEADERS: Array<keyof UserRow> = [
  "user_id",
  "provider_id",
  "email",
  "phone",
  "username",
  "display_name",
  "avatar_url",
  "auth_provider",
  "password_hash",
  "created_at",
  "updated_at",
  "status",
];

function ensureWorkbook(filePath: string, headers: string[]) {
  if (fs.existsSync(filePath)) return;

  const worksheet = XLSX.utils.json_to_sheet([], { header: headers });
  XLSX.utils.sheet_add_aoa(worksheet, [headers], { origin: "A1" });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  XLSX.writeFile(workbook, filePath);
}

function readRows<T extends Record<string, unknown>>(filePath: string): T[] {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<T>(sheet, { defval: null, raw: false });
}

function writeRows<T extends Record<string, unknown>>(filePath: string, headers: string[], rows: T[]) {
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  XLSX.utils.sheet_add_aoa(worksheet, [headers], { origin: "A1" });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  XLSX.writeFile(workbook, filePath);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePhone(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length !== 10) {
    throw new Error("Phone number must be 10 digits");
  }
  return digits;
}

function normalizeEmail(email: string | null | undefined): string | null {
  const value = String(email || "").trim().toLowerCase();
  return value || null;
}

function generateOtpCode() {
  return String(randomInt(100000, 999999));
}

function nextOtpId(rows: AuthOtpRow[]): number {
  const max = rows.reduce((acc, row) => Math.max(acc, Number(row.otp_id) || 0), 0);
  return max + 1;
}

function defaultUsernameFromPhone(phone: string) {
  return `User ${phone.slice(-4)}`;
}

function defaultUsernameFromName(name: string) {
  const trimmed = name.trim() || "Stroller";
  return trimmed;
}

function normalizeUserRow(raw: Record<string, unknown>): UserRow {
  return {
    user_id: String(raw.user_id || randomUUID()),
    provider_id: raw.provider_id ? String(raw.provider_id) : null,
    email: normalizeEmail((raw.email as string) || null),
    phone: raw.phone ? String(raw.phone) : null,
    username: String(raw.username || raw.display_name || "Stroller"),
    display_name: raw.display_name ? String(raw.display_name) : raw.username ? String(raw.username) : null,
    avatar_url: raw.avatar_url ? String(raw.avatar_url) : null,
    auth_provider: raw.auth_provider ? String(raw.auth_provider) : null,
    password_hash: raw.password_hash ? String(raw.password_hash) : null,
    created_at: String(raw.created_at || nowIso()),
    updated_at: String(raw.updated_at || raw.created_at || nowIso()),
    status: String(raw.status || "ACTIVE"),
  };
}

function readUsers(): UserRow[] {
  ensureWorkbook(USERS_FILE, USER_HEADERS as string[]);
  const rows = readRows<Record<string, unknown>>(USERS_FILE);
  return rows.map(normalizeUserRow);
}

function saveUsers(users: UserRow[]) {
  writeRows(USERS_FILE, USER_HEADERS as string[], users);
}

function serializeUser(user: UserRow) {
  return {
    userId: user.user_id,
    providerId: user.provider_id,
    displayName: user.display_name || user.username,
    email: user.email,
    phone: user.phone,
    avatarUrl: user.avatar_url,
    authProvider: user.auth_provider,
    status: user.status,
  };
}

export const phoneOtpStore = {
  requestOtp(inputPhone: string) {
    ensureWorkbook(OTP_FILE, OTP_HEADERS as string[]);

    const phone = normalizePhone(inputPhone);
    const otpRows = readRows<AuthOtpRow>(OTP_FILE);
    const users = readUsers();

    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const code = generateOtpCode();

    const newOtp: AuthOtpRow = {
      otp_id: nextOtpId(otpRows),
      identifier: phone,
      otp_code: code,
      channel: "phone",
      status: "SENT",
      expires_at: expiresAt,
      resend_count: 0,
      verify_attempt_count: 0,
      cooldown_until: null,
      lockout_until: null,
      consumed_at: null,
      is_verified: false,
      created_at: createdAt,
    };

    otpRows.push(newOtp);
    writeRows(OTP_FILE, OTP_HEADERS as string[], otpRows);

    let user = users.find((row) => String(row.phone || "") === phone);
    if (!user) {
      user = {
        user_id: randomUUID(),
        provider_id: null,
        email: null,
        phone,
        username: defaultUsernameFromPhone(phone),
        display_name: defaultUsernameFromPhone(phone),
        avatar_url: null,
        auth_provider: "PHONE",
        password_hash: null,
        created_at: createdAt,
        updated_at: createdAt,
        status: "ACTIVE",
      };
      users.push(user);
      saveUsers(users);
    }

    return {
      phone,
      expiresAt,
      // Dev-friendly until SMS provider is integrated.
      otpPreview: code,
    };
  },

  verifyOtp(inputPhone: string, inputCode: string) {
    ensureWorkbook(OTP_FILE, OTP_HEADERS as string[]);

    const phone = normalizePhone(inputPhone);
    const code = String(inputCode || "").trim();
    if (!/^\d{6}$/.test(code)) {
      throw new Error("OTP must be 6 digits");
    }

    const otpRows = readRows<AuthOtpRow>(OTP_FILE);
    const users = readUsers();

    const latestIndex = [...otpRows]
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => String(row.identifier || "") === phone && String(row.channel || "") === "phone")
      .sort((a, b) => new Date(String(b.row.created_at)).getTime() - new Date(String(a.row.created_at)).getTime())[0];

    if (!latestIndex) {
      throw new Error("No OTP request found for this phone");
    }

    const target = latestIndex.row;
    const targetIndex = latestIndex.index;
    const isExpired = new Date(String(target.expires_at)).getTime() < Date.now();

    if (String(target.consumed_at || "").trim()) {
      throw new Error("OTP already used. Please request a new OTP");
    }
    if (isExpired) {
      throw new Error("OTP expired. Please request a new OTP");
    }

    const attempts = Number(target.verify_attempt_count || 0);
    if (String(target.otp_code || "") !== code) {
      otpRows[targetIndex] = {
        ...target,
        verify_attempt_count: attempts + 1,
        status: "INVALID_ATTEMPT",
      };
      writeRows(OTP_FILE, OTP_HEADERS as string[], otpRows);
      throw new Error("Invalid OTP");
    }

    otpRows[targetIndex] = {
      ...target,
      verify_attempt_count: attempts + 1,
      consumed_at: nowIso(),
      is_verified: true,
      status: "VERIFIED",
    };
    writeRows(OTP_FILE, OTP_HEADERS as string[], otpRows);

    let user = users.find((row) => String(row.phone || "") === phone);
    if (!user) {
      user = {
        user_id: randomUUID(),
        provider_id: null,
        email: null,
        phone,
        username: defaultUsernameFromPhone(phone),
        display_name: defaultUsernameFromPhone(phone),
        avatar_url: null,
        auth_provider: "PHONE",
        password_hash: null,
        created_at: nowIso(),
        updated_at: nowIso(),
        status: "ACTIVE",
      };
      users.push(user);
    } else {
      user.auth_provider = "PHONE";
      user.updated_at = nowIso();
    }
    saveUsers(users);

    return { user: serializeUser(user) };
  },

  upsertProfile(input: UpsertProfileInput) {
    const displayName = String(input.displayName || "").trim();
    if (!displayName) {
      throw new Error("displayName is required");
    }

    const email = normalizeEmail(input.email);
    const phone = input.phone ? normalizePhone(input.phone) : null;
    const avatarUrl = input.avatarUrl ? String(input.avatarUrl).trim() : null;
    const providerId = input.providerId ? String(input.providerId).trim() : null;
    const authProvider = input.authProvider;
    const users = readUsers();
    const timestamp = nowIso();

    let user = users.find((row) => {
      if (email && row.email && row.email === email) return true;
      if (phone && row.phone && row.phone === phone) return true;
      if (providerId && row.provider_id && row.provider_id === providerId) return true;
      return false;
    });

    if (!user) {
      user = {
        user_id: randomUUID(),
        provider_id: providerId,
        email: email ?? null,
        phone: phone ?? null,
        username: defaultUsernameFromName(displayName),
        display_name: displayName,
        avatar_url: avatarUrl,
        auth_provider: authProvider,
        password_hash: null,
        created_at: timestamp,
        updated_at: timestamp,
        status: "ACTIVE",
      };
      users.push(user);
    } else {
      user.email = email ?? user.email;
      user.phone = phone ?? user.phone;
      user.provider_id = providerId ?? user.provider_id;
      user.display_name = displayName;
      user.username = defaultUsernameFromName(displayName);
      user.avatar_url = avatarUrl ?? user.avatar_url;
      user.auth_provider = authProvider;
      user.updated_at = timestamp;
      user.status = "ACTIVE";
    }

    saveUsers(users);
    return { user: serializeUser(user) };
  },
};
