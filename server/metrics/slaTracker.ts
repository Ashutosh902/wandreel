type SampleRecord = {
  value: number;
  at: number;
};

const WINDOW_SIZE = 200;
const buckets = new Map<string, SampleRecord[]>();

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function recordSla(metric: string, valueMs: number): { p50: number; p95: number; sampleSize: number } {
  const rows = buckets.get(metric) ?? [];
  rows.push({ value: valueMs, at: Date.now() });
  if (rows.length > WINDOW_SIZE) rows.splice(0, rows.length - WINDOW_SIZE);
  buckets.set(metric, rows);

  const values = rows.map((r) => r.value);
  return {
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    sampleSize: values.length,
  };
}

