const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

export async function fetchAdminOverview(): Promise<{ ok: boolean; [k: string]: any }> {
  const res = await fetch(`${API_BASE}/api/admin/observability/overview`, { credentials: "include" });
  const body = await safeJson(res);
  return { ok: res.ok, status: res.status, ...body };
}

export async function fetchAdminLinks(params: Record<string, string | number | undefined> = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== "") query.set(k, String(v));
  });
  const res = await fetch(`${API_BASE}/api/admin/observability/links?${query.toString()}`, { credentials: "include" });
  const body = await safeJson(res);
  return { ok: res.ok, status: res.status, ...body };
}

export async function fetchAdminLinkDetail(submittedLinkId: string) {
  const res = await fetch(`${API_BASE}/api/admin/observability/links/${encodeURIComponent(submittedLinkId)}?includeRaw=false`, {
    credentials: "include",
  });
  const body = await safeJson(res);
  return { ok: res.ok, status: res.status, ...body };
}

export default {};
