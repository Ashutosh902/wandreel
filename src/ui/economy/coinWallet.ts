const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";

export const COIN_WALLET_UPDATED_EVENT = "wr:coin-wallet-updated";

export type CoinWallet = {
  userId: string;
  balanceCoins: number;
  balanceMillis?: number;
  createdAt: string;
  updatedAt: string;
};

export type CoinTransaction = {
  id: string;
  type: string;
  direction: "credit" | "debit" | "pool_credit" | "pool_debit";
  amountCoins: number;
  amountMillis?: number;
  balanceAfterCoins: number | null;
  balanceAfterMillis?: number | null;
  relatedPlaceId: string | null;
  metadata: unknown;
  createdAt: string;
};

export type CoinLedger = {
  wallet: CoinWallet;
  transactions: CoinTransaction[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalItems?: number;
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

export type CoinLedgerTypeFilter = "all" | "credit" | "debit";
export type CoinLedgerDatePreset = "7d" | "6m" | "custom";
export type CoinLedgerSort = "newest" | "oldest" | "amount_desc" | "amount_asc";

export type FetchCoinLedgerOptions = {
  type?: CoinLedgerTypeFilter;
  datePreset?: CoinLedgerDatePreset;
  from?: string;
  to?: string;
  sort?: CoinLedgerSort;
  page?: number;
};

export function formatCoinMillis(valueMillis: number, options: { signed?: boolean } = {}) {
  const normalized = Number.isSafeInteger(valueMillis) ? valueMillis : Math.round(Number(valueMillis || 0));
  const sign = options.signed && normalized > 0 ? "+" : normalized < 0 ? "-" : "";
  const absolute = Math.abs(normalized);
  const whole = Math.floor(absolute / 1000);
  const remainder = absolute % 1000;
  if (remainder === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(remainder).padStart(3, "0").replace(/0+$/, "")}`;
}

export function formatCoinAmount(value: number) {
  return new Intl.NumberFormat("en", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 3,
  }).format(value);
}

export function notifyCoinWalletUpdated(wallet: CoinWallet) {
  window.dispatchEvent(new CustomEvent(COIN_WALLET_UPDATED_EVENT, { detail: { wallet } }));
}

export async function fetchCoinLedger(options: FetchCoinLedgerOptions = {}): Promise<CoinLedger> {
  const params = new URLSearchParams({
    type: options.type ?? "all",
    datePreset: options.datePreset ?? "6m",
    sort: options.sort ?? "newest",
    page: String(options.page ?? 1),
    pageSize: "25",
    timezoneOffsetMinutes: String(new Date().getTimezoneOffset()),
  });
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);
  const response = await fetch(`${API_BASE_URL}/api/economy/ledger?${params.toString()}`, {
    credentials: "include",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || "Could not fetch coin ledger.");
  }
  return {
    wallet: payload.wallet,
    transactions: Array.isArray(payload.transactions) ? payload.transactions : [],
    pagination: payload.pagination ?? {
      page: 1,
      pageSize: 25,
      totalCount: Array.isArray(payload.transactions) ? payload.transactions.length : 0,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
    },
    filters: payload.filters ?? {
      type: options.type ?? "all",
      datePreset: options.datePreset ?? "6m",
      from: options.from ?? null,
      to: options.to ?? null,
      sort: options.sort ?? "newest",
    },
  };
}

export function getCoinTransactionLabel(type: string) {
  if (type === "signup_grant" || type === "first_login_grant") return "Welcome coins";
  if (type === "external_save_charge" || type === "external_import_charge") return "External link import";
  if (type === "discover_save_charge") return "Discover save";
  if (type === "recommender_reward") return "Community reward";
  if (type === "platform_retention") return "Platform retention";
  if (type === "refund") return "Refund";
  if (type === "adjustment") return "Wallet adjustment";
  if (type === "reward_pool_credit") return "Reward pool";
  return "Coin activity";
}
