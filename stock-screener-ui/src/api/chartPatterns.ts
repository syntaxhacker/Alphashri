/**
 * Chart Patterns API client.
 *
 * Typed wrappers over the real `/api/chart-patterns` endpoints (CONTRACT §5).
 * Pure transport: functions throw on failure and never touch app state — the
 * store owns state, error surfacing and polling.
 */

import type {
  TFSpec,
  Universe,
  PatternDef,
  PatternFamily,
  JobDTO,
  JobStatus,
  PatternHitDTO,
  PatternSummary,
  SymbolDetail,
  ChartPayload,
  PatternsQuery,
} from "../types/chartPatterns";
import { fetchWithAuth } from "../state/auth";
import { API_BASE } from "./config";

const CHART_PATTERNS_BASE = `${API_BASE}/api/chart-patterns`;

/** Thrown by `startScan` when the bounded compute queue is full (HTTP 429). */
export class QueueFullError extends Error {
  readonly queueSize: number | null;
  readonly maxQueue: number | null;

  constructor(detail: string, queueSize: number | null = null, maxQueue: number | null = null) {
    super(detail);
    this.name = "QueueFullError";
    this.queueSize = queueSize;
    this.maxQueue = maxQueue;
  }
}

export interface UniversesResponse {
  universes: Universe[];
  default: string;
}

export interface PatternCatalogResponse {
  families: PatternFamily[];
  patterns: PatternDef[];
}

export interface ScanRequest {
  universe: string;
  timeframe: string;
  force?: boolean;
}

export interface ScanResponse {
  job_id: string;
  status: JobStatus;
  queue_position: number | null;
  queue_size: number;
}

export interface ResultsResponse {
  items: PatternHitDTO[];
  total: number;
  summary: PatternSummary;
  data_through: string | null;
}

export interface JobsResponse {
  jobs: JobDTO[];
}

interface ErrorBody {
  detail?: unknown;
  error?: unknown;
  queue_size?: number;
  max_queue?: number;
}

async function readError(
  response: Response,
  fallback: string,
): Promise<{ detail: string; body: ErrorBody | null }> {
  try {
    const body = (await response.json()) as ErrorBody;
    const raw = body?.detail ?? body?.error;
    let detail = fallback;
    if (typeof raw === "string" && raw) {
      detail = raw;
    } else if (raw != null) {
      detail = JSON.stringify(raw);
    }
    return { detail, body };
  } catch {
    return { detail: fallback, body: null };
  }
}

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const response = await fetchWithAuth(url);
  if (!response.ok) {
    const { detail } = await readError(response, fallback);
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

/** Serialize a `PatternsQuery` into a query string (repeated keys for arrays). */
export function buildPatternsQuery(query: PatternsQuery = {}): string {
  const params = new URLSearchParams();

  if (query.job_id) params.set("job_id", query.job_id);
  if (query.universe) params.set("universe", query.universe);
  if (query.timeframe) params.set("timeframe", query.timeframe);
  for (const family of query.family ?? []) params.append("family", family);
  for (const patternId of query.pattern_id ?? []) params.append("pattern_id", patternId);
  for (const direction of query.direction ?? []) params.append("direction", direction);
  for (const status of query.status ?? []) params.append("status", status);
  if (query.quality) params.set("quality", query.quality);
  if (query.formed_within_bars != null) {
    params.set("formed_within_bars", String(query.formed_within_bars));
  }
  if (query.volume_confirmed != null) {
    params.set("volume_confirmed", String(query.volume_confirmed));
  }
  if (query.min_rr != null) params.set("min_rr", String(query.min_rr));
  if (query.min_base_days != null) {
    params.set("min_base_days", String(query.min_base_days));
  }
  if (query.max_range_pct != null) {
    params.set("max_range_pct", String(query.max_range_pct));
  }
  if (query.symbol) params.set("symbol", query.symbol);
  if (query.sort && query.sort !== "confidence") params.set("sort", query.sort);
  if (query.limit != null) params.set("limit", String(query.limit));
  if (query.offset != null) params.set("offset", String(query.offset));

  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchTimeframes(): Promise<TFSpec[]> {
  const data = await getJson<{ timeframes: TFSpec[] }>(
    `${CHART_PATTERNS_BASE}/timeframes`,
    "Failed to fetch timeframes",
  );
  return data.timeframes ?? [];
}

export async function fetchUniverses(): Promise<UniversesResponse> {
  const data = await getJson<UniversesResponse>(
    `${CHART_PATTERNS_BASE}/universes`,
    "Failed to fetch universes",
  );
  return { universes: data.universes ?? [], default: data.default ?? "" };
}

export async function fetchPatternCatalog(): Promise<PatternCatalogResponse> {
  const data = await getJson<PatternCatalogResponse>(
    `${CHART_PATTERNS_BASE}/patterns`,
    "Failed to fetch pattern catalog",
  );
  return { families: data.families ?? [], patterns: data.patterns ?? [] };
}

export async function startScan(req: ScanRequest): Promise<ScanResponse> {
  const response = await fetchWithAuth(`${CHART_PATTERNS_BASE}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });

  if (response.status === 429) {
    const { detail, body } = await readError(response, "Pattern scan queue is full");
    throw new QueueFullError(detail, body?.queue_size ?? null, body?.max_queue ?? null);
  }
  if (!response.ok) {
    const { detail } = await readError(response, `Failed to start scan (${response.status})`);
    throw new Error(detail);
  }

  return (await response.json()) as ScanResponse;
}

export async function fetchJob(id: string): Promise<JobDTO> {
  return getJson<JobDTO>(
    `${CHART_PATTERNS_BASE}/jobs/${encodeURIComponent(id)}`,
    "Failed to fetch scan job",
  );
}

export async function fetchActiveJobs(): Promise<JobDTO[]> {
  const data = await getJson<JobsResponse>(
    `${CHART_PATTERNS_BASE}/jobs?active=1`,
    "Failed to fetch active scan jobs",
  );
  return data.jobs ?? [];
}

export async function fetchResults(query: PatternsQuery = {}): Promise<ResultsResponse> {
  const data = await getJson<ResultsResponse>(
    `${CHART_PATTERNS_BASE}/results${buildPatternsQuery(query)}`,
    "Failed to fetch pattern results",
  );
  return {
    items: data.items ?? [],
    total: data.total ?? 0,
    summary: data.summary,
    data_through: data.data_through ?? null,
  };
}

export async function fetchSummary(query: PatternsQuery = {}): Promise<PatternSummary> {
  return getJson<PatternSummary>(
    `${CHART_PATTERNS_BASE}/summary${buildPatternsQuery(query)}`,
    "Failed to fetch pattern summary",
  );
}

export async function fetchSymbolDetail(symbol: string, timeframe: string): Promise<SymbolDetail> {
  const params = new URLSearchParams({ timeframe });
  return getJson<SymbolDetail>(
    `${CHART_PATTERNS_BASE}/symbol/${encodeURIComponent(symbol)}?${params.toString()}`,
    `Failed to load ${symbol}`,
  );
}

export async function fetchSymbolChart(
  symbol: string,
  timeframe: string,
  limit?: number,
): Promise<ChartPayload> {
  const params = new URLSearchParams({ timeframe });
  if (limit != null) params.set("limit", String(limit));
  return getJson<ChartPayload>(
    `${CHART_PATTERNS_BASE}/symbol/${encodeURIComponent(symbol)}/chart?${params.toString()}`,
    `Failed to load ${symbol} chart`,
  );
}
