import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  fetchAdminLinkDetail,
  fetchAdminLinks,
  fetchAdminOverview,
  type AdminLinkDetailAttempt,
  type AdminLinkDetailResponse,
  type AdminLinkDetailRun,
  type AdminLinkRow,
  type AdminOverviewResponse,
} from "./adminApi";
import "./admin.css";

type MetricCard = {
  label: string;
  value: string;
  tone?: "default" | "highlight";
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

function buildMetricCards(overview: AdminOverviewResponse): MetricCard[] {
  const cacheReuseCount = overview.estimates?.cacheReuseCount ?? 0;
  return [
    {
      label: "Submitted Links",
      value: formatInteger(overview.totals?.submittedLinks),
    },
    {
      label: "Runs",
      value: formatInteger(overview.totals?.runs),
    },
    {
      label: "Attempts",
      value: formatInteger(overview.totals?.attempts),
    },
    {
      label: "Save rate",
      value: formatPercent(overview.rates?.saveRate),
    },
    {
      label: "Edit rate",
      value: formatPercent(overview.rates?.editRate),
    },
    {
      label: "Discard rate",
      value: formatPercent(overview.rates?.discardRate),
    },
    {
      label: "Avg attempts",
      value: formatAverage(overview.averages?.attemptCount),
    },
    {
      label: "Cache reuse (est)",
      value: formatInteger(cacheReuseCount),
      tone: cacheReuseCount > 0 ? "highlight" : "default",
    },
    {
      label: "Duplicate saved-place (est)",
      value: formatInteger(overview.estimates?.duplicateSavedPlaceCount),
    },
  ];
}

function renderAttemptSection(title: string, items: ReactNode[]) {
  return (
    <div className="wr-admin-attempt-section">
      <div className="wr-admin-attempt-section-title">{title}</div>
      {items.length ? items : renderEmptyState(`No ${title.toLowerCase()} rows`)}
    </div>
  );
}

function AttemptCard({ attempt }: { attempt: AdminLinkDetailAttempt }) {
  return (
    <div className="wr-admin-attempt-card">
      <div className="wr-admin-attempt-header">
        <strong>Attempt #{attempt.attemptNumber ?? "-"}</strong>
        <span>{attempt.status || "unknown"}</span>
      </div>
      <div className="wr-admin-key-grid">
        <div><span>Trigger</span><strong>{attempt.triggerType || "-"}</strong></div>
        <div><span>Route</span><strong>{attempt.route || "-"}</strong></div>
        <div><span>Accepted After</span><strong>{attempt.acceptedAfter || "-"}</strong></div>
        <div><span>Intelligence</span><strong>{attempt.intelligenceStatus || "-"}</strong></div>
        <div><span>Total Latency</span><strong>{attempt.totalLatencyMs ?? "-"}</strong></div>
        <div><span>Validation Errors</span><strong>{attempt.validationErrorCount ?? 0}</strong></div>
      </div>
      {attempt.failureReason ? <div className="wr-admin-inline-note">Failure: {attempt.failureReason}</div> : null}
      {renderAttemptSection(
        "Stages",
        (attempt.stages || []).map((stage) => (
          <div key={stage.id} className="wr-admin-list-row">
            <strong>{stage.stage}</strong>
            <span>{stage.status || "-"}</span>
            <span>{stage.latencyMs ?? 0} ms</span>
            <span>{formatDateTime(stage.finishedAt || stage.createdAt)}</span>
          </div>
        )),
      )}
      {renderAttemptSection(
        "Evidence",
        (attempt.evidence || []).map((item) => (
          <div key={item.id} className="wr-admin-list-block">
            <div className="wr-admin-list-row">
              <strong>{item.evidenceType}</strong>
              <span>#{item.position ?? 0}</span>
              <span>{formatDateTime(item.createdAt)}</span>
            </div>
            <div className="wr-admin-muted-text">{item.summaryText || item.sourceRef || "-"}</div>
          </div>
        )),
      )}
      {renderAttemptSection(
        "Entities",
        (attempt.entities || []).map((entity) => (
          <div key={entity.id} className="wr-admin-list-block">
            <div className="wr-admin-list-row">
              <strong>{entity.title || `Entity #${entity.entityIndex ?? "-"}`}</strong>
              <span>{entity.entityType || "-"}</span>
              <span>{entity.confidence ?? "-"}</span>
            </div>
            <div className="wr-admin-muted-text">
              {joinValues([
                entity.subtitle,
                entity.wasSaved ? "saved" : null,
                entity.wasEdited ? "edited" : null,
                entity.wasDiscarded ? "discarded" : null,
              ])}
            </div>
          </div>
        )),
      )}
      {renderAttemptSection(
        "Edit diffs",
        (attempt.edits || [])
          .filter((edit) => edit.attemptNumber === attempt.attemptNumber)
          .map((edit) => (
            <div key={edit.id} className="wr-admin-list-row">
              <strong>{edit.fieldName}</strong>
              <span>Entity #{edit.entityIndex ?? "-"}</span>
              <span>{edit.editedByUserId || "Unknown user"}</span>
              <span>{formatDateTime(edit.createdAt)}</span>
            </div>
          )),
      )}
    </div>
  );
}

function RunCard({ run }: { run: AdminLinkDetailRun }) {
  return (
    <div className="wr-admin-run">
      <div className="wr-admin-run-header">
        <div>
          <strong>Run {run.id}</strong>
          <div className="wr-admin-muted-text">{run.clientRunId || "No client run id"}</div>
        </div>
        <div className="wr-admin-run-meta">
          <span>{run.latestOutcome || "No final action"}</span>
          <span>{formatDateTime(run.createdAt)}</span>
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
      <div className="wr-admin-attempts">
        {run.attempts?.length ? run.attempts.map((attempt) => <AttemptCard key={attempt.id} attempt={attempt} />) : renderEmptyState("No attempts")}
      </div>
      <div className="wr-admin-attempt-section">
        <div className="wr-admin-attempt-section-title">Events</div>
        {run.events?.length ? (
          run.events.map((event) => (
            <div key={event.id} className="wr-admin-list-row">
              <strong>{event.eventName}</strong>
              <span>Attempt #{event.attemptNumber ?? "-"}</span>
              <span>{formatDateTime(event.createdAt)}</span>
            </div>
          ))
        ) : (
          renderEmptyState("No events")
        )}
      </div>
    </div>
  );
}

export function AdminPage() {
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [links, setLinks] = useState<AdminLinkRow[]>([]);
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

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([fetchAdminOverview(), fetchAdminLinks({ page, pageSize })])
      .then(([ov, linksRes]) => {
        if (!mounted) return;
        if (!ov.ok && (ov.status === 401 || ov.status === 403)) {
          setError("Admin access required");
          setLoading(false);
          return;
        }
        setOverview(ov);
        setLinks(linksRes.rows || []);
        setTotal(Number(linksRes.pagination?.total || 0));
        setLoading(false);
      })
      .catch((e) => {
        if (!mounted) return;
        setError(String(e));
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function runFilterFetch(nextPage = 1) {
    setLoading(true);
    setError(null);
    const res = await fetchAdminLinks({
      page: nextPage,
      pageSize,
      platform: platform || undefined,
      acceptedAfter: acceptedAfter || undefined,
      q: q || undefined,
    });
    if (!res.ok && (res.status === 401 || res.status === 403)) {
      setError("Admin access required");
      setLoading(false);
      return;
    }
    setLinks(res.rows || []);
    setTotal(Number(res.pagination?.total || 0));
    setPage(nextPage);
    setLoading(false);
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
  const metricCards = overview ? buildMetricCards(overview) : [];

  return (
    <div className="wr-admin-root">
      <h2>Admin Dashboard</h2>
      {error ? <div className="wr-admin-error">{error}</div> : null}
      <section className="wr-admin-overview">
        {loading && !overview ? <div>Loading overview...</div> : null}
        {overview ? (
          <div className="wr-admin-cards">
            {metricCards.map((card) => (
              <div key={card.label} className={`card${card.tone === "highlight" ? " card-highlight" : ""}`}>
                <div className="value">{card.value}</div>
                <div className="label">{card.label}</div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="wr-admin-links">
        <h3>Links</h3>
        <div className="wr-admin-filters">
          <input placeholder="Search URL" value={q} onChange={(e) => setQ(e.target.value)} />
          <input placeholder="Platform" value={platform} onChange={(e) => setPlatform(e.target.value)} />
          <input placeholder="Accepted After" value={acceptedAfter} onChange={(e) => setAcceptedAfter(e.target.value)} />
          <button onClick={() => runFilterFetch(1)}>Filter</button>
        </div>

        {loading ? <div>Loading links...</div> : null}
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
                <td>{r.latestStatus || "-"}</td>
                <td>{r.latestAcceptedAfter || "-"}</td>
                <td>{r.latestRoute || "-"}</td>
                <td>{r.finalUserAction || "-"}</td>
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
      </section>

      {selected ? (
        <div className="wr-admin-drawer">
          <div className="wr-admin-drawer-inner">
            <button className="wr-admin-drawer-close" onClick={() => setSelected(null)}>Close</button>
            {detailLoading ? <div>Loading...</div> : null}
            <h4>Submitted Link</h4>
            {selected.submittedLink ? (
              <div className="wr-admin-link-summary">
                <div className="wr-admin-source-url" title={selected.submittedLink.canonicalUrl}>{selected.submittedLink.canonicalUrl}</div>
                <div className="wr-admin-key-grid">
                  <div><span>Platform</span><strong>{selected.submittedLink.platform || "-"}</strong></div>
                  <div><span>First Seen</span><strong>{formatDateTime(selected.submittedLink.firstSeenAt)}</strong></div>
                  <div><span>Last Seen</span><strong>{formatDateTime(selected.submittedLink.lastSeenAt)}</strong></div>
                </div>
              </div>
            ) : (
              renderEmptyState("No submitted link")
            )}
            <h4>Runs</h4>
            {selected.runs?.length ? selected.runs.map((run) => <RunCard key={run.id} run={run} />) : renderEmptyState("No runs")}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AdminPage;
