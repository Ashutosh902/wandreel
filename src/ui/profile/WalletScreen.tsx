import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, Coins, Info, MapPinPlus, RotateCcw, Sparkles, X } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { trackCoinEducationEvent } from "../economy/coinEducation";
import {
  fetchCoinImpact,
  fetchCoinLedger,
  formatCoinMillis,
  getCoinTransactionLabel,
  type CoinImpact,
  type CoinLedger,
  type CoinLedgerDatePreset,
  type CoinLedgerSort,
  type CoinLedgerTypeFilter,
  type CoinTransaction,
} from "../economy/coinWallet";
import { useDialogFocus } from "../home/useDialogFocus";
import "./profile.css";

type WalletScreenProps = {
  onBack: () => void;
  onRecommendPlace?: () => void;
};

function signedTransactionMillis(transaction: CoinTransaction) {
  const amountMillis = transaction.amountMillis ?? Math.round(transaction.amountCoins * 1000);
  return transaction.direction === "debit" ? -amountMillis : amountMillis;
}

function transactionSubtitle(transaction: CoinTransaction) {
  const metadata = transaction.metadata && typeof transaction.metadata === "object"
    ? transaction.metadata as Record<string, unknown>
    : {};
  const title = String(metadata.title || "").trim();
  if (title) return title;
  if (transaction.relatedPlaceId) return transaction.relatedPlaceId;
  if (transaction.type === "signup_grant") return "First-login reward";
  if (transaction.type === "recommender_reward") return "Earned from a Discover save";
  return "Wallet movement";
}

function formatTransactionDate(value: string) {
  const date = new Date(value);
  return {
    date: date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    time: date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
  };
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en").format(Number.isFinite(value) ? value : 0);
}

function formatMonthDay(value: string | null) {
  if (!value) return "Recently";
  return new Date(value).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function getTrendMax(impact: CoinImpact | null) {
  if (!impact?.monthlyTrend.length) return 1;
  return Math.max(
    1,
    ...impact.monthlyTrend.map((month) => Math.max(month.coinsEarnedMillis, month.communitySaves * 1000, month.recommendations * 1000)),
  );
}

function CoinHelpSheet({ onClose }: { onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);
  return (
    <div className="wr-coin-help-layer" role="presentation">
      <button type="button" className="wr-coin-help-backdrop" aria-label="Close coin help" onClick={onClose} />
      <section
        ref={dialogRef}
        className="wr-coin-help-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wr-coin-help-title"
        aria-describedby="wr-coin-help-description"
        tabIndex={-1}
      >
        <button type="button" className="wr-coin-help-close" aria-label="Close coin help" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
        <h3 id="wr-coin-help-title">How coins work</h3>
        <p id="wr-coin-help-description">Coins help keep saving and recommendations fair inside Wandreel.</p>
        <div className="wr-coin-help-list">
          <div>
            <strong>Welcome reward</strong>
            <span>New users receive 500 coins.</span>
          </div>
          <div>
            <strong>Add from a link</strong>
            <span>Saving from Instagram or another external link costs 2 coins.</span>
          </div>
          <div>
            <strong>Save from Discover</strong>
            <span>Community recommendations cost 1 coin to save.</span>
          </div>
          <div>
            <strong>Recommend places</strong>
            <span>You may earn a share of the community reward when someone saves a place you recommended.</span>
          </div>
        </div>
        <p className="wr-coin-help-note">Coins are virtual in-app credits and currently have no cash value.</p>
      </section>
    </div>
  );
}

export function WalletScreen({ onBack, onRecommendPlace }: WalletScreenProps) {
  const { isAuthenticated } = useAuth();
  const [type, setType] = useState<CoinLedgerTypeFilter>("all");
  const [datePreset, setDatePreset] = useState<CoinLedgerDatePreset>("6m");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");
  const [sort, setSort] = useState<CoinLedgerSort>("newest");
  const [page, setPage] = useState(1);
  const [ledger, setLedger] = useState<CoinLedger | null>(null);
  const [impact, setImpact] = useState<CoinImpact | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isImpactLoading, setIsImpactLoading] = useState(false);
  const [error, setError] = useState("");
  const [impactError, setImpactError] = useState("");
  const [customError, setCustomError] = useState("");
  const [isCoinHelpOpen, setIsCoinHelpOpen] = useState(false);

  const loadLedger = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    setError("");
    try {
      const nextLedger = await fetchCoinLedger({
        type,
        datePreset,
        from: datePreset === "custom" ? appliedFrom : undefined,
        to: datePreset === "custom" ? appliedTo : undefined,
        sort,
        page,
      });
      setLedger(nextLedger);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Could not load wallet activity.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [appliedFrom, appliedTo, datePreset, isAuthenticated, page, sort, type]);

  const loadImpact = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsImpactLoading(true);
    setImpactError("");
    try {
      const nextImpact = await fetchCoinImpact();
      setImpact(nextImpact);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Could not load your impact.";
      setImpactError(message);
    } finally {
      setIsImpactLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void loadLedger();
  }, [loadLedger]);

  useEffect(() => {
    void loadImpact();
    if (isAuthenticated) void trackCoinEducationEvent("impact_opened");
  }, [isAuthenticated, loadImpact]);

  const hasCustomDates = datePreset === "custom";
  const customRangeInvalid = useMemo(() => Boolean(customFrom && customTo && customTo < customFrom), [customFrom, customTo]);

  useEffect(() => {
    if (!hasCustomDates) {
      setCustomError("");
      return;
    }
    setCustomError(customRangeInvalid ? "End date must be on or after start date." : "");
  }, [customRangeInvalid, hasCustomDates]);

  function resetPageAndApply(next: () => void) {
    next();
    setPage(1);
  }

  function applyCustomRange() {
    if (customRangeInvalid) {
      setCustomError("End date must be on or after start date.");
      return;
    }
    setCustomError("");
    setAppliedFrom(customFrom);
    setAppliedTo(customTo);
    setPage(1);
  }

  const visibleWallet = impact?.wallet ?? ledger?.wallet ?? null;
  const trendMax = getTrendMax(impact);
  const hasImpact = Boolean(impact && (
    impact.impact.placesRecommended > 0 ||
    impact.impact.communitySaves > 0 ||
    impact.impact.coinsEarnedMillis > 0 ||
    impact.impact.coinsSavedMillis > 0
  ));

  if (!isAuthenticated) {
    return (
      <main className="wr-wallet-page" aria-label="Wallet">
        <header className="wr-wallet-header">
          <button type="button" className="wr-wallet-icon-btn" onClick={onBack} aria-label="Back to profile">
            <ArrowLeft size={18} />
          </button>
          <h2>Wallet</h2>
        </header>
        <p className="wr-wallet-state">Log in to view wallet activity.</p>
      </main>
    );
  }

  return (
    <main className="wr-wallet-page" aria-label="Wallet">
      <header className="wr-wallet-header">
        <button type="button" className="wr-wallet-icon-btn" onClick={onBack} aria-label="Back to profile">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2>Wallet</h2>
          <p>1 coin = 1000 coin-millis</p>
        </div>
        <button
          type="button"
          className="wr-wallet-help-btn"
          aria-label="How coins work"
          onClick={() => {
            setIsCoinHelpOpen(true);
            void trackCoinEducationEvent("coin_help_opened");
          }}
        >
          <Info size={17} aria-hidden="true" />
        </button>
      </header>

      <section className="wr-wallet-balance" aria-label="Current balance">
        <span className="wr-wallet-balance-icon" aria-hidden="true"><Coins size={20} /></span>
        <div>
          <p>Current balance</p>
          <strong>{visibleWallet ? formatCoinMillis(visibleWallet.balanceMillis ?? Math.round(visibleWallet.balanceCoins * 1000)) : "..."}</strong>
          <small>
            This month <b>+{impact ? formatCoinMillis(impact.month.earnedMillis) : "..."}</b> earned <b>-{impact ? formatCoinMillis(impact.month.spentMillis) : "..."}</b> spent <b>{impact ? formatCoinMillis(impact.month.netMillis, { signed: true }) : "..."}</b> net
          </small>
        </div>
      </section>

      <section className="wr-impact" aria-labelledby="wr-impact-title">
        <div className="wr-impact-hero">
          <Sparkles size={18} aria-hidden="true" />
          <p>You helped</p>
          <strong>{impact ? formatInteger(impact.impact.travelersHelped) : "..."}</strong>
          <span>travelers discover amazing places.</span>
        </div>
        <div className="wr-impact-heading">
          <div>
            <h3 id="wr-impact-title">Your Impact</h3>
            <p>{impact ? `${impact.contributionScore.level} · Contribution Score ${impact.contributionScore.score}/100` : "Loading your community impact"}</p>
          </div>
          <span className="wr-impact-score" aria-label={impact ? `Contribution Score ${impact.contributionScore.score} out of 100` : "Contribution Score loading"}>
            {impact ? `${impact.contributionScore.score}/100` : "..."}
          </span>
        </div>

        {impactError ? (
          <div className="wr-wallet-state">
            <p>{impactError}</p>
            <button type="button" onClick={() => void loadImpact()}>
              <RotateCcw size={15} aria-hidden="true" />
              Retry
            </button>
          </div>
        ) : isImpactLoading && !impact ? (
          <div className="wr-impact-summary-grid" aria-label="Loading your impact">
            {Array.from({ length: 6 }, (_unused, index) => <span className="wr-impact-skeleton" key={index} />)}
          </div>
        ) : impact && !hasImpact ? (
          <div className="wr-impact-empty">
            <MapPinPlus size={18} aria-hidden="true" />
            <strong>Start recommending amazing places.</strong>
            <p>When other travelers save them, you'll earn community rewards.</p>
            <button
              type="button"
              onClick={() => {
                void trackCoinEducationEvent("impact_empty_cta_clicked");
                onRecommendPlace?.();
              }}
            >
              Recommend a Place
            </button>
          </div>
        ) : impact ? (
          <>
            <div className="wr-impact-summary-grid">
              {[
                ["Travelers Helped", impact.impact.travelersHelped],
                ["Places Added", impact.impact.placesAdded],
                ["Community Saves", impact.impact.communitySaves],
                ["Places Recommended", impact.impact.placesRecommended],
                ["Coins Earned", formatCoinMillis(impact.impact.coinsEarnedMillis)],
                ["Coins Saved", formatCoinMillis(impact.impact.coinsSavedMillis)],
              ].map(([label, value]) => (
                <article className="wr-impact-summary-card" key={label}>
                  <strong>{typeof value === "number" ? formatInteger(value) : value}</strong>
                  <span>{label}</span>
                </article>
              ))}
            </div>

            <div className="wr-impact-recent" aria-label="Past 30 days">
              <h4>Past 30 Days</h4>
              <div>
                <span>Recommendations <b>{formatInteger(impact.summary30Days.recommendations)}</b></span>
                <span>Community Saves <b>{formatInteger(impact.summary30Days.communitySaves)}</b></span>
                <span>Coins Earned <b>+{formatCoinMillis(impact.summary30Days.coinsEarnedMillis)}</b></span>
                <span>Coins Saved <b>{formatCoinMillis(impact.summary30Days.coinsSavedMillis)}</b></span>
              </div>
            </div>

            <section className="wr-impact-top" aria-labelledby="wr-impact-top-title">
              <h4 id="wr-impact-top-title">Top Recommendations</h4>
              {impact.topRecommendations.length ? impact.topRecommendations.map((place) => (
                <button
                  type="button"
                  className="wr-impact-top-card"
                  key={place.placeId}
                  onClick={() => void trackCoinEducationEvent("impact_top_place_clicked")}
                >
                  <span>
                    <strong>{place.title}</strong>
                    <small>Added {formatMonthDay(place.addedAt)}</small>
                  </span>
                  <span>
                    <b>{formatInteger(place.communitySaves)}</b>
                    <small>Travelers</small>
                  </span>
                  <span>
                    <b>{formatCoinMillis(place.coinsEarnedMillis)}</b>
                    <small>Coins earned</small>
                  </span>
                </button>
              )) : (
                <p className="wr-impact-muted">Your top recommendations will appear after travelers save them.</p>
              )}
            </section>

            <section className="wr-impact-trend" aria-labelledby="wr-impact-trend-title">
              <div className="wr-impact-trend-title">
                <BarChart3 size={16} aria-hidden="true" />
                <h4 id="wr-impact-trend-title">Monthly Trend</h4>
              </div>
              <div className="wr-impact-bars">
                {impact.monthlyTrend.map((month) => {
                  const earnedHeight = Math.max(4, Math.round((month.coinsEarnedMillis / trendMax) * 100));
                  const savesHeight = Math.max(4, Math.round(((month.communitySaves * 1000) / trendMax) * 100));
                  const recHeight = Math.max(4, Math.round(((month.recommendations * 1000) / trendMax) * 100));
                  return (
                    <button
                      type="button"
                      className="wr-impact-bar-group"
                      key={month.month}
                      aria-label={`${month.label}: ${formatCoinMillis(month.coinsEarnedMillis)} coins earned, ${month.communitySaves} community saves, ${month.recommendations} recommendations`}
                      onClick={() => void trackCoinEducationEvent("impact_month_changed")}
                    >
                      <span style={{ height: `${earnedHeight}%` }} className="is-earned" />
                      <span style={{ height: `${savesHeight}%` }} className="is-saves" />
                      <span style={{ height: `${recHeight}%` }} className="is-recs" />
                      <small>{month.month.slice(5)}</small>
                    </button>
                  );
                })}
              </div>
              <div className="wr-impact-legend" aria-hidden="true">
                <span>Coins Earned</span>
                <span>Community Saves</span>
                <span>Recommendations</span>
              </div>
            </section>
          </>
        ) : null}
      </section>

      <section className="wr-wallet-controls" aria-label="Wallet filters">
        <div className="wr-wallet-tabs" role="tablist" aria-label="Transaction type">
          {([
            ["all", "All"],
            ["credit", "Credits"],
            ["debit", "Debits"],
          ] as const).map(([value, label]) => (
            <button
              type="button"
              key={value}
              role="tab"
              aria-selected={type === value}
              className={type === value ? "is-active" : ""}
              disabled={isLoading}
              onClick={() => resetPageAndApply(() => setType(value))}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="wr-wallet-filter-grid">
          <label>
            Range
            <select
              value={datePreset}
              disabled={isLoading}
              onChange={(event) => resetPageAndApply(() => setDatePreset(event.target.value as CoinLedgerDatePreset))}
            >
              <option value="7d">Last 7 days</option>
              <option value="6m">Last 6 months</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            Sort
            <select value={sort} disabled={isLoading} onChange={(event) => resetPageAndApply(() => setSort(event.target.value as CoinLedgerSort))}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="amount_desc">Amount high to low</option>
              <option value="amount_asc">Amount low to high</option>
            </select>
          </label>
        </div>

        {hasCustomDates ? (
          <div className="wr-wallet-custom-range">
            <label>
              From
              <input type="date" value={customFrom} disabled={isLoading} onChange={(event) => setCustomFrom(event.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={customTo} disabled={isLoading} onChange={(event) => setCustomTo(event.target.value)} />
            </label>
            <button type="button" onClick={applyCustomRange} disabled={customRangeInvalid || isLoading}>Apply</button>
            <button
              type="button"
              disabled={isLoading}
              onClick={() => {
                setCustomFrom("");
                setCustomTo("");
                setAppliedFrom("");
                setAppliedTo("");
                setDatePreset("6m");
                setCustomError("");
                setPage(1);
              }}
            >
              Clear
            </button>
          </div>
        ) : null}
        {customError ? <p className="wr-wallet-error">{customError}</p> : null}
      </section>

      <section className="wr-wallet-list" aria-label="Wallet transactions">
        {error ? (
          <div className="wr-wallet-state">
            <p>{error}</p>
            <button type="button" onClick={() => void loadLedger()}>
              <RotateCcw size={15} aria-hidden="true" />
              Retry
            </button>
          </div>
        ) : isLoading && !ledger ? (
          <div className="wr-wallet-skeleton-list" aria-label="Loading wallet activity">
            {Array.from({ length: 3 }, (_unused, index) => (
              <div className="wr-wallet-skeleton-row" key={index}>
                <span />
                <strong />
              </div>
            ))}
          </div>
        ) : ledger?.transactions.length ? (
          ledger.transactions.map((transaction) => {
            const signedMillis = signedTransactionMillis(transaction);
            const when = formatTransactionDate(transaction.createdAt);
            return (
              <article className="wr-wallet-transaction-row" key={transaction.id}>
                <div>
                  <h3>{getCoinTransactionLabel(transaction.type)}</h3>
                  <p>{transactionSubtitle(transaction)}</p>
                  <small>{when.date} at {when.time}</small>
                </div>
                <strong className={signedMillis < 0 ? "is-debit" : "is-credit"}>
                  {formatCoinMillis(signedMillis, { signed: true })}
                </strong>
              </article>
            );
          })
        ) : (
          <p className="wr-wallet-state">{isLoading ? "Loading wallet activity..." : "No wallet activity for these filters."}</p>
        )}
      </section>

      <footer className="wr-wallet-pagination" aria-label="Wallet pagination">
        <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={!ledger?.pagination.hasPreviousPage || isLoading}>
          Previous
        </button>
        <span>
          Page {ledger?.pagination.page ?? page} of {ledger?.pagination.totalPages ?? 1}
          {ledger ? ` (${ledger.pagination.totalCount} total)` : ""}
        </span>
        <button type="button" onClick={() => setPage((current) => current + 1)} disabled={!ledger?.pagination.hasNextPage || isLoading}>
          Next
        </button>
      </footer>
      {isCoinHelpOpen ? <CoinHelpSheet onClose={() => setIsCoinHelpOpen(false)} /> : null}
    </main>
  );
}
