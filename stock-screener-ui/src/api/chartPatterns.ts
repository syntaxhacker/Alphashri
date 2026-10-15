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
  MarketStatus,
  PatternHitDTO,
  PatternSummary,
  ScanProvenance,
  SymbolDetail,
  ChartPayload,
  PatternsQuery,
  WatchPayload,
  WatchRow,
  WatchSetup,
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
  /** Clear cached candles for the scope + timeframe, then run a forced fresh scan. */
  refresh?: boolean;
  /** Explicit symbol scope: scan only these (stored under the `custom` universe). */
  symbols?: string[];
  /** Lookback window in bars (omitted/null = server default). */
  lookback_bars?: number | null;
  /** Skip server-side trendline computation (false = skip; omitted = compute). */
  compute_trendlines?: boolean;
  /** Minimum relative volume pre-filter (scan-time only; omitted/null = any). */
  min_rel_volume?: number | null;
  /** Minimum watched volume in millions (scan-time only; omitted/null = any). */
  min_volume_m?: number | null;
  /** Minimum 10-day average volume in thousands (K); scan-time only. */
  min_avg_volume_10d?: number | null;
  /** Replay cutoff: detect patterns as of this timestamp (omitted/null = live). */
  as_of_date?: string | null;
  /** Replay window start: only consider formations at/after this (omitted/null = any). */
  from_date?: string | null;
}

export interface ScanResponse {
  job_id: string;
  status: JobStatus;
  queue_position: number | null;
  queue_size: number;
  /**
   * Reuse markers echoed when a non-forced scan reused a previous scan
   * without re-detecting ( mirrors `JobDTO.reused*`; absent = fresh scan).
   */
  reused?: boolean;
  reused_from?: string | null;
  reused_age_sec?: number | null;
  reused_finished_at?: string | null;
  /**
   * Per-layer cache provenance echoed when the backend supplies it
   * (mirrors `JobDTO.provenance`; absent = older backend).
   */
  provenance?: ScanProvenance | null;
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
  if (query.lookback_bars != null) params.set("lookback_bars", String(query.lookback_bars));
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
  if (query.max_52w_gap != null) {
    params.set("max_52w_gap", String(query.max_52w_gap));
  }
  if (query.min_range_pos != null) {
    params.set("min_range_pos", String(query.min_range_pos));
  }
  if (query.symbol) params.set("symbol", query.symbol);
  for (const symbol of query.symbols ?? []) params.append("symbol", symbol);
  if (query.q) params.set("q", query.q);
  if (query.from_date) params.set("from_date", query.from_date);
  if (query.to_date) params.set("to_date", query.to_date);
  if (query.sort && query.sort !== "confidence") params.set("sort", query.sort);
  // Opt-out flag: only serialized when false (compute is the default).
  if (query.compute_trendlines === false) params.set("compute_trendlines", "0");
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

export interface SymbolChartOptions {
  limit?: number;
  lookbackBars?: number | null;
  /** Skip server-side trendline computation (false = skip; omitted = compute). */
  computeTrendlines?: boolean;
  /** Run live pattern detection on this timeframe (`detect_patterns=1`). */
  detectPatterns?: boolean;
  /** Replay cutoff: truncate candles at this timestamp (`as_of_date`). */
  asOf?: string;
  /** Replay window start: filter hits to this window (`from_date`). */
  fromDate?: string;
}

export async function fetchSymbolChart(
  symbol: string,
  timeframe: string,
  opts?: number | SymbolChartOptions,
): Promise<ChartPayload> {
  const params = new URLSearchParams({ timeframe });
  const limit = typeof opts === "number" ? opts : opts?.limit;
  const lookbackBars = typeof opts === "number" ? undefined : opts?.lookbackBars;
  const computeTrendlines = typeof opts === "number" ? undefined : opts?.computeTrendlines;
  const detectPatterns = typeof opts === "number" ? undefined : opts?.detectPatterns;
  const asOf = typeof opts === "number" ? undefined : opts?.asOf;
  const fromDate = typeof opts === "number" ? undefined : opts?.fromDate;
  if (limit != null) params.set("limit", String(limit));
  if (lookbackBars != null) params.set("lookback_bars", String(lookbackBars));
  if (computeTrendlines === false) params.set("compute_trendlines", "0");
  if (detectPatterns) params.set("detect_patterns", "1");
  if (asOf) params.set("as_of_date", asOf);
  if (fromDate) params.set("from_date", fromDate);
  return getJson<ChartPayload>(
    `${CHART_PATTERNS_BASE}/symbol/${encodeURIComponent(symbol)}/chart?${params.toString()}`,
    `Failed to load ${symbol} chart`,
  );
}

export interface WatchQuery {
  setup: string;
  universe: string;
  timeframe: string;
  minBaseDays?: number | null;
  minRelVolume?: number | null;
}

/** `meta` event payload for `GET /results/stream` (same fields as `/results`). */
export interface ResultsStreamMeta {
  total: number;
  summary: PatternSummary;
  data_through: string | null;
}

/** `meta` event payload for `GET /watch/stream`. */
export interface WatchStreamMeta {
  setup: string;
  min_rel_volume: number;
  updated_at?: string | null;
}

export interface StreamHandlers<TMeta, TItem> {
  onMeta?: (meta: TMeta) => void;
  onItem?: (item: TItem) => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
  signal?: AbortSignal;
}

type SseHandler = (event: string, data: string) => void;

/**
 * Shared SSE reader (mirrors `src/hooks/useLivePrices.ts`): buffers
 * `ReadableStream` chunks, splits frames on `\n\n`, parses `event:`/`data:`
 * lines and dispatches each event. Never throws — transport/parse failures
 * are reported via `onStreamError` (abort is silent).
 */
async function readSseStream(
  response: Response,
  onEvent: SseHandler,
  onStreamError: (error: Error) => void,
  signal?: AbortSignal,
): Promise<void> {
  const body = response.body;
  if (!body) {
    onStreamError(new Error("Empty stream response"));
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const onAbort = (): void => {
    try {
      void reader.cancel();
    } catch {
      /* non-fatal */
    }
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (!part.trim()) continue;
        let eventType = "";
        const dataLines: string[] = [];
        for (const line of part.split("\n")) {
          if (line.startsWith("event:")) eventType = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
          else if (line.startsWith(":")) continue;
        }
        if (!eventType) continue;
        onEvent(eventType, dataLines.join("\n"));
      }
    }
    if (buffer.trim()) {
      let eventType = "";
      const dataLines: string[] = [];
      for (const line of buffer.split("\n")) {
        if (line.startsWith("event:")) eventType = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (eventType) onEvent(eventType, dataLines.join("\n"));
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError" || signal?.aborted) return;
    onStreamError(err instanceof Error ? err : new Error("Stream read failed"));
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* non-fatal */
    }
  }
}

function dispatchSse<TMeta, TItem>(
  event: string,
  data: string,
  handlers: StreamHandlers<TMeta, TItem>,
): void {
  try {
    if (event === "meta" && handlers.onMeta) {
      handlers.onMeta((data ? JSON.parse(data) : {}) as TMeta);
    } else if (event === "item" && handlers.onItem) {
      handlers.onItem(JSON.parse(data) as TItem);
    } else if (event === "done") {
      handlers.onDone?.();
    } else if (event === "error") {
      let message = "Stream failed";
      if (data) {
        try {
          const parsed = JSON.parse(data) as { message?: unknown; detail?: unknown };
          const raw = parsed.message ?? parsed.detail;
          if (typeof raw === "string" && raw) message = raw;
        } catch {
          message = data;
        }
      }
      handlers.onError?.(new Error(message));
    }
  } catch (err) {
    handlers.onError?.(err instanceof Error ? err : new Error("Malformed stream event"));
  }
}

/**
 * Stream enriched pattern results (`GET /results/stream`): `meta` carries the
 * total/summary up front, then one `item` per result, then `done`. Uses
 * `fetchWithAuth` (NOT `EventSource`) so the `Authorization` header is sent.
 * Never throws — failures go to `onError`.
 */
export async function streamResults(
  query: PatternsQuery = {},
  handlers: StreamHandlers<ResultsStreamMeta, PatternHitDTO> = {},
): Promise<void> {
  const { signal, onError, ...rest } = handlers;
  let response: Response;
  try {
    response = await fetchWithAuth(`${CHART_PATTERNS_BASE}/results/stream${buildPatternsQuery(query)}`, {
      headers: { Accept: "text/event-stream" },
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError" || signal?.aborted) return;
    onError?.(err instanceof Error ? err : new Error("Stream request failed"));
    return;
  }
  if (signal?.aborted) return;
  if (!response.ok) {
    const { detail } = await readError(response, "Failed to stream pattern results");
    onError?.(new Error(detail));
    return;
  }
  let finished = false;
  const wrapped: StreamHandlers<ResultsStreamMeta, PatternHitDTO> = {
    ...rest,
    onDone: () => {
      finished = true;
      rest.onDone?.();
    },
    onError: (err) => {
      finished = true;
      onError?.(err);
    },
  };
  await readSseStream(
    response,
    (event, data) => dispatchSse(event, data, wrapped),
    (err) => {
      if (!finished) onError?.(err);
    },
    signal,
  );
}

/**
 * Stream breakout-watch rows (`GET /watch/stream`): `meta` carries the setup
 * echo + gate up front, then one `item` per row, then `done`. Same transport
 * contract as `streamResults` (auth header via `fetchWithAuth`, never throws).
 */
export async function streamWatch(
  query: WatchQuery,
  handlers: StreamHandlers<WatchStreamMeta, WatchRow> = {},
): Promise<void> {
  const { signal, onError, ...rest } = handlers;
  let response: Response;
  try {
    response = await fetchWithAuth(`${CHART_PATTERNS_BASE}/watch/stream${buildWatchQuery(query)}`, {
      headers: { Accept: "text/event-stream" },
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError" || signal?.aborted) return;
    onError?.(err instanceof Error ? err : new Error("Stream request failed"));
    return;
  }
  if (signal?.aborted) return;
  if (!response.ok) {
    const { detail } = await readError(response, "Failed to stream breakout watch");
    onError?.(new Error(detail));
    return;
  }
  let finished = false;
  const wrapped: StreamHandlers<WatchStreamMeta, WatchRow> = {
    ...rest,
    onDone: () => {
      finished = true;
      rest.onDone?.();
    },
    onError: (err) => {
      finished = true;
      onError?.(err);
    },
  };
  await readSseStream(
    response,
    (event, data) => dispatchSse(event, data, wrapped),
    (err) => {
      if (!finished) onError?.(err);
    },
    signal,
  );
}

/** Serialize a `WatchQuery` into a query string for `GET /watch`. */
export function buildWatchQuery(query: WatchQuery): string {
  const params = new URLSearchParams();
  if (query.setup) params.set("setup", query.setup);
  if (query.universe) params.set("universe", query.universe);
  if (query.timeframe) params.set("timeframe", query.timeframe);
  if (query.minBaseDays != null) params.set("min_base_days", String(query.minBaseDays));
  if (query.minRelVolume != null) params.set("min_rel_volume", String(query.minRelVolume));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchWatchSetups(): Promise<WatchSetup[]> {
  const data = await getJson<{ setups: WatchSetup[] }>(
    `${CHART_PATTERNS_BASE}/watch/setups`,
    "Failed to fetch watch setups",
  );
  return data.setups ?? [];
}

export async function fetchWatch(query: WatchQuery): Promise<WatchPayload> {
  const data = await getJson<WatchPayload>(
    `${CHART_PATTERNS_BASE}/watch${buildWatchQuery(query)}`,
    "Failed to fetch breakout watch",
  );
  return { ...data, items: data.items ?? [] };
}

/** Holiday-aware market open state (`GET /api/chart-patterns/market-status`). */
export async function fetchMarketStatus(): Promise<MarketStatus> {
  const data = await getJson<MarketStatus>(
    `${CHART_PATTERNS_BASE}/market-status`,
    "Failed to fetch market status",
  );
  return {
    open: data.open ?? false,
    holiday: data.holiday ?? false,
    now_ist: data.now_ist ?? "",
    reason: data.reason ?? "",
  };
}
