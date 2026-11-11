// Shared builders for the normalize*.test.ts suites. Test-only.
import { expect } from "vitest";

type Dict = Record<string, unknown>;

export const makeCandle = (overrides: Dict = {}) => ({
  time: "2025-01-15T09:30:00",
  open: 100,
  high: 110,
  low: 95,
  close: 105,
  volume: 1000,
  ...overrides,
});

export const makeBacktestCandle = (overrides: Dict = {}) =>
  makeCandle({ date: "2025-01-15", time_str: "09:30", ...overrides });

export const makeReplayCandles = () => [
  makeCandle(),
  makeCandle({ time: "2025-01-15T09:31:00", open: 105, high: 108, low: 103, close: 107, volume: 800 }),
  makeCandle({ time: "2025-01-15T09:32:00", open: 107, high: 112, low: 106, close: 110, volume: 900 }),
];

export const makeBacktestEntry = (
  trade: Dict = {},
  tradeId = 1,
  candleIdx = 0,
  extra: Dict = {},
) => ({
  type: "entry",
  trade: { entry_price: 100, entry_time: "09:30", quantity: 10, ...trade },
  trade_id: tradeId,
  candle_idx: candleIdx,
  ...extra,
});

export const makeBacktestExit = (
  trade: Dict = {},
  tradeId = 1,
  candleIdx = 3,
  extra: Dict = {},
) => ({
  type: "exit",
  trade: {
    exit_price: 110,
    exit_time: "09:35",
    exit_reason: "TP",
    net_pnl: 10,
    trading_costs: 1,
    ...trade,
  },
  trade_id: tradeId,
  candle_idx: candleIdx,
  ...extra,
});

export const entryExitPair = (tradeId = 1) => [
  makeBacktestEntry({}, tradeId, 0),
  makeBacktestExit({}, tradeId, 3),
];

// Backtest data with a single highlighted entry carrying the given pivot fields.
export const backtestPivotHighlight = (pivot: Dict = {}) => ({
  candles: [] as unknown[],
  trades: [makeBacktestEntry({ entry_price: 100, ...pivot })],
});

export const makeReplayTrade = (overrides: Dict = {}) => ({
  id: 1,
  symbol: "TEST",
  entry_price: 100,
  exit_price: 110,
  entry_time: "2025-01-15T09:30:00",
  exit_time: "2025-01-15T09:35:00",
  exit_reason: "TP",
  quantity: 10,
  side: "BUY",
  pnl: 10,
  costs: 1,
  candle_idx: 0,
  exit_candle_idx: 2,
  ...overrides,
});

export const makeORLevels = (overrides: Dict = {}) => [
  {
    symbol: "TEST",
    strategy: "orb",
    from_index: 0,
    to_index: 8,
    or_high: 112,
    or_low: 98,
    ...overrides,
  },
];

export const makePivotLevels = (overrides: Dict = {}) => [
  {
    symbol: "TEST",
    strategy: "pivot",
    from_index: 0,
    to_index: 10,
    r2: 120,
    r1: 115,
    pp: 105,
    s1: 95,
    s2: 90,
    ...overrides,
  },
];

export const make52WLevels = (overrides: Dict = {}) => [
  {
    symbol: "TEST",
    strategy: "52w",
    from_index: 0,
    to_index: 20,
    high_52w: 150,
    low_52w: 80,
    ...overrides,
  },
];

export const makeEMADataMap = () => ({
  TEST: {
    ema_fast_period: 9,
    ema_slow_period: 21,
    timeframes: {
      "5min": {
        ema_fast: [100, 101, 102],
        ema_slow: [99, 100, 101],
      },
    },
  },
});

export const makeEMADataMapWithTimeframes = (
  timeframes: Record<string, { ema_fast: number[]; ema_slow: number[] }>,
) => ({
  TEST: {
    ema_fast_period: 9,
    ema_slow_period: 21,
    timeframes,
  },
});

export const makePaperData = (overrides: Dict = {}) => ({
  candles: [
    makeCandle(),
    makeCandle({ time: "2025-01-15T09:31:00", open: 105, high: 108, low: 103, close: 107, volume: 800 }),
  ],
  trades: [
    {
      trade_id: "1",
      entry_price: 100,
      exit_price: 110,
      entry_time: "2025-01-15T09:30:00",
      exit_time: "2025-01-15T09:35:00",
      exit_reason: "TP",
      quantity: 10,
      side: "BUY",
      pnl: 10,
      net_pnl: 10,
      costs: 1,
    },
  ],
  ...overrides,
});

// normalizePaper pivot-line lookups keyed by formatter token, shared by the pivot tests.
export const findPivotLines = (result: {
  markLines?: Array<{
    label: { formatter: string };
    lineStyle: { color?: string | undefined; type?: string | undefined };
  }>;
}) => ({
  r2: result.markLines?.find((ml) => ml.label.formatter.includes("R2")),
  r1: result.markLines?.find((ml) => ml.label.formatter.includes("R1")),
  pp: result.markLines?.find((ml) => ml.label.formatter.includes("PP")),
  s1: result.markLines?.find((ml) => ml.label.formatter.includes("S1")),
  s2: result.markLines?.find((ml) => ml.label.formatter.includes("S2")),
});

export const OHLCV = {
  time: "2025-01-15T09:30:00",
  open: 100,
  high: 110,
  low: 95,
  close: 105,
  volume: 1000,
} as const;

export const expectOhlcvMatch = (candle: unknown) => expect(candle).toMatchObject(OHLCV);
