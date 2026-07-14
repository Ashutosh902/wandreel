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
};

export function formatCoinAmount(value: number) {
  return new Intl.NumberFormat("en", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 2,
  }).format(value);
}

export function notifyCoinWalletUpdated(wallet: CoinWallet) {
  window.dispatchEvent(new CustomEvent(COIN_WALLET_UPDATED_EVENT, { detail: { wallet } }));
}

export async function fetchCoinLedger(limit = 25): Promise<CoinLedger> {
  const response = await fetch(`${API_BASE_URL}/api/economy/ledger?limit=${encodeURIComponent(String(limit))}`, {
    credentials: "include",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || "Could not fetch coin ledger.");
  }
  return {
    wallet: payload.wallet,
    transactions: Array.isArray(payload.transactions) ? payload.transactions : [],
  };
}

export function getCoinTransactionLabel(type: string) {
  if (type === "signup_grant" || type === "first_login_grant") return "Welcome coins";
  if (type === "external_save_charge" || type === "external_import_charge") return "External link import";
  if (type === "discover_save_charge") return "Discover save";
  if (type === "recommender_reward") return "Recommendation reward";
  if (type === "platform_retention") return "Platform retention";
  if (type === "refund") return "Refund";
  if (type === "adjustment") return "Adjustment";
  if (type === "reward_pool_credit") return "Reward pool";
  return "Coin activity";
}
