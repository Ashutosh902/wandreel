const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";

export type CoinPricing = {
  coinMillisPerCoin: number;
  welcomeGrantCoins: number;
  welcomeGrantMillis: number;
  externalSaveCoins: number;
  externalSaveMillis: number;
  discoverSaveCoins: number;
  discoverSaveMillis: number;
};

export type CoinOnboardingState = {
  completed: boolean;
  completedAt: string | null;
  eligible: boolean;
};

export type CoinEducationEvent =
  | "coin_onboarding_viewed"
  | "coin_onboarding_explore_discover_clicked"
  | "coin_onboarding_add_place_clicked"
  | "coin_onboarding_dismissed"
  | "coin_help_opened"
  | "impact_opened"
  | "impact_top_place_clicked"
  | "impact_month_changed"
  | "impact_empty_cta_clicked";

const DEFAULT_PRICING: CoinPricing = {
  coinMillisPerCoin: 1000,
  welcomeGrantCoins: 500,
  welcomeGrantMillis: 500_000,
  externalSaveCoins: 2,
  externalSaveMillis: 2_000,
  discoverSaveCoins: 1,
  discoverSaveMillis: 1_000,
};

export function getDefaultCoinPricing() {
  return DEFAULT_PRICING;
}

export async function fetchCoinPricing(): Promise<CoinPricing> {
  const response = await fetch(`${API_BASE_URL}/api/economy/pricing`, {
    credentials: "include",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || "Could not fetch coin pricing.");
  }
  return { ...DEFAULT_PRICING, ...(payload.pricing ?? {}) };
}

export async function fetchCoinOnboarding(): Promise<CoinOnboardingState> {
  const response = await fetch(`${API_BASE_URL}/api/economy/onboarding`, {
    credentials: "include",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || "Could not fetch coin onboarding.");
  }
  return {
    completed: Boolean(payload.completed),
    completedAt: payload.completedAt ?? null,
    eligible: Boolean(payload.eligible),
  };
}

export async function completeCoinOnboarding(): Promise<CoinOnboardingState> {
  const response = await fetch(`${API_BASE_URL}/api/economy/onboarding/complete`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || "Could not save coin onboarding.");
  }
  return {
    completed: Boolean(payload.completed),
    completedAt: payload.completedAt ?? null,
    eligible: Boolean(payload.eligible),
  };
}

export function formatCoinRule(value: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 3,
  }).format(value);
}

export async function trackCoinEducationEvent(eventType: CoinEducationEvent) {
  try {
    await fetch(`${API_BASE_URL}/api/analytics/app-event`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType }),
    });
  } catch {
    // Best-effort analytics must never block education or navigation.
  }
}
