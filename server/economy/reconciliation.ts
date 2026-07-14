import type { EconomyQueryable } from "./store";

export type CoinEconomyReconciliation = {
  walletLiabilitiesMillis: number;
  rewardPoolBalanceMillis: number;
  signupGrantsMillis: number;
  userChargesMillis: number;
  recommenderRewardsMillis: number;
  platformRetentionMillis: number;
  refundsMillis: number;
  adjustmentsMillis: number;
  walletLedgerBalanceMillis: number;
  walletDiscrepancyMillis: number;
};

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

export async function reconcileCoinEconomy(database: EconomyQueryable): Promise<CoinEconomyReconciliation> {
  const result = await database.query<{
    wallet_liabilities_millis: string | number | null;
    reward_pool_balance_millis: string | number | null;
    signup_grants_millis: string | number | null;
    user_charges_millis: string | number | null;
    recommender_rewards_millis: string | number | null;
    platform_retention_millis: string | number | null;
    refunds_millis: string | number | null;
    adjustments_millis: string | number | null;
    wallet_ledger_balance_millis: string | number | null;
  }>(
    `
      with tx as (
        select
          coalesce(sum(case when type = 'signup_grant' then amount_millis else 0 end), 0)::bigint as signup_grants_millis,
          coalesce(sum(case when type in ('external_save_charge', 'discover_save_charge') then amount_millis else 0 end), 0)::bigint as user_charges_millis,
          coalesce(sum(case when type = 'recommender_reward' and wallet_user_id is not null then amount_millis else 0 end), 0)::bigint as recommender_rewards_millis,
          coalesce(sum(case when type = 'platform_retention' then amount_millis else 0 end), 0)::bigint as platform_retention_millis,
          coalesce(sum(case when type = 'refund' then amount_millis else 0 end), 0)::bigint as refunds_millis,
          coalesce(sum(case when type = 'adjustment' then amount_millis else 0 end), 0)::bigint as adjustments_millis,
          coalesce(sum(
            case
              when wallet_user_id is not null and direction = 'credit' then amount_millis
              when wallet_user_id is not null and direction = 'debit' then -amount_millis
              else 0
            end
          ), 0)::bigint as wallet_ledger_balance_millis
        from coin_transactions
      ),
      wallets as (
        select coalesce(sum(balance_millis), 0)::bigint as wallet_liabilities_millis
        from coin_wallets
      ),
      pools as (
        select coalesce(sum(balance_millis), 0)::bigint as reward_pool_balance_millis
        from coin_reward_pools
      )
      select *
      from tx cross join wallets cross join pools
    `,
  );
  const row = result.rows[0] ?? {};
  const walletLiabilitiesMillis = toNumber(row.wallet_liabilities_millis);
  const walletLedgerBalanceMillis = toNumber(row.wallet_ledger_balance_millis);
  return {
    walletLiabilitiesMillis,
    rewardPoolBalanceMillis: toNumber(row.reward_pool_balance_millis),
    signupGrantsMillis: toNumber(row.signup_grants_millis),
    userChargesMillis: toNumber(row.user_charges_millis),
    recommenderRewardsMillis: toNumber(row.recommender_rewards_millis),
    platformRetentionMillis: toNumber(row.platform_retention_millis),
    refundsMillis: toNumber(row.refunds_millis),
    adjustmentsMillis: toNumber(row.adjustments_millis),
    walletLedgerBalanceMillis,
    walletDiscrepancyMillis: walletLiabilitiesMillis - walletLedgerBalanceMillis,
  };
}
