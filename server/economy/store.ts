import { randomUUID } from "node:crypto";

export type EconomyQueryable = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

type ConnectableDatabase = EconomyQueryable & {
  connect: () => Promise<EconomyQueryable & { release: () => void }>;
};

type CoinWalletRow = {
  user_id: string;
  balance_millis: string | number | bigint;
  created_at: string;
  updated_at: string;
};

type CoinTransactionRow = {
  id: string;
  type: CoinTransactionType;
  direction: CoinTransactionDirection;
  amount_millis: string | number | bigint;
  balance_after_millis: string | number | bigint | null;
  related_place_id: string | null;
  metadata_json: unknown;
  created_at: string;
};

type SaveEventRow = {
  id: string;
  user_id: string;
  place_id: string;
  source: CoinSaveSource;
  charge_millis: string | number | bigint;
  reward_pool_millis: string | number | bigint;
  platform_retention_millis: string | number | bigint;
  recommender_snapshot_json: unknown;
  reward_distribution_json: unknown;
  rounding_policy: string;
  created_at: string;
};

type CoinOnboardingRow = {
  user_id: string;
  eligible: boolean;
  coin_onboarding_completed_at: string | Date | null;
  created_at: string;
  updated_at: string;
};

export type CoinSaveSource = "external_import" | "discover";
export type CoinTransactionType =
  | "signup_grant"
  | "external_save_charge"
  | "discover_save_charge"
  | "reward_pool_credit"
  | "recommender_reward"
  | "platform_retention"
  | "refund"
  | "adjustment";
export type CoinTransactionDirection = "credit" | "debit" | "pool_credit" | "pool_debit";

export type CoinWalletDto = {
  userId: string;
  balanceCoins: number;
  balanceMillis: number;
  createdAt: string;
  updatedAt: string;
};

export type CoinOnboardingDto = {
  completed: boolean;
  completedAt: string | null;
  eligible: boolean;
};

export type CoinPricingDto = {
  coinMillisPerCoin: number;
  welcomeGrantCoins: number;
  welcomeGrantMillis: number;
  externalSaveCoins: number;
  externalSaveMillis: number;
  discoverSaveCoins: number;
  discoverSaveMillis: number;
};

export type CoinTransactionDto = {
  id: string;
  type: CoinTransactionType;
  direction: CoinTransactionDirection;
  amountCoins: number;
  amountMillis: number;
  balanceAfterCoins: number | null;
  balanceAfterMillis: number | null;
  relatedPlaceId: string | null;
  metadata: unknown;
  createdAt: string;
};

export type CoinLedgerTypeFilter = "all" | "credit" | "debit";
export type CoinLedgerDatePreset = "7d" | "6m" | "custom";
export type CoinLedgerSort = "newest" | "oldest" | "amount_desc" | "amount_asc";

export type CoinLedgerOptions = {
  type?: CoinLedgerTypeFilter;
  datePreset?: CoinLedgerDatePreset;
  from?: string | null;
  to?: string | null;
  sort?: CoinLedgerSort;
  page?: number;
  pageSize?: number;
  timezoneOffsetMinutes?: number;
  limit?: number;
};

export type RewardDistribution = {
  userId: string;
  amountMillis: number;
  amountCoins: number;
  remainderRank: number | null;
};

export type CoinLedgerDto = {
  wallet: CoinWalletDto;
  transactions: CoinTransactionDto[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
  filters: {
    type: CoinLedgerTypeFilter;
    datePreset: CoinLedgerDatePreset;
    from: string | null;
    to: string | null;
    sort: CoinLedgerSort;
  };
};

export type CoinChargeResult = {
  saveEvent: {
    id: string;
    userId: string;
    placeId: string;
    source: CoinSaveSource;
    chargeCoins: number;
    chargeMillis: number;
    rewardPoolCoins: number;
    rewardPoolMillis: number;
    platformRetentionCoins: number;
    platformRetentionMillis: number;
    recommenderSnapshot: string[];
    rewardDistribution: RewardDistribution[];
    roundingPolicy: string;
    createdAt: string;
  };
  wallet: CoinWalletDto;
  alreadyProcessed: boolean;
};

export type EconomyLimits = {
  maxRewardsPerUserPlaceDay: number | null;
  maxRewardsPerUserDay: number | null;
  maxRewardedRecommendationsCreatedPerDay: number | null;
};

const COIN_MILLIS_PER_COIN = 1000;
const INITIAL_LOGIN_GRANT_MILLIS = 500 * COIN_MILLIS_PER_COIN;
const EXTERNAL_IMPORT_CHARGE_MILLIS = 2 * COIN_MILLIS_PER_COIN;
const DISCOVER_SAVE_CHARGE_MILLIS = 1 * COIN_MILLIS_PER_COIN;
const DISCOVER_REWARD_POOL_MILLIS = 500;
const DISCOVER_REWARD_POOL_KEY = "discover_recommenders";
const ROUNDING_POLICY = "largest_remainder_user_id_asc";

export const economyConstants = {
  coinMillisPerCoin: COIN_MILLIS_PER_COIN,
  initialLoginGrantMillis: INITIAL_LOGIN_GRANT_MILLIS,
  externalImportChargeMillis: EXTERNAL_IMPORT_CHARGE_MILLIS,
  discoverSaveChargeMillis: DISCOVER_SAVE_CHARGE_MILLIS,
  discoverRewardPoolMillis: DISCOVER_REWARD_POOL_MILLIS,
  roundingPolicy: ROUNDING_POLICY,
} as const;

export function getCoinPricing(): CoinPricingDto {
  return {
    coinMillisPerCoin: COIN_MILLIS_PER_COIN,
    welcomeGrantCoins: millisToCoins(INITIAL_LOGIN_GRANT_MILLIS),
    welcomeGrantMillis: INITIAL_LOGIN_GRANT_MILLIS,
    externalSaveCoins: millisToCoins(EXTERNAL_IMPORT_CHARGE_MILLIS),
    externalSaveMillis: EXTERNAL_IMPORT_CHARGE_MILLIS,
    discoverSaveCoins: millisToCoins(DISCOVER_SAVE_CHARGE_MILLIS),
    discoverSaveMillis: DISCOVER_SAVE_CHARGE_MILLIS,
  };
}

function millisToCoins(value: number) {
  return value / COIN_MILLIS_PER_COIN;
}

function normalizeLedgerType(value: unknown): CoinLedgerTypeFilter {
  return value === "credit" || value === "debit" || value === "all" ? value : "all";
}

function normalizeLedgerDatePreset(value: unknown): CoinLedgerDatePreset {
  return value === "7d" || value === "custom" || value === "6m" ? value : "6m";
}

function normalizeLedgerSort(value: unknown): CoinLedgerSort {
  return value === "oldest" || value === "amount_desc" || value === "amount_asc" || value === "newest" ? value : "newest";
}

type ParsedDateOnly = {
  year: number;
  month: number;
  day: number;
  value: string;
};

function formatDateOnly(date: Date) {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function parseDateOnly(value: string | null | undefined): ParsedDateOnly | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid date. Use YYYY-MM-DD.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Invalid date. Use YYYY-MM-DD.");
  }
  return { year, month, day, value };
}

function shiftDate(value: ParsedDateOnly | null, days: number): ParsedDateOnly | null {
  if (!value) return null;
  return parseDateOnly(formatDateOnly(new Date(Date.UTC(value.year, value.month - 1, value.day + days))));
}

function getLocalToday(timezoneOffsetMinutes: number) {
  return parseDateOnly(formatDateOnly(new Date(Date.now() - timezoneOffsetMinutes * 60_000)))!;
}

function toUtcBoundary(date: ParsedDateOnly | null, timezoneOffsetMinutes: number) {
  if (!date) return null;
  return new Date(Date.UTC(date.year, date.month - 1, date.day) + timezoneOffsetMinutes * 60_000).toISOString();
}

function resolveLedgerDateRange(options: CoinLedgerOptions, datePreset: CoinLedgerDatePreset) {
  const timezoneOffsetMinutes = Number.isFinite(Number(options.timezoneOffsetMinutes))
    ? Number(options.timezoneOffsetMinutes)
    : 0;
  if (datePreset === "custom") {
    const from = parseDateOnly(options.from ?? null);
    const to = parseDateOnly(options.to ?? null);
    const fromIso = toUtcBoundary(from, timezoneOffsetMinutes);
    const toExclusiveIso = toUtcBoundary(shiftDate(to, 1), timezoneOffsetMinutes);
    if (fromIso && toExclusiveIso && fromIso >= toExclusiveIso) {
      throw new Error("End date must be on or after start date.");
    }
    return {
      fromLabel: from?.value ?? null,
      toLabel: to?.value ?? null,
      fromIso,
      toExclusiveIso,
    };
  }

  const today = getLocalToday(timezoneOffsetMinutes);
  const from = datePreset === "7d"
    ? shiftDate(today, -6)
    : parseDateOnly(formatDateOnly(new Date(Date.UTC(today.year, today.month - 7, today.day))));
  return {
    fromLabel: from?.value ?? null,
    toLabel: today.value,
    fromIso: toUtcBoundary(from, timezoneOffsetMinutes),
    toExclusiveIso: toUtcBoundary(shiftDate(today, 1), timezoneOffsetMinutes),
  };
}

function toMillis(value: string | number | bigint | null | undefined) {
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function normalizePlaceId(value: string) {
  return String(value || "").trim();
}

function normalizeIdempotencyKey(value: string) {
  return String(value || "").trim().slice(0, 240);
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && String((error as { code?: unknown }).code) === "23505";
}

function toWalletDto(row: CoinWalletRow): CoinWalletDto {
  const balanceMillis = toMillis(row.balance_millis);
  return {
    userId: row.user_id,
    balanceCoins: millisToCoins(balanceMillis),
    balanceMillis,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTransactionDto(row: CoinTransactionRow): CoinTransactionDto {
  const amountMillis = toMillis(row.amount_millis);
  const balanceAfterMillis = row.balance_after_millis === null ? null : toMillis(row.balance_after_millis);
  return {
    id: row.id,
    type: row.type,
    direction: row.direction,
    amountCoins: millisToCoins(amountMillis),
    amountMillis,
    balanceAfterCoins: balanceAfterMillis === null ? null : millisToCoins(balanceAfterMillis),
    balanceAfterMillis,
    relatedPlaceId: row.related_place_id,
    metadata: row.metadata_json ?? {},
    createdAt: row.created_at,
  };
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function readRewardDistribution(value: unknown): RewardDistribution[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : null;
      const userId = String(record?.userId || "").trim();
      const amountMillis = toMillis(record?.amountMillis as string | number | bigint | null | undefined);
      if (!userId || amountMillis < 0) return null;
      const remainderRank = Number.isSafeInteger(Number(record?.remainderRank)) ? Number(record?.remainderRank) : null;
      return { userId, amountMillis, amountCoins: millisToCoins(amountMillis), remainderRank };
    })
    .filter((item): item is RewardDistribution => item !== null);
}

function toSaveEventDto(row: SaveEventRow) {
  const chargeMillis = toMillis(row.charge_millis);
  const rewardPoolMillis = toMillis(row.reward_pool_millis);
  const platformRetentionMillis = toMillis(row.platform_retention_millis);
  return {
    id: row.id,
    userId: row.user_id,
    placeId: row.place_id,
    source: row.source,
    chargeCoins: millisToCoins(chargeMillis),
    chargeMillis,
    rewardPoolCoins: millisToCoins(rewardPoolMillis),
    rewardPoolMillis,
    platformRetentionCoins: millisToCoins(platformRetentionMillis),
    platformRetentionMillis,
    recommenderSnapshot: readStringArray(row.recommender_snapshot_json),
    rewardDistribution: readRewardDistribution(row.reward_distribution_json),
    roundingPolicy: row.rounding_policy || ROUNDING_POLICY,
    createdAt: row.created_at,
  };
}

function toOnboardingDto(row: CoinOnboardingRow | null | undefined): CoinOnboardingDto {
  if (!row) {
    return {
      completed: true,
      completedAt: null,
      eligible: false,
    };
  }
  const rawCompletedAt = row.coin_onboarding_completed_at ?? null;
  const completedAt = rawCompletedAt instanceof Date
    ? rawCompletedAt.toISOString()
    : rawCompletedAt === null
      ? null
      : String(rawCompletedAt);
  return {
    completed: Boolean(completedAt) || !row.eligible,
    completedAt,
    eligible: Boolean(row.eligible),
  };
}

function readLimitEnv(name: string): number | null {
  const raw = String(process.env[name] || "").trim();
  if (!raw || raw.toLowerCase() === "disabled") return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function getEconomyLimits(): EconomyLimits {
  return {
    maxRewardsPerUserPlaceDay: readLimitEnv("COIN_MAX_REWARDS_PER_USER_PLACE_DAY"),
    maxRewardsPerUserDay: readLimitEnv("COIN_MAX_REWARDS_PER_USER_DAY"),
    maxRewardedRecommendationsCreatedPerDay: readLimitEnv("COIN_MAX_REWARDED_RECOMMENDATIONS_CREATED_PER_DAY"),
  };
}

export function allocateRewardMillis(totalMillis: number, recommenderUserIds: string[]): RewardDistribution[] {
  if (!Number.isSafeInteger(totalMillis) || totalMillis < 0) {
    throw new Error("reward millis must be a non-negative safe integer");
  }
  const uniqueSorted = Array.from(new Set(recommenderUserIds.map((id) => String(id).trim()).filter(Boolean))).sort();
  if (!uniqueSorted.length || totalMillis === 0) return [];
  const base = Math.floor(totalMillis / uniqueSorted.length);
  const remainder = totalMillis % uniqueSorted.length;
  return uniqueSorted.map((userId, index) => {
    const getsRemainderMilli = index < remainder;
    const amountMillis = base + (getsRemainderMilli ? 1 : 0);
    return {
      userId,
      amountMillis,
      amountCoins: millisToCoins(amountMillis),
      remainderRank: getsRemainderMilli ? index + 1 : null,
    };
  });
}

async function ensureWallet(client: EconomyQueryable, userId: string) {
  const result = await client.query<CoinWalletRow>(
    `
      insert into coin_wallets (user_id, balance_millis, created_at, updated_at)
      values ($1, 0, now(), now())
      on conflict (user_id) do update set updated_at = coin_wallets.updated_at
      returning *
    `,
    [userId],
  );
  return toWalletDto(result.rows[0]);
}

async function creditWallet(input: {
  client: EconomyQueryable;
  userId: string;
  amountMillis: number;
  idempotencyKey: string;
  type: CoinTransactionType;
  relatedPlaceId?: string | null;
  metadata?: Record<string, unknown>;
  saveEventId?: string | null;
  onInsertedTransaction?: (transactionId: string) => Promise<void>;
}) {
  const transactionId = randomUUID();
  const insertedTransaction = await input.client.query<{ id: string }>(
    `
      insert into coin_transactions (
        id, user_id, wallet_user_id, save_event_id, idempotency_key, type, direction,
        amount_millis, balance_after_millis, related_place_id, metadata_json, created_at
      )
      values ($1, $2, $2, $3, $4, $5, 'credit', $6, null, $7, $8::jsonb, now())
      on conflict (idempotency_key) do nothing
      returning id
    `,
    [
      transactionId,
      input.userId,
      input.saveEventId ?? null,
      input.idempotencyKey,
      input.type,
      input.amountMillis,
      input.relatedPlaceId ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  if (!insertedTransaction.rows[0]) return ensureWallet(input.client, input.userId);
  await input.onInsertedTransaction?.(insertedTransaction.rows[0].id);

  const wallet = await input.client.query<CoinWalletRow>(
    `
      insert into coin_wallets (user_id, balance_millis, created_at, updated_at)
      values ($1, $2, now(), now())
      on conflict (user_id)
      do update set
        balance_millis = coin_wallets.balance_millis + excluded.balance_millis,
        updated_at = now()
      returning *
    `,
    [input.userId, input.amountMillis],
  );
  const nextWallet = toWalletDto(wallet.rows[0]);
  await input.client.query(
    `
      update coin_transactions
      set balance_after_millis = $2
      where id = $1
    `,
    [insertedTransaction.rows[0].id, nextWallet.balanceMillis],
  );
  return nextWallet;
}

export async function grantFirstLoginCoins(database: ConnectableDatabase, userId: string) {
  const client = await database.connect();
  try {
    await client.query("begin");
    let grantedNow = false;
    const wallet = await creditWallet({
      client,
      userId,
      amountMillis: INITIAL_LOGIN_GRANT_MILLIS,
      idempotencyKey: `signup-grant:${userId}`,
      type: "signup_grant",
      metadata: { reason: "first_login" },
      onInsertedTransaction: async () => {
        grantedNow = true;
      },
    });
    if (grantedNow) {
      await client.query(
        `
          insert into coin_onboarding_preferences (
            user_id, eligible, coin_onboarding_completed_at, created_at, updated_at, metadata_json
          )
          values ($1, true, null, now(), now(), $2::jsonb)
          on conflict (user_id) do nothing
        `,
        [userId, JSON.stringify({ source: "signup_grant" })],
      );
    }
    await client.query("commit");
    return wallet;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getCoinOnboardingState(database: EconomyQueryable, userId: string): Promise<CoinOnboardingDto> {
  const result = await database.query<CoinOnboardingRow>(
    `
      select user_id::text, eligible, coin_onboarding_completed_at, created_at, updated_at
      from coin_onboarding_preferences
      where user_id = $1
      limit 1
    `,
    [userId],
  );
  return toOnboardingDto(result.rows[0]);
}

export async function completeCoinOnboarding(database: EconomyQueryable, userId: string): Promise<CoinOnboardingDto> {
  const result = await database.query<CoinOnboardingRow>(
    `
      insert into coin_onboarding_preferences (
        user_id, eligible, coin_onboarding_completed_at, created_at, updated_at, metadata_json
      )
      values ($1, false, now(), now(), now(), $2::jsonb)
      on conflict (user_id)
      do update set
        coin_onboarding_completed_at = coalesce(
          coin_onboarding_preferences.coin_onboarding_completed_at,
          excluded.coin_onboarding_completed_at
        ),
        updated_at = case
          when coin_onboarding_preferences.coin_onboarding_completed_at is null then now()
          else coin_onboarding_preferences.updated_at
        end
      returning user_id::text, eligible, coin_onboarding_completed_at, created_at, updated_at
    `,
    [userId, JSON.stringify({ source: "manual_complete" })],
  );
  return toOnboardingDto(result.rows[0]);
}

async function assertRewardedRecommendationCreationLimit(input: {
  client: EconomyQueryable;
  userId: string;
  limit: number | null;
}) {
  if (input.limit === null) return true;
  const result = await input.client.query<{ count: string | number }>(
    `
      select count(*)::int as count
      from user_saved_places
      where user_id = $1
        and created_at >= date_trunc('day', now())
        and (
          metadata_json->>'sharedVisibility' = 'global'
          or coalesce((metadata_json->>'isGlobal')::boolean, false) = true
        )
    `,
    [input.userId],
  );
  return Number(result.rows[0]?.count ?? 0) < input.limit;
}

async function isRewardAllowedForRecommender(input: {
  client: EconomyQueryable;
  userId: string;
  placeId: string;
  limits: EconomyLimits;
}) {
  if (input.limits.maxRewardsPerUserPlaceDay !== null) {
    const perPlace = await input.client.query<{ count: string | number }>(
      `
        select count(*)::int as count
        from coin_transactions
        where wallet_user_id = $1
          and related_place_id = $2
          and type = 'recommender_reward'
          and created_at >= date_trunc('day', now())
      `,
      [input.userId, input.placeId],
    );
    if (Number(perPlace.rows[0]?.count ?? 0) >= input.limits.maxRewardsPerUserPlaceDay) return false;
  }

  if (input.limits.maxRewardsPerUserDay !== null) {
    const perDay = await input.client.query<{ count: string | number }>(
      `
        select count(*)::int as count
        from coin_transactions
        where wallet_user_id = $1
          and type = 'recommender_reward'
          and created_at >= date_trunc('day', now())
      `,
      [input.userId],
    );
    if (Number(perDay.rows[0]?.count ?? 0) >= input.limits.maxRewardsPerUserDay) return false;
  }

  return true;
}

async function listDiscoverRecommendersAtSaveTime(input: {
  client: EconomyQueryable;
  userId: string;
  placeId: string;
  limits: EconomyLimits;
}) {
  const result = await input.client.query<{ user_id: string }>(
    `
      select distinct usp.user_id::text
      from user_saved_places usp
      join users u on u.id = usp.user_id
      left join coin_account_flags flags on flags.user_id = usp.user_id
      where usp.place_id = $1
        and usp.user_id <> $2
        and (
          usp.metadata_json->>'sharedVisibility' = 'global'
          or coalesce((usp.metadata_json->>'isGlobal')::boolean, false) = true
        )
        and coalesce(flags.is_blocked, false) = false
        and coalesce(flags.is_fraudulent, false) = false
        and coalesce(flags.is_reward_eligible, true) = true
      order by usp.user_id::text
    `,
    [input.placeId, input.userId],
  );
  const candidates = result.rows.map((row) => row.user_id);
  const eligible: string[] = [];
  for (const userId of candidates) {
    const withinRecommendationLimit = await assertRewardedRecommendationCreationLimit({
      client: input.client,
      userId,
      limit: input.limits.maxRewardedRecommendationsCreatedPerDay,
    });
    if (!withinRecommendationLimit) continue;
    const withinRewardLimits = await isRewardAllowedForRecommender({
      client: input.client,
      userId,
      placeId: input.placeId,
      limits: input.limits,
    });
    if (withinRewardLimits) eligible.push(userId);
  }
  return eligible;
}

export async function getCoinLedger(
  database: ConnectableDatabase,
  userId: string,
  options: CoinLedgerOptions = {},
): Promise<CoinLedgerDto> {
  const client = await database.connect();
  try {
    await client.query("begin");
    const wallet = await ensureWallet(client, userId);
    const type = normalizeLedgerType(options.type);
    const datePreset = normalizeLedgerDatePreset(options.datePreset);
    const sort = normalizeLedgerSort(options.sort);
    const page = Number.isSafeInteger(Number(options.page)) && Number(options.page) > 0 ? Number(options.page) : 1;
    const pageSize = options.limit
      ? Math.min(Math.max(Number(options.limit), 1), 100)
      : 25;
    const effectivePageSize = options.limit ? pageSize : 25;
    const dateRange = resolveLedgerDateRange(options, datePreset);
    const where = ["wallet_user_id = $1"];
    const params: unknown[] = [userId];
    if (type === "credit" || type === "debit") {
      params.push(type);
      where.push(`direction = $${params.length}`);
    }
    if (dateRange.fromIso) {
      params.push(dateRange.fromIso);
      where.push(`created_at >= $${params.length}::timestamptz`);
    }
    if (dateRange.toExclusiveIso) {
      params.push(dateRange.toExclusiveIso);
      where.push(`created_at < $${params.length}::timestamptz`);
    }
    const whereSql = where.join(" and ");
    const orderSql =
      sort === "oldest"
        ? "created_at asc, id asc"
        : sort === "amount_desc"
          ? "amount_millis desc, created_at desc, id desc"
          : sort === "amount_asc"
            ? "amount_millis asc, created_at desc, id desc"
            : "created_at desc, id desc";
    const totalResult = await client.query<{ total_count: string | number | bigint }>(
      `select count(*)::bigint as total_count from coin_transactions where ${whereSql}`,
      params,
    );
    const totalCount = toMillis(totalResult.rows[0]?.total_count);
    const totalPages = Math.max(1, Math.ceil(totalCount / effectivePageSize));
    const offset = (page - 1) * effectivePageSize;
    const queryParams = [...params, effectivePageSize, offset];
    const transactions = await client.query<CoinTransactionRow>(
      `
        select id::text, type, direction, amount_millis, balance_after_millis, related_place_id, metadata_json, created_at
        from coin_transactions
        where ${whereSql}
        order by ${orderSql}
        limit $${queryParams.length - 1}
        offset $${queryParams.length}
      `,
      queryParams,
    );
    await client.query("commit");
    return {
      wallet,
      transactions: transactions.rows.map(toTransactionDto),
      pagination: {
        page,
        pageSize: effectivePageSize,
        totalCount,
        totalPages,
        hasPreviousPage: page > 1,
        hasNextPage: page < totalPages,
      },
      filters: {
        type,
        datePreset,
        from: dateRange.fromLabel,
        to: dateRange.toLabel,
        sort,
      },
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function chargeSavedPlaceCoins(input: {
  database: ConnectableDatabase;
  userId: string;
  placeId: string;
  source: CoinSaveSource;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  commitWithCharge?: (client: EconomyQueryable, saveEventId: string) => Promise<void>;
  afterSnapshot?: (snapshot: string[]) => Promise<void>;
}): Promise<CoinChargeResult> {
  const placeId = normalizePlaceId(input.placeId);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  if (!placeId) throw new Error("placeId is required");
  if (!idempotencyKey) throw new Error("idempotencyKey is required");

  const client = await input.database.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`coin-save-idempotency:${idempotencyKey}`]);
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`coin-save-place:${input.userId}:${placeId}`]);
    const existingEvent = await client.query<SaveEventRow>(
      "select * from coin_save_events where idempotency_key = $1 or (user_id = $2 and place_id = $3) order by created_at asc limit 1 for update",
      [idempotencyKey, input.userId, placeId],
    );
    const existing = existingEvent.rows[0];
    if (existing) {
      const wallet = await ensureWallet(client, input.userId);
      await client.query("commit");
      return {
        saveEvent: toSaveEventDto(existing),
        wallet,
        alreadyProcessed: true,
      };
    }

    const chargeMillis = input.source === "discover" ? DISCOVER_SAVE_CHARGE_MILLIS : EXTERNAL_IMPORT_CHARGE_MILLIS;
    const rewardPoolMillis = input.source === "discover" ? DISCOVER_REWARD_POOL_MILLIS : 0;
    const platformRetentionMillis = chargeMillis - rewardPoolMillis;
    const limits = getEconomyLimits();
    const recommenders =
      input.source === "discover"
        ? await listDiscoverRecommendersAtSaveTime({ client, userId: input.userId, placeId, limits })
        : [];
    const rewardDistribution = allocateRewardMillis(rewardPoolMillis, recommenders);
    await input.afterSnapshot?.([...recommenders]);

    const walletRow = await client.query<CoinWalletRow>(
      "select * from coin_wallets where user_id = $1 for update",
      [input.userId],
    );
    const wallet = walletRow.rows[0] ? toWalletDto(walletRow.rows[0]) : await ensureWallet(client, input.userId);
    if (wallet.balanceMillis < chargeMillis) {
      throw new Error("INSUFFICIENT_COINS");
    }

    const debited = await client.query<CoinWalletRow>(
      `
        update coin_wallets
        set balance_millis = balance_millis - $2, updated_at = now()
        where user_id = $1 and balance_millis >= $2
        returning *
      `,
      [input.userId, chargeMillis],
    );
    if (!debited.rows[0]) {
      throw new Error("INSUFFICIENT_COINS");
    }
    const nextWallet = toWalletDto(debited.rows[0]);

    const saveEvent = await client.query<SaveEventRow>(
      `
        insert into coin_save_events (
          id, user_id, place_id, source, idempotency_key, charge_millis, reward_pool_millis,
          platform_retention_millis, recommender_snapshot_json, reward_distribution_json,
          rounding_policy, metadata_json, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12::jsonb, now())
        returning *
      `,
      [
        randomUUID(),
        input.userId,
        placeId,
        input.source,
        idempotencyKey,
        chargeMillis,
        rewardPoolMillis,
        platformRetentionMillis,
        JSON.stringify(recommenders),
        JSON.stringify(rewardDistribution),
        ROUNDING_POLICY,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    const event = saveEvent.rows[0];
    const chargeType: CoinTransactionType =
      input.source === "discover" ? "discover_save_charge" : "external_save_charge";

    await client.query(
      `
        insert into coin_transactions (
          id, user_id, wallet_user_id, save_event_id, idempotency_key, type, direction,
          amount_millis, balance_after_millis, related_place_id, metadata_json, created_at
        )
        values ($1, $2, $2, $3, $4, $5, 'debit', $6, $7, $8, $9::jsonb, now())
      `,
      [
        randomUUID(),
        input.userId,
        event.id,
        `save-charge:${event.id}`,
        chargeType,
        chargeMillis,
        nextWallet.balanceMillis,
        placeId,
        JSON.stringify(input.metadata ?? {}),
      ],
    );

    if (platformRetentionMillis > 0) {
      await client.query(
        `
          insert into coin_transactions (
            id, user_id, wallet_user_id, save_event_id, idempotency_key, type, direction,
            amount_millis, balance_after_millis, related_place_id, metadata_json, created_at
          )
          values ($1, $2, null, $3, $4, 'platform_retention', 'pool_credit', $5, null, $6, $7::jsonb, now())
        `,
        [
          randomUUID(),
          input.userId,
          event.id,
          `platform-retention:${event.id}`,
          platformRetentionMillis,
          placeId,
          JSON.stringify({ source: input.source }),
        ],
      );
    }

    if (rewardPoolMillis > 0) {
      await client.query(
        `
          insert into coin_reward_pools (pool_key, balance_millis, created_at, updated_at)
          values ($1, $2, now(), now())
          on conflict (pool_key)
          do update set balance_millis = coin_reward_pools.balance_millis + excluded.balance_millis, updated_at = now()
        `,
        [DISCOVER_REWARD_POOL_KEY, rewardPoolMillis],
      );
      await client.query(
        `
          insert into coin_transactions (
            id, user_id, wallet_user_id, save_event_id, idempotency_key, type, direction,
            amount_millis, balance_after_millis, related_place_id, metadata_json, created_at
          )
          values ($1, $2, null, $3, $4, 'reward_pool_credit', 'pool_credit', $5, null, $6, $7::jsonb, now())
        `,
        [
          randomUUID(),
          input.userId,
          event.id,
          `reward-pool-credit:${event.id}`,
          rewardPoolMillis,
          placeId,
          JSON.stringify({ recommenderCount: recommenders.length, roundingPolicy: ROUNDING_POLICY }),
        ],
      );
    }

    if (input.commitWithCharge) {
      await input.commitWithCharge(client, event.id);
    }

    const totalDistributedMillis = rewardDistribution.reduce((sum, reward) => sum + reward.amountMillis, 0);
    if (totalDistributedMillis > 0) {
      await client.query(
        `
          update coin_reward_pools
          set balance_millis = balance_millis - $2, updated_at = now()
          where pool_key = $1 and balance_millis >= $2
          returning *
        `,
        [DISCOVER_REWARD_POOL_KEY, totalDistributedMillis],
      );
      for (const reward of rewardDistribution) {
        if (reward.amountMillis <= 0) continue;
        await creditWallet({
          client,
          userId: reward.userId,
          amountMillis: reward.amountMillis,
          idempotencyKey: `recommender-reward:${event.id}:${reward.userId}`,
          type: "recommender_reward",
          relatedPlaceId: placeId,
          saveEventId: event.id,
          metadata: {
            source: "discover_save_snapshot",
            recommenderCount: recommenders.length,
            rewardPoolMillis,
            roundingPolicy: ROUNDING_POLICY,
            remainderRank: reward.remainderRank,
          },
        });
      }
      await client.query(
        `
          insert into coin_transactions (
            id, user_id, wallet_user_id, save_event_id, idempotency_key, type, direction,
            amount_millis, balance_after_millis, related_place_id, metadata_json, created_at
          )
          values ($1, $2, null, $3, $4, 'recommender_reward', 'pool_debit', $5, null, $6, $7::jsonb, now())
        `,
        [
          randomUUID(),
          input.userId,
          event.id,
          `reward-pool-debit:${event.id}`,
          totalDistributedMillis,
          placeId,
          JSON.stringify({ recommenderCount: recommenders.length, roundingPolicy: ROUNDING_POLICY }),
        ],
      );
    }

    await client.query("commit");
    return {
      saveEvent: toSaveEventDto(event),
      wallet: nextWallet,
      alreadyProcessed: false,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if (isUniqueViolation(error)) {
      return chargeSavedPlaceCoins(input);
    }
    throw error;
  } finally {
    client.release();
  }
}
