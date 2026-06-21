import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  fetchAdminLinkDetail,
  fetchAdminLinks,
  fetchAdminOverview,
  fetchAdminUsageOverview,
  fetchAdminUsageUsers,
  fetchAllAdminLinks,
  type AdminLinkDetailAttempt,
  type AdminLinkDetailResponse,
  type AdminLinkDetailRun,
  type AdminLinkRow,
  type AdminOverviewResponse,
  type AdminUsageOverviewResponse,
  type AdminUsageUserRow,
} from "./adminApi";
import "./admin.css";

type MetricCardTone = "blue" | "green" | "amber" | "red" | "neutral";
type AdminTab = "diagnostics" | "customer";

type MetricCard = {
  label: string;
  value: string;
  tone: MetricCardTone;
  hint?: string;
};

type InsightCard = {
  title: string;
  value: string;
  tone: MetricCardTone;
};

type DerivedStats = {
  uniqueLinks: number;
  totalRuns: number;
  totalAttempts: number;
  avgAttemptsPerRun: number;
  saveRate: number;
  cacheReuseCount: number;
  estimatedCostSaved: number;
  ocrAcceptedCount: number;
  descriptionAcceptedCount: number;
  savedLinkCount: number;
  reusedLinkCount: number;
  mostRecentSeenAt: string | null;
};

function formatInteger(value: number | null | undefined) {
  const normalized = Number.isFinite(value) ? Number(value) : 0;
  return new Intl.NumberFormat().format(normalized);
}

function formatPercent(value: number | null | undefined) {
  const normalized = Number.isFinite(value) ? Number(value) : 0;
  return `${(normalized * 100).toFixed(1)}%`;
}

function formatAverage(value: number | null | undefined) {
  if (value === null || typeof value === "undefined") return "-";
  if (!Number.isFinite(value)) return "-";
  const digits = Math.abs(value) >= 10 ? 1 : 2;
  return Number(value).toFixed(digits);
}

function formatCurrencyInr(value: number | null | undefined) {
  const normalized = Number.isFinite(value) ? Number(value) : 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(normalized);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function joinValues(values: Array<string | null | undefined>) {
  const filtered = values.filter((value): value is string => Boolean(value && String(value).trim()));
  return filtered.length ? filtered.join(", ") : "-";
}

function renderEmptyState(message: string) {
  return <div className="wr-admin-empty">{message}</div>;
}

function toBadgeTone(value: string | null | undefined): MetricCardTone {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "saved" || normalized === "saved_place" || normalized === "ocr" || normalized === "success" || normalized === "active") return "green";
  if (normalized === "description" || normalized === "logged_in" || normalized === "new") return "blue";
  if (normalized === "discarded" || normalized === "failed" || normalized === "dropped_after_extraction") return "red";
  if (normalized === "edited" || normalized === "retry" || normalized === "repeat_user" || normalized === "anonymous") return "amber";
  return "neutral";
}

function prettifyBadge(value: string | null | undefined) {
  if (!value) return "-";
  return value.replaceAll("_", " ");
}

function renderBadge(value: string | null | undefined, label?: string) {
  const text = prettifyBadge(value);
  return (
    <span className={`wr-admin-badge wr-admin-badge-${toBadgeTone(value)}`}>
      {label ? `${label}: ${text}` : text}
    </span>
  );
}

function buildDerivedStats(overview: AdminOverviewResponse | null, rows: AdminLinkRow[]): DerivedStats {
  const totalRunsFromRows = rows.reduce((sum, row) => sum + Number(row.runCount || 0), 0);
  const totalAttemptsFromRows = rows.reduce((sum, row) => sum + Number(row.attemptCount || 0), 0);
  const cacheReuseCount =
    overview?.estimates?.cacheReuseCount ??
    rows.reduce((sum, row) => sum + Number(row.cacheReuseCount || 0), 0);
  const uniqueLinks = rows.length;
  const savedLinkCount = rows.filter((row) => row.finalUserAction === "saved").length;
  const ocrAcceptedCount = rows.filter((row) => String(row.latestAcceptedAfter || "").toLowerCase() === "ocr").length;
  const descriptionAcceptedCount = rows.filter((row) => String(row.latestAcceptedAfter || "").toLowerCase() === "description").length;
  const reusedLinkCount = rows.filter((row) => Number(row.cacheReuseCount || 0) > 0).length;
  const mostRecentSeenAt =
    rows
      .map((row) => row.lastSeenAt)
      .filter(Boolean)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;

  const totalRuns = overview?.totals?.runs ?? totalRunsFromRows;
  const totalAttempts = overview?.totals?.attempts ?? totalAttemptsFromRows;
  const avgAttemptsPerRun =
    overview?.averages?.attemptCount ??
    (totalRuns > 0 ? totalAttemptsFromRows / totalRunsFromRows : 0);
  const saveRate =
    overview?.rates?.saveRate ??
    (uniqueLinks > 0 ? savedLinkCount / uniqueLinks : 0);

  return {
    uniqueLinks,
    totalRuns,
    totalAttempts,
    avgAttemptsPerRun,
    saveRate,
    cacheReuseCount,
    estimatedCostSaved: cacheReuseCount * 5,
    ocrAcceptedCount,
    descriptionAcceptedCount,
    savedLinkCount,
    reusedLinkCount,
    mostRecentSeenAt,
  };
}

function buildDiagnosticsMetricCards(stats: DerivedStats): MetricCard[] {
  return [
    { label: "Unique links", value: formatInteger(stats.uniqueLinks), tone: "blue" },
    { label: "Total runs", value: formatInteger(stats.totalRuns), tone: "blue" },
    { label: "Total attempts", value: formatInteger(stats.totalAttempts), tone: "blue" },
    { label: "Avg attempts per run", value: formatAverage(stats.avgAttemptsPerRun), tone: "amber" },
    { label: "Save rate", value: formatPercent(stats.saveRate), tone: "green" },
    { label: "Cache reuse count", value: formatInteger(stats.cacheReuseCount), tone: "green" },
    { label: "Estimated extraction cost saved", value: formatCurrencyInr(stats.estimatedCostSaved), tone: "green", hint: "Estimate at Rs 5 per reuse" },
    { label: "OCR accepted count", value: formatInteger(stats.ocrAcceptedCount), tone: "amber" },
    { label: "Description accepted count", value: formatInteger(stats.descriptionAcceptedCount), tone: "blue" },
    { label: "Saved link count", value: formatInteger(stats.savedLinkCount), tone: "green" },
    { label: "Reused link count", value: formatInteger(stats.reusedLinkCount), tone: "green" },
  ];
}

function buildDiagnosticsInsightCards(stats: DerivedStats): InsightCard[] {
  return [
    { title: "Cache reuse saved approximately", value: formatCurrencyInr(stats.estimatedCostSaved), tone: "green" },
    { title: "Links accepted after OCR", value: formatInteger(stats.ocrAcceptedCount), tone: "amber" },
    { title: "Links saved", value: formatInteger(stats.savedLinkCount), tone: "green" },
    { title: "Average attempts per run", value: formatAverage(stats.avgAttemptsPerRun), tone: "blue" },
    { title: "Most recent link seen", value: formatDateTime(stats.mostRecentSeenAt), tone: "neutral" },
  ];
}

function buildCustomerMetricCards(overview: AdminUsageOverviewResponse | null): MetricCard[] {
  const summary = overview?.summary;
  const rates = overview?.rates;
  const activity = overview?.activity;
  return [
    { label: "Logged-in users", value: formatInteger(summary?.loggedInUsers), tone: "blue" },
    { label: "Anonymous users", value: formatInteger(summary?.anonymousUsers), tone: "amber" },
    { label: "Unique users", value: formatInteger(summary?.uniqueUsers), tone: "blue" },
    { label: "New users", value: formatInteger(summary?.newUsers), tone: "blue" },
    { label: "Returning users", value: formatInteger(summary?.returningUsers), tone: "green" },
    { label: "Repeat users", value: formatInteger(summary?.repeatUsers), tone: "amber" },
    { label: "Users submitted at least one link", value: formatInteger(summary?.usersSubmittedAtLeastOneLink), tone: "blue" },
    { label: "Users saved at least one place", value: formatInteger(summary?.usersSavedAtLeastOnePlace), tone: "green" },
    { label: "Users with 2+ saved places", value: formatInteger(summary?.usersWithTwoPlusSavedPlaces), tone: "green" },
    { label: "Submitted but did not save", value: formatInteger(summary?.usersSubmittedButDidNotSave), tone: "red" },
    { label: "Total saved places", value: formatInteger(summary?.totalSavedPlaces), tone: "green" },
    { label: "Saves per user", value: formatAverage(rates?.savesPerUser), tone: "green" },
    { label: "Links per user", value: formatAverage(rates?.linksPerUser), tone: "blue" },
    { label: "Save rate per user", value: formatPercent(rates?.saveRatePerUser), tone: "green" },
    { label: "Last active", value: formatDateTime(activity?.lastActiveAt), tone: "neutral" },
  ];
}

function buildCustomerInsightCards(overview: AdminUsageOverviewResponse | null): InsightCard[] {
  const summary = overview?.summary;
  const rates = overview?.rates;
  const activity = overview?.activity;
  return [
    { title: "Users saved at least one place", value: formatInteger(summary?.usersSavedAtLeastOnePlace), tone: "green" },
    { title: "Users submitted but did not save", value: formatInteger(summary?.usersSubmittedButDidNotSave), tone: "red" },
    { title: "Repeat users", value: formatInteger(summary?.repeatUsers), tone: "amber" },
    { title: "Save rate per user", value: formatPercent(rates?.saveRatePerUser), tone: "green" },
    { title: "Last active at", value: formatDateTime(activity?.lastActiveAt), tone: "neutral" },
  ];
}

function renderAttemptSection(title: string, items: ReactNode[]) {
  return (
    <section className="wr-admin-attempt-section">
      <div className="wr-admin-section-heading">{title}</div>
      {items.length ? items : renderEmptyState(`No ${title.toLowerCase()} rows`)}
    </section>
  );
}

function AttemptCard({ attempt }: { attempt: AdminLinkDetailAttempt }) {
  return (
    <article className="wr-admin-attempt-card">
      <div className="wr-admin-attempt-header">
        <div>
          <strong>Attempt #{attempt.attemptNumber ?? "-"}</strong>
          <div className="wr-admin-inline-badges">
            {renderBadge(attempt.status)}
            {renderBadge(attempt.acceptedAfter, "acceptedAfter")}
            {renderBadge(attempt.route, "route")}
          </div>
        </div>
        <div className="wr-admin-muted-text">{formatDateTime(attempt.createdAt)}</div>
      </div>
      <div className="wr-admin-key-grid">
        <div><span>Trigger</span><strong>{attempt.triggerType || "-"}</strong></div>
        <div><span>Intelligence</span><strong>{attempt.intelligenceStatus || "-"}</strong></div>
        <div><span>Total Latency</span><strong>{attempt.totalLatencyMs ?? "-"} ms</strong></div>
        <div><span>Validation Errors</span><strong>{attempt.validationErrorCount ?? 0}</strong></div>
        <div><span>Entities</span><strong>{attempt.entityCount ?? 0}</strong></div>
        <div><span>Model</span><strong>{attempt.model || "-"}</strong></div>
      </div>
      {attempt.failureReason ? <div className="wr-admin-inline-note">Failure: {attempt.failureReason}</div> : null}
      {renderAttemptSection("Stages", (attempt.stages || []).map((stage) => (
        <div key={stage.id} className="wr-admin-list-row">
          <strong>{stage.stage}</strong>
          <span>{renderBadge(stage.status)}</span>
          <span>{stage.latencyMs ?? 0} ms</span>
          <span>{formatDateTime(stage.finishedAt || stage.createdAt)}</span>
        </div>
      )))}
      {renderAttemptSection("Evidence", (attempt.evidence || []).map((item) => (
        <div key={item.id} className="wr-admin-list-block">
          <div className="wr-admin-list-row">
            <strong>{item.evidenceType}</strong>
            <span>#{item.position ?? 0}</span>
            <span>{formatDateTime(item.createdAt)}</span>
          </div>
          <div className="wr-admin-muted-text">{item.summaryText || item.sourceRef || "-"}</div>
        </div>
      )))}
      {renderAttemptSection("Entities", (attempt.entities || []).map((entity) => (
        <div key={entity.id} className="wr-admin-list-block">
          <div className="wr-admin-list-row">
            <strong>{entity.title || `Entity #${entity.entityIndex ?? "-"}`}</strong>
            <span>{entity.entityType || "-"}</span>
            <span>{renderBadge(entity.confidence !== null && typeof entity.confidence !== "undefined" ? String(entity.confidence) : null, "confidence")}</span>
          </div>
          <div className="wr-admin-muted-text">
            {joinValues([entity.subtitle, entity.wasSaved ? "saved" : null, entity.wasEdited ? "edited" : null, entity.wasDiscarded ? "discarded" : null])}
          </div>
        </div>
      )))}
      {renderAttemptSection("Edit diffs", (attempt.edits || []).filter((edit) => edit.attemptNumber === attempt.attemptNumber).map((edit) => (
        <div key={edit.id} className="wr-admin-list-row">
          <strong>{edit.fieldName}</strong>
          <span>Entity #{edit.entityIndex ?? "-"}</span>
          <span>{edit.editedByUserId || "Unknown user"}</span>
          <span>{formatDateTime(edit.createdAt)}</span>
        </div>
      )))}
    </article>
  );
}

function RunCard({ run }: { run: AdminLinkDetailRun }) {
  return (
    <article className="wr-admin-run">
      <div className="wr-admin-run-header">
        <div>
          <strong>Run {run.id}</strong>
          <div className="wr-admin-muted-text">{run.clientRunId || "No client run id"}</div>
        </div>
        <div className="wr-admin-inline-badges">
          {renderBadge(run.latestOutcome, "final action")}
          <span className="wr-admin-muted-text">{formatDateTime(run.createdAt)}</span>
        </div>
      </div>
      <div className="wr-admin-key-grid">
        <div><span>Source Platform</span><strong>{run.sourcePlatform || "-"}</strong></div>
        <div><span>Latest Attempt</span><strong>{run.latestAttemptNumber ?? "-"}</strong></div>
        <div><span>Saved On</span><strong>{run.firstSavedAttemptNumber ?? "-"}</strong></div>
        <div><span>Edited On</span><strong>{run.firstEditedAttemptNumber ?? "-"}</strong></div>
        <div><span>Discarded On</span><strong>{run.firstDiscardedAttemptNumber ?? "-"}</strong></div>
        <div><span>User</span><strong>{run.userId || run.anonymousId || "-"}</strong></div>
      </div>
      <div className="wr-admin-source-url" title={run.sourceUrl}>{run.sourceUrl}</div>
      <section className="wr-admin-attempt-section">
        <div className="wr-admin-section-heading">Attempts</div>
        <div className="wr-admin-attempts">
          {run.attempts?.length ? run.attempts.map((attempt) => <AttemptCard key={attempt.id} attempt={attempt} />) : renderEmptyState("No attempts")}
        </div>
      </section>
      <section className="wr-admin-attempt-section">
        <div className="wr-admin-section-heading">Events</div>
        {run.events?.length ? run.events.map((event) => (
          <div key={event.id} className="wr-admin-list-row">
            <strong>{event.eventName}</strong>
            <span>Attempt #{event.attemptNumber ?? "-"}</span>
            <span>{formatDateTime(event.createdAt)}</span>
          </div>
        )) : renderEmptyState("No events")}
      </section>
    </article>
  );
}

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>("diagnostics");
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [links, setLinks] = useState<AdminLinkRow[]>([]);
  const [statsRows, setStatsRows] = useState<AdminLinkRow[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [platform, setPlatform] = useState<string | "">("");
  const [acceptedAfter, setAcceptedAfter] = useState<string | "">("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminLinkDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [usageOverview, setUsageOverview] = useState<AdminUsageOverviewResponse | null>(null);
  const [usageUsers, setUsageUsers] = useState<AdminUsageUserRow[]>([]);
  const [usageTotal, setUsageTotal] = useState(0);
  const [usagePage, setUsagePage] = useState(1);
  const [usagePageSize, setUsagePageSize] = useState(20);
  const [usageUserType, setUsageUserType] = useState<string>("");
  const [usageStatus, setUsageStatus] = useState<string>("");
  const [usagePlatform, setUsagePlatform] = useState<string>("");
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setUsageLoading(true);
    Promise.all([
      fetchAdminOverview(),
      fetchAdminLinks({ page, pageSize }),
      fetchAllAdminLinks(),
      fetchAdminUsageOverview(),
      fetchAdminUsageUsers({ page: usagePage, pageSize: usagePageSize }),
    ])
      .then(([ov, linksRes, statsRes, usageOverviewRes, usageUsersRes]) => {
        if (!mounted) return;
        if ((!ov.ok && (ov.status === 401 || ov.status === 403)) || (!usageOverviewRes.ok && (usageOverviewRes.status === 401 || usageOverviewRes.status === 403))) {
          setError("Admin access required");
          setUsageError("Admin access required");
          setLoading(false);
          setUsageLoading(false);
          return;
        }
        setOverview(ov);
        setLinks(linksRes.rows || []);
        setStatsRows(statsRes.rows || []);
        setTotal(Number(linksRes.pagination?.total || 0));
        setLoading(false);

        setUsageOverview(usageOverviewRes);
        setUsageUsers(usageUsersRes.rows || []);
        setUsageTotal(Number(usageUsersRes.pagination?.total || 0));
        setUsageLoading(false);
      })
      .catch((e) => {
        if (!mounted) return;
        const message = String(e);
        setError(message);
        setUsageError(message);
        setLoading(false);
        setUsageLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function runFilterFetch(nextPage = 1, overrides?: Partial<{ platform: string; acceptedAfter: string; q: string }>) {
    const nextPlatform = overrides?.platform ?? platform;
    const nextAcceptedAfter = overrides?.acceptedAfter ?? acceptedAfter;
    const nextQuery = overrides?.q ?? q;
    setLoading(true);
    setError(null);
    const [tableRes, statsRes, overviewRes] = await Promise.all([
      fetchAdminLinks({ page: nextPage, pageSize, platform: nextPlatform || undefined, acceptedAfter: nextAcceptedAfter || undefined, q: nextQuery || undefined }),
      fetchAllAdminLinks({ platform: nextPlatform || undefined, acceptedAfter: nextAcceptedAfter || undefined, q: nextQuery || undefined }),
      fetchAdminOverview({ platform: nextPlatform || undefined }),
    ]);
    if (!tableRes.ok && (tableRes.status === 401 || tableRes.status === 403)) {
      setError("Admin access required");
      setLoading(false);
      return;
    }
    setOverview(overviewRes.ok ? overviewRes : null);
    setLinks(tableRes.rows || []);
    setStatsRows(statsRes.rows || []);
    setTotal(Number(tableRes.pagination?.total || 0));
    setPage(nextPage);
    setLoading(false);
  }

  async function clearFilters() {
    setPlatform("");
    setAcceptedAfter("");
    setQ("");
    await runFilterFetch(1, { platform: "", acceptedAfter: "", q: "" });
  }

  async function runUsageFetch(nextPage = 1, overrides?: Partial<{ userType: string; status: string; platform: string; pageSize: number }>) {
    const nextUserType = overrides?.userType ?? usageUserType;
    const nextStatus = overrides?.status ?? usageStatus;
    const nextPlatform = overrides?.platform ?? usagePlatform;
    const nextPageSize = overrides?.pageSize ?? usagePageSize;
    setUsageLoading(true);
    setUsageError(null);
    const [overviewRes, usersRes] = await Promise.all([
      fetchAdminUsageOverview({
        userType: nextUserType || undefined,
        platform: nextPlatform || undefined,
      }),
      fetchAdminUsageUsers({
        page: nextPage,
        pageSize: nextPageSize,
        userType: nextUserType || undefined,
        status: nextStatus || undefined,
        platform: nextPlatform || undefined,
      }),
    ]);
    if (!usersRes.ok && (usersRes.status === 401 || usersRes.status === 403)) {
      setUsageError("Admin access required");
      setUsageLoading(false);
      return;
    }
    if (!overviewRes.ok || !usersRes.ok) {
      setUsageOverview(null);
      setUsageUsers([]);
      setUsageTotal(0);
      setUsageError(
        String(overviewRes.error || usersRes.error || "Customer usage API request failed"),
      );
      setUsageLoading(false);
      return;
    }
    setUsageOverview(overviewRes);
    setUsageUsers(usersRes.rows || []);
    setUsageTotal(Number(usersRes.pagination?.total || 0));
    setUsagePage(nextPage);
    setUsagePageSize(nextPageSize);
    setUsageLoading(false);
  }

  async function clearUsageFilters() {
    setUsageUserType("");
    setUsageStatus("");
    setUsagePlatform("");
    setUsagePageSize(20);
    await runUsageFetch(1, { userType: "", status: "", platform: "", pageSize: 20 });
  }

  async function openDetail(row: AdminLinkRow) {
    setSelected(null);
    setDetailLoading(true);
    const res = await fetchAdminLinkDetail(row.submittedLinkId);
    if (!res.ok && (res.status === 401 || res.status === 403)) {
      setError("Admin access required");
      setDetailLoading(false);
      return;
    }
    setSelected(res);
    setDetailLoading(false);
  }

  const pages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const usagePages = useMemo(() => Math.max(1, Math.ceil(usageTotal / usagePageSize)), [usageTotal, usagePageSize]);
  const derivedStats = useMemo(() => buildDerivedStats(overview, statsRows), [overview, statsRows]);
  const metricCards = useMemo(() => buildDiagnosticsMetricCards(derivedStats), [derivedStats]);
  const insightCards = useMemo(() => buildDiagnosticsInsightCards(derivedStats), [derivedStats]);
  const customerMetricCards = useMemo(() => buildCustomerMetricCards(usageOverview), [usageOverview]);
  const customerInsightCards = useMemo(() => buildCustomerInsightCards(usageOverview), [usageOverview]);

  return (
    <div className="wr-admin-shell">
      <div className="wr-admin-root">
        <header className="wr-admin-hero">
          <div>
            <div className="wr-admin-kicker">Observability Console</div>
            <h1>Wandreel Admin</h1>
            <p>Extraction observability &amp; usage diagnostics</p>
          </div>
          <div className="wr-admin-status-pill">Admin only</div>
        </header>

        <div className="wr-admin-tabs">
          <button className={`wr-admin-tab${activeTab === "diagnostics" ? " wr-admin-tab-active" : ""}`} onClick={() => setActiveTab("diagnostics")}>
            Extraction / Link Diagnostics
          </button>
          <button className={`wr-admin-tab${activeTab === "customer" ? " wr-admin-tab-active" : ""}`} onClick={() => setActiveTab("customer")}>
            Customer Usage / Experience
          </button>
        </div>

        {activeTab === "diagnostics" ? (
          <>
            {error ? <div className="wr-admin-error">{error}</div> : null}
            <section className="wr-admin-panel">
              <div className="wr-admin-panel-head">
                <div>
                  <h2>Summary stats</h2>
                  <p>Metrics are derived from the current admin dataset and active filters.</p>
                </div>
              </div>
              <section className="wr-admin-overview">
                {loading && !overview ? <div>Loading extraction diagnostics...</div> : null}
                <div className="wr-admin-cards">
                  {metricCards.map((card) => (
                    <div key={card.label} className={`wr-admin-card wr-admin-card-${card.tone}`}>
                      <div className="wr-admin-card-value">{card.value}</div>
                      <div className="wr-admin-card-label">{card.label}</div>
                      {card.hint ? <div className="wr-admin-card-hint">{card.hint}</div> : null}
                    </div>
                  ))}
                </div>
              </section>
            </section>

            <section className="wr-admin-panel">
              <div className="wr-admin-panel-head">
                <div>
                  <h2>Insights</h2>
                  <p>Quick signals pulled from the same overview and links data already on the dashboard.</p>
                </div>
              </div>
              <div className="wr-admin-insights">
                {insightCards.map((card) => (
                  <div key={card.title} className={`wr-admin-insight wr-admin-insight-${card.tone}`}>
                    <div className="wr-admin-insight-title">{card.title}</div>
                    <div className="wr-admin-insight-value">{card.value}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="wr-admin-panel wr-admin-links">
              <div className="wr-admin-panel-head">
                <div>
                  <h2>Links</h2>
                  <p>Inspect canonical URLs, latest routing decisions, and reuse behavior.</p>
                </div>
              </div>
              <div className="wr-admin-filters">
                <input placeholder="Search canonical URL" value={q} onChange={(e) => setQ(e.target.value)} />
                <input placeholder="Platform" value={platform} onChange={(e) => setPlatform(e.target.value)} />
                <input placeholder="Accepted after" value={acceptedAfter} onChange={(e) => setAcceptedAfter(e.target.value)} />
                <button onClick={() => runFilterFetch(1)}>Apply filters</button>
                <button className="wr-admin-button-secondary" onClick={() => clearFilters()}>Clear filters</button>
              </div>
              {loading ? <div>Loading links...</div> : null}
              {links.length ? (
                <>
                  <table className="wr-admin-table">
                    <thead>
                      <tr>
                        <th>Canonical URL</th>
                        <th>Platform</th>
                        <th>Run Count</th>
                        <th>Attempt Count</th>
                        <th>Latest Status</th>
                        <th>Accepted After</th>
                        <th>Route</th>
                        <th>Final Action</th>
                        <th>Cache Reuse</th>
                        <th>Last Seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {links.map((r) => (
                        <tr key={r.submittedLinkId} onClick={() => openDetail(r)} className="wr-admin-row">
                          <td className="wr-admin-url-cell" title={r.canonicalUrl}>{r.canonicalUrl}</td>
                          <td>{r.platform || "-"}</td>
                          <td>{formatInteger(r.runCount)}</td>
                          <td>{formatInteger(r.attemptCount)}</td>
                          <td>{renderBadge(r.latestStatus)}</td>
                          <td>{renderBadge(r.latestAcceptedAfter)}</td>
                          <td>{renderBadge(r.latestRoute)}</td>
                          <td>{renderBadge(r.finalUserAction)}</td>
                          <td className={r.cacheReuseCount > 0 ? "wr-admin-cache-positive" : ""}>{formatInteger(r.cacheReuseCount ?? 0)}</td>
                          <td>{formatDateTime(r.lastSeenAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="wr-admin-pager">
                    <button disabled={page <= 1} onClick={() => runFilterFetch(page - 1)}>Prev</button>
                    <span>Page {page} / {pages}</span>
                    <button disabled={page >= pages} onClick={() => runFilterFetch(page + 1)}>Next</button>
                  </div>
                </>
              ) : (
                <div className="wr-admin-table-empty">
                  <h3>No links match these filters</h3>
                  <p>Try clearing the current search, platform, or accepted-after filter.</p>
                </div>
              )}
            </section>
          </>
        ) : (
          <>
            {usageError ? <div className="wr-admin-error">{usageError}</div> : null}
            <section className="wr-admin-panel">
              <div className="wr-admin-panel-head">
                <div>
                  <h2>Customer summary</h2>
                  <p>Usage and save behavior based on the current customer activity dataset.</p>
                </div>
              </div>
              <section className="wr-admin-overview">
                {usageLoading && !usageOverview ? <div>Loading customer usage...</div> : null}
                <div className="wr-admin-cards">
                  {customerMetricCards.map((card) => (
                    <div key={card.label} className={`wr-admin-card wr-admin-card-${card.tone}`}>
                      <div className="wr-admin-card-value">{card.value}</div>
                      <div className="wr-admin-card-label">{card.label}</div>
                    </div>
                  ))}
                </div>
              </section>
            </section>

            <section className="wr-admin-panel">
              <div className="wr-admin-panel-head">
                <div>
                  <h2>Customer insights</h2>
                  <p>Simple user-experience signals from the existing admin usage APIs.</p>
                </div>
              </div>
              <div className="wr-admin-insights">
                {customerInsightCards.map((card) => (
                  <div key={card.title} className={`wr-admin-insight wr-admin-insight-${card.tone}`}>
                    <div className="wr-admin-insight-title">{card.title}</div>
                    <div className="wr-admin-insight-value">{card.value}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="wr-admin-panel">
              <div className="wr-admin-panel-head">
                <div>
                  <h2>Users</h2>
                  <p>Masked actors only. No raw user IDs, anonymous IDs, or emails are exposed.</p>
                </div>
              </div>
              <div className="wr-admin-filters">
                <select value={usageUserType} onChange={(e) => setUsageUserType(e.target.value)} className="wr-admin-select">
                  <option value="">All user types</option>
                  <option value="logged_in">Logged-in</option>
                  <option value="anonymous">Anonymous</option>
                </select>
                <select value={usageStatus} onChange={(e) => setUsageStatus(e.target.value)} className="wr-admin-select">
                  <option value="">All statuses</option>
                  <option value="new">New</option>
                  <option value="active">Active</option>
                  <option value="saved_place">Saved place</option>
                  <option value="repeat_user">Repeat user</option>
                  <option value="dropped_after_extraction">Dropped after extraction</option>
                </select>
                <input placeholder="Platform" value={usagePlatform} onChange={(e) => setUsagePlatform(e.target.value)} />
                <select value={String(usagePageSize)} onChange={(e) => setUsagePageSize(Number(e.target.value))} className="wr-admin-select">
                  <option value="10">10 / page</option>
                  <option value="20">20 / page</option>
                  <option value="50">50 / page</option>
                </select>
                <button onClick={() => runUsageFetch(1, { pageSize: usagePageSize })}>Apply filters</button>
                <button className="wr-admin-button-secondary" onClick={() => clearUsageFilters()}>Clear filters</button>
              </div>
              {usageLoading ? <div>Loading users...</div> : null}
              {usageUsers.length ? (
                <>
                  <table className="wr-admin-table">
                    <thead>
                      <tr>
                        <th>Masked Actor Key</th>
                        <th>User Type</th>
                        <th>First Seen</th>
                        <th>Last Seen</th>
                        <th>Runs</th>
                        <th>Unique Links</th>
                        <th>Saved Places</th>
                        <th>Edited</th>
                        <th>Reused</th>
                        <th>Save Rate</th>
                        <th>Status Badges</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageUsers.map((row) => (
                        <tr key={row.actorKey} className="wr-admin-row-static">
                          <td><strong>{row.actorKey}</strong></td>
                          <td>{renderBadge(row.userType)}</td>
                          <td>{formatDateTime(row.firstSeenAt)}</td>
                          <td>{formatDateTime(row.lastSeenAt)}</td>
                          <td>{formatInteger(row.runsCount)}</td>
                          <td>{formatInteger(row.uniqueLinksSubmitted)}</td>
                          <td>{formatInteger(row.savedPlacesCount)}</td>
                          <td>{formatInteger(row.editedCount)}</td>
                          <td className={row.reusedCount > 0 ? "wr-admin-cache-positive" : ""}>{formatInteger(row.reusedCount)}</td>
                          <td>{formatPercent(row.saveRate)}</td>
                          <td>
                            <div className="wr-admin-inline-badges">
                              {row.statusBadges.length ? row.statusBadges.map((badge) => (
                                <span key={`${row.actorKey}-${badge}`}>{renderBadge(badge)}</span>
                              )) : renderBadge("neutral")}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="wr-admin-pager">
                    <button disabled={usagePage <= 1} onClick={() => runUsageFetch(usagePage - 1)}>Prev</button>
                    <span>Page {usagePage} / {usagePages}</span>
                    <button disabled={usagePage >= usagePages} onClick={() => runUsageFetch(usagePage + 1)}>Next</button>
                  </div>
                </>
              ) : (
                <div className="wr-admin-table-empty">
                  <h3>No users match these filters</h3>
                  <p>Try clearing the current user type, status, or platform filter.</p>
                </div>
              )}
            </section>
          </>
        )}

        {selected ? (
          <div className="wr-admin-drawer">
            <div className="wr-admin-drawer-inner">
              <button className="wr-admin-drawer-close" onClick={() => setSelected(null)}>Close</button>
              {detailLoading ? <div>Loading...</div> : null}
              <div className="wr-admin-panel-head">
                <div>
                  <h2>Link detail</h2>
                  <p>Nested run, attempt, evidence, entity, event, and edit-diff history.</p>
                </div>
              </div>
              <section className="wr-admin-link-summary">
                <div className="wr-admin-section-heading">Submitted link</div>
                {selected.submittedLink ? (
                  <>
                    <div className="wr-admin-source-url" title={selected.submittedLink.canonicalUrl}>{selected.submittedLink.canonicalUrl}</div>
                    <div className="wr-admin-inline-badges">{renderBadge(selected.submittedLink.platform, "platform")}</div>
                    <div className="wr-admin-key-grid">
                      <div><span>First Seen</span><strong>{formatDateTime(selected.submittedLink.firstSeenAt)}</strong></div>
                      <div><span>Last Seen</span><strong>{formatDateTime(selected.submittedLink.lastSeenAt)}</strong></div>
                    </div>
                  </>
                ) : renderEmptyState("No submitted link")}
              </section>
              <section className="wr-admin-attempt-section">
                <div className="wr-admin-section-heading">Runs</div>
                {selected.runs?.length ? selected.runs.map((run) => <RunCard key={run.id} run={run} />) : renderEmptyState("No runs")}
              </section>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default AdminPage;
