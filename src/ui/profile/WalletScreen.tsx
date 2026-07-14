import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Coins, Info, RotateCcw, X } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { trackCoinEducationEvent } from "../economy/coinEducation";
import {
  fetchCoinLedger,
  formatCoinMillis,
  getCoinTransactionLabel,
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

export function WalletScreen({ onBack }: WalletScreenProps) {
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
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

  useEffect(() => {
    void loadLedger();
  }, [loadLedger]);

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
          <strong>{ledger ? formatCoinMillis(ledger.wallet.balanceMillis ?? Math.round(ledger.wallet.balanceCoins * 1000)) : "..."}</strong>
        </div>
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
