import * as palette from "@/ui/palette";
/**
 * Shared test helpers for src/api tests — response/stream builders,
 * fixtures, and mock helpers. Test-only; not imported by production code.
 */
import { describe, it, expect, vi } from "vitest";
import type { ChartPreviewData } from "./chartPreview";
import type { PaperTrade } from "../types/paperTrading";

/* ---------- Response builders ---------- */

export function okResponse(body: unknown, status = 200): Response {
  return {
    ok: true,
    status,
    json: async () => body,
  } as unknown as Response;
}

export function errorResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => body,
  } as unknown as Response;
}

export function nonJsonErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => {
      throw new Error("bad json");
    },
  } as unknown as Response;
}

/* ---------- SSE helpers ---------- */

export function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream } as unknown as Response;
}

export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
}

export function sseDataResponse(events: unknown[], options: { delayRead?: boolean } = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      for (const event of events) {
        const chunk = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(chunk));
        if (options.delayRead) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      controller.close();
    },
  });
  return {
    ok: true,
    body,
    json: async () => ({ result: "ok" }),
  } as unknown as Response;
}

export function waitAsync(ms = 100): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------- Mock helpers ---------- */

/**
 * Structural subset of a vitest mock. Declared with method syntax on purpose:
 * method parameters are bivariant, so a `MockedFunction<(url: string) => …>`
 * satisfies this without weakening the signature to `any`.
 */
export type MockFn = {
  mockResolvedValue(value: unknown): unknown;
  mockResolvedValueOnce(value: unknown): unknown;
  mockRejectedValue(error: unknown): unknown;
};

export function mockOk(mock: MockFn, value: unknown): void {
  mock.mockResolvedValue(value);
}

export function mockOkOnce(mock: MockFn, value: unknown): void {
  mock.mockResolvedValueOnce(value);
}

export function mockError(mock: MockFn, message = "Network error"): void {
  mock.mockRejectedValue(new Error(message));
}

export function mockFetchOk(mock: MockFn, body: unknown): void {
  mock.mockResolvedValue(okResponse(body));
}

export function mockFetchOkOnce(mock: MockFn, body: unknown): void {
  mock.mockResolvedValueOnce(okResponse(body));
}

export function mockFetchError(mock: MockFn, status: number, body: unknown): void {
  mock.mockResolvedValue(errorResponse(status, body));
}

export function mockFetchNonJsonError(mock: MockFn, status: number): void {
  mock.mockResolvedValue(nonJsonErrorResponse(status));
}

export function mockSseChunks(mock: MockFn, chunks: string[]): void {
  mock.mockResolvedValue(sseResponse(chunks));
}

export function mockGlobalFetchOk(body: unknown): void {
  (global.fetch as unknown as MockFn).mockResolvedValue(okResponse(body));
}

export function mockGlobalFetchResponse(value: unknown): void {
  (global.fetch as unknown as MockFn).mockResolvedValue(value);
}

export function mockGlobalFetchRejected(message = "Network error"): void {
  (global.fetch as unknown as MockFn).mockRejectedValue(new Error(message));
}

/* ---------- fetchWithAuth module mock (chartPatterns tests) ---------- */

export function fetchWithAuthModuleMock() {
  return {
    fetchWithAuth: vi.fn(),
  };
}

/* ---------- normalizeBotPortfolio shared suite ---------- */

export function makeFullPortfolio(): Record<string, unknown> {
  return {
    initial_capital: 100000,
    cash: 50000,
    margin_used: 30000,
    position_value: 70000,
    unrealized_pnl: 2000,
    realized_pnl: 5000,
    total_value: 120000,
    total_pnl: 7000,
    total_pnl_pct: 7.0,
    total_positions: 5,
    trades: 20,
    daily_pnl_pct: 2.0,
    daily_trades: 3,
    open_positions: 5,
  };
}

export function makePortfolioPositions(): Array<{ symbol: string }> {
  return [{ symbol: "TATASTEEL" }, { symbol: "INFY" }];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NormalizeFn = (portfolio: any, positions: any[], realizedToday: number) => any;

export function describeNormalizeBotPortfolio(normalizeBotPortfolio: NormalizeFn): void {
  describe("normalizeBotPortfolio", () => {
    it("normalizes a full portfolio object", () => {
      const portfolio = makeFullPortfolio();
      const positions = makePortfolioPositions();

      const result = normalizeBotPortfolio(portfolio, positions, 1000);

      expect(result.initial_capital).toBe(100000);
      expect(result.cash).toBe(50000);
      expect(result.margin_used).toBe(30000);
      expect(result.position_value).toBe(70000);
      expect(result.unrealized_pnl).toBe(2000);
      expect(result.realized_pnl).toBe(5000);
      expect(result.total_value).toBe(120000);
      expect(result.total_pnl).toBe(7000);
      expect(result.total_pnl_pct).toBe(7.0);
      expect(result.positions).toBe(5);
      expect(result.trades).toBe(20);
      expect(result.daily_pnl).toBe(3000);
      expect(result.daily_pnl_pct).toBe(2.0);
      expect(result.daily_trades).toBe(3);
      expect(result.open_positions).toBe(5);
      expect(result.max_daily_loss_pct).toBe(0);
      expect(result.daily_loss_limit_exceeded).toBe(false);
    });

    it("handles null portfolio with defaults", () => {
      const result = normalizeBotPortfolio(null, [], 0);

      expect(result.initial_capital).toBe(0);
      expect(result.cash).toBe(0);
      expect(result.margin_used).toBe(0);
      expect(result.position_value).toBe(0);
      expect(result.unrealized_pnl).toBe(0);
      expect(result.realized_pnl).toBe(0);
      expect(result.total_value).toBe(0);
      expect(result.total_pnl).toBe(0);
      expect(result.total_pnl_pct).toBe(0);
      expect(result.positions).toBe(0);
      expect(result.trades).toBe(0);
      expect(result.daily_pnl).toBe(0);
      expect(result.daily_pnl_pct).toBe(0);
      expect(result.daily_trades).toBe(0);
      expect(result.open_positions).toBe(0);
    });

    it("uses positions.length as fallback for total_positions", () => {
      const portfolio = { initial_capital: 100000 };
      const positions = makePortfolioPositions();

      const result = normalizeBotPortfolio(portfolio, positions, 0);

      expect(result.positions).toBe(2);
    });

    it("uses capital_used as fallback for margin_used", () => {
      const portfolio = { capital_used: 25000 };

      const result = normalizeBotPortfolio(portfolio, [], 0);

      expect(result.margin_used).toBe(25000);
    });

    it("uses total_trades as fallback for trades", () => {
      const portfolio = { total_trades: 42 };

      const result = normalizeBotPortfolio(portfolio, [], 0);

      expect(result.trades).toBe(42);
    });

    it("computes daily_pnl_pct from initial_capital when not provided", () => {
      const portfolio = { initial_capital: 100000 };

      const result = normalizeBotPortfolio(portfolio, [], 500);

      expect(result.daily_pnl).toBe(500);
      expect(result.daily_pnl_pct).toBeCloseTo(0.5, 2);
    });

    it("returns 0 daily_pnl_pct when initial_capital is 0", () => {
      const portfolio = { initial_capital: 0 };

      const result = normalizeBotPortfolio(portfolio, [], 500);

      expect(result.daily_pnl_pct).toBe(0);
    });

    it("converts string values to numbers", () => {
      const portfolio = {
        initial_capital: "100000",
        unrealized_pnl: "2000",
        cash: "50000",
      };

      const result = normalizeBotPortfolio(portfolio, [], 0);

      expect(result.initial_capital).toBe(100000);
      expect(result.unrealized_pnl).toBe(2000);
      expect(result.cash).toBe(50000);
    });
  });
}

/* ---------- Chart fixtures ---------- */

const BASE_TRADE = {
  entry_price: 103,
  exit_price: 107,
  entry_time: "2025-10-24T10:00:00",
  exit_time: "2025-10-24T10:30:00",
  quantity: 10,
  gross_pnl: 40,
  gross_pnl_pct: 3.88,
  trading_costs: 5,
  net_pnl: 35,
  net_pnl_pct: 3.4,
  exit_reason: "TP" as const,
  hold_duration_minutes: 30,
  date: "2025-10-24",
};

export function makeRawCandle(overrides: Record<string, unknown> = {}) {
  return {
    index: [
      "2025-10-24T09:15:00",
      "2025-10-24T09:30:00",
      "2025-10-24T10:00:00",
      "2025-10-24T10:30:00",
    ],
    open: [100, 101, 103, 105],
    high: [102, 104, 106, 108],
    low: [99, 100, 102, 104],
    close: [101, 103, 105, 107],
    volume: [1000, 2000, 3000, 1500],
    ...overrides,
  };
}

export function makeRawTrade(overrides: Record<string, unknown> = {}) {
  return {
    ...BASE_TRADE,
    ...overrides,
  };
}

export function makePaperTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    trade_id: "1",
    symbol: "TEST",
    side: "BUY",
    quantity: 10,
    entry_price: 100,
    exit_price: 110,
    entry_time: "2025-10-24T10:00:00",
    exit_time: "2025-10-24T10:30:00",
    pnl: 100,
    pnl_pct: 10,
    exit_reason: "TP",
    costs: 5,
    net_pnl: 95,
    stop_loss: 0,
    take_profit: 0,
    peak_price: 111,
    low_price: 99,
    hold_duration_minutes: 30,
    notes: "",
    reason: "",
    strategy_id: 1,
    strategy_name: "TEST",
    bot_id: null,
    bot_name: null,
    ...overrides,
  };
}

export function makeChartTrade(overrides: Record<string, unknown> = {}) {
  return {
    trade_id: 1,
    type: "entry" as const,
    time: "2025-10-24T10:00",
    candle_idx: 2,
    date: "2025-10-24",
    price: 103,
    marker: { symbol: "triangle", color: palette.INFO, size: 16 },
    trade: {
      ...BASE_TRADE,
      or_high: undefined,
      or_low: undefined,
      pp: undefined,
      r1: undefined,
      s1: undefined,
      r2: undefined,
      s2: undefined,
      "52w_high": undefined,
      trailing_active: undefined,
    },
    ...overrides,
  };
}

export function makePreviewData(overrides: Partial<ChartPreviewData> = {}): ChartPreviewData {
  return {
    symbol: "TATASTEEL",
    candles: [
      {
        time: "2024-01-01T09:15",
        date: "2024-01-01",
        time_str: "09:15",
        open: 100,
        high: 105,
        low: 99,
        close: 103,
        volume: 1000,
      },
    ],
    orb_zones: [
      { date: "2024-01-01", date_raw: "2024-01-01", or_high: 105, or_low: 99, or_end_time: "09:45" },
    ],
    pivot_levels: [{ date: "2024-01-01", date_raw: "2024-01-01", pp: 102, r1: 106, s1: 98 }],
    timeframe: 15,
    total_candles: 1,
    ...overrides,
  };
}

/* ---------- Pattern stream fixtures ---------- */

export function makePatternHit(symbol: string, confidence: number): Record<string, unknown> {
  return {
    id: confidence,
    symbol,
    timeframe: "1D",
    pattern_id: "falling_wedge",
    pattern_name: "Falling Wedge",
    family: "reversal",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence,
  };
}

export const STREAM_META = {
  total: 2,
  summary: { scanned: 2, patterns: 2, in_view: 2, confirmed: 2, bullish: 2, bearish: 0, data_through: "2026-09-30" },
  data_through: "2026-09-30",
};

export function createErrorCapture(): { getMessage: () => string | null; onError: (err: Error) => void } {
  let message: string | null = null;
  return {
    getMessage: () => message,
    onError: (err: Error) => {
      message = err.message;
    },
  };
}

export function createStreamCollector(): {
  order: string[];
  items: Array<Record<string, unknown>>;
  getMeta: () => unknown;
  isDone: () => boolean;
  handlers: {
    onMeta: (m: unknown) => void;
    onItem: (item: unknown) => void;
    onDone: () => void;
    onError: (err: Error) => void;
  };
} {
  const order: string[] = [];
  const items: Array<Record<string, unknown>> = [];
  let meta: unknown = null;
  let done = false;
  return {
    order,
    items,
    getMeta: () => meta,
    isDone: () => done,
    handlers: {
      onMeta: (m: unknown) => {
        order.push("meta");
        meta = m;
      },
      onItem: (item: unknown) => {
        order.push(`item:${(item as unknown as Record<string, unknown>).symbol}`);
        items.push(item as unknown as Record<string, unknown>);
      },
      onDone: () => {
        order.push("done");
        done = true;
      },
      onError: () => {
        throw new Error("must not error");
      },
    },
  };
}

/* ---------- API utils (bots/strategies) ---------- */

export function buildTestUrl(endpoint: string, params?: Record<string, string | number | boolean>): string {
  if (!params || Object.keys(params).length === 0) {
    return `http://localhost:8765${endpoint}`;
  }
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      filtered[key] = String(value);
    }
  }
  const qs = new URLSearchParams(filtered).toString();
  return qs ? `http://localhost:8765${endpoint}?${qs}` : `http://localhost:8765${endpoint}`;
}

export function createApiUtilsMock(): Record<string, unknown> {
  return {
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    apiPut: vi.fn(),
    apiDelete: vi.fn(),
    apiPostAction: vi.fn(),
    buildUrl: buildTestUrl,
  };
}
