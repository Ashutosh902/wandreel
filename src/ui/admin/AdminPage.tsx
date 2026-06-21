import { useEffect, useMemo, useState } from "react";
import { fetchAdminOverview, fetchAdminLinks, fetchAdminLinkDetail } from "./adminApi";
import "./admin.css";

export function AdminPage() {
  const [overview, setOverview] = useState<any | null>(null);
  const [links, setLinks] = useState<any[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [platform, setPlatform] = useState<string | "">("");
  const [acceptedAfter, setAcceptedAfter] = useState<string | "">("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
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
    const res = await fetchAdminLinks({ page: nextPage, pageSize, platform: platform || undefined, acceptedAfter: acceptedAfter || undefined, q: q || undefined });
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

  async function openDetail(row: any) {
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

  return (
    <div className="wr-admin-root">
      <h2>Admin Dashboard</h2>
      {error ? <div className="wr-admin-error">{error}</div> : null}
      <section className="wr-admin-overview">
        {loading && !overview ? <div>Loading overview...</div> : null}
        {overview ? (
          <div className="wr-admin-cards">
            <div className="card"><div className="label">Submitted Links</div><div className="value">{overview.totalSubmittedLinks}</div></div>
            <div className="card"><div className="label">Runs</div><div className="value">{overview.totalRuns}</div></div>
            <div className="card"><div className="label">Attempts</div><div className="value">{overview.totalAttempts}</div></div>
            <div className="card"><div className="label">Save rate</div><div className="value">{overview.saveRate}</div></div>
            <div className="card"><div className="label">Edit rate</div><div className="value">{overview.editRate}</div></div>
            <div className="card"><div className="label">Discard rate</div><div className="value">{overview.discardRate}</div></div>
            <div className="card"><div className="label">Avg attempts</div><div className="value">{overview.averageAttemptCount}</div></div>
            <div className="card"><div className="label">Cache reuse (est)</div><div className="value">{overview.estimatedCacheReuseCount}</div></div>
            <div className="card"><div className="label">Duplicate saved-place (est)</div><div className="value">{overview.estimatedDuplicateSavedPlaceCount}</div></div>
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
                <td>{r.canonicalUrl}</td>
                <td>{r.platform || "-"}</td>
                <td>{r.runCount}</td>
                <td>{r.attemptCount}</td>
                <td>{r.latestStatus || "-"}</td>
                <td>{r.latestAcceptedAfter || "-"}</td>
                <td>{r.latestRoute || "-"}</td>
                <td>{r.finalUserAction || "-"}</td>
                <td>{r.cacheReuseCount ?? 0}</td>
                <td>{r.lastSeenAt || r.last_seen_at || "-"}</td>
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
            <pre className="wr-admin-pre">{JSON.stringify(selected.submittedLink, null, 2)}</pre>
            <h4>Runs</h4>
            {selected.runs?.map((run: any) => (
              <div key={run.id} className="wr-admin-run">
                <div><strong>Run:</strong> {run.id} ({run.clientRunId})</div>
                <div><strong>Attempts:</strong></div>
                {run.attempts?.map((a: any) => (
                  <div key={a.id} className="wr-admin-attempt">
                    <div>Attempt #{a.attemptNumber} — status: {a.status}</div>
                    <div>Stages: {a.stages?.map((s: any) => s.stage).join(", ")}</div>
                    <div>Entities: {a.entities?.map((e: any) => e.title).join(", ")}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AdminPage;
